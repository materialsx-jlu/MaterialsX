package identity

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
)

// Public capabilities are coarse deployment flags. User access and prices are
// always evaluated by authenticated endpoints at the time of each operation.
type ClientFeatures struct {
	Account  bool `json:"account"`
	Models   bool `json:"models"`
	Research bool `json:"research"`
	Payments bool `json:"payments"`
}

func (h *HTTP) clientConfig(w http.ResponseWriter, r *http.Request) {
	var catalog, release string
	var cloudPaused, salesPaused bool
	if err := h.S.Pool.QueryRow(r.Context(), `SELECT
		COALESCE((SELECT string_agg(id || ':' || version::text || ':' || COALESCE(retail_version_id,''), ',' ORDER BY id)
		FROM mx_cloud_models WHERE status='active' AND ($1::boolean=false OR deployed_version=version)),'') || '|' ||
		COALESCE((SELECT string_agg(id || ':' || fingerprint, ',' ORDER BY id)
		FROM mx_retail_price_versions WHERE status='approved'),'')`, os.Getenv("MATERIALSX_ENV") == "production").Scan(&catalog); err != nil {
		h.fail(w, err)
		return
	}
	if err := h.S.Pool.QueryRow(r.Context(), `SELECT COALESCE((SELECT manifest->>'tag' FROM release_registry WHERE state='published' ORDER BY verified_at DESC,id DESC LIMIT 1),'')`).Scan(&release); err != nil {
		h.fail(w, err)
		return
	}
	if err := h.S.Pool.QueryRow(r.Context(), `SELECT cloud_paused,sales_paused FROM operations_controls WHERE id=true`).Scan(&cloudPaused, &salesPaused); err != nil {
		h.fail(w, err)
		return
	}
	features := h.ClientFeatures
	features.Models = features.Models && !cloudPaused
	features.Payments = features.Payments && !salesPaused
	availability := map[string]any{
		"account":  capabilityStatus(features.Account, false),
		"models":   capabilityStatus(h.ClientFeatures.Models, cloudPaused),
		"research": capabilityStatus(features.Research, false),
		"payments": capabilityStatus(h.ClientFeatures.Payments, salesPaused),
	}
	revision := sha256.Sum256([]byte(catalog))
	revisionHex := hex.EncodeToString(revision[:])
	etagHash := sha256.Sum256([]byte(revisionHex + ":" + release + ":" + boolFlags(features) + ":" + boolFlags(h.ClientFeatures)))
	etag := `"` + hex.EncodeToString(etagHash[:]) + `"`
	w.Header().Set("Cache-Control", "no-cache, must-revalidate")
	w.Header().Set("ETag", etag)
	w.Header().Set("Vary", "Accept-Encoding")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	var recommended any
	if release != "" {
		recommended = release
	}
	h.json(w, http.StatusOK, map[string]any{
		"schemaVersion": 1, "catalogRevision": revisionHex,
		"recommendedVersion": recommended, "features": features, "availability": availability,
	})
}

func capabilityStatus(configured, paused bool) map[string]string {
	if !configured {
		return map[string]string{"status": "unavailable", "reason": "not_configured"}
	}
	if paused {
		return map[string]string{"status": "unavailable", "reason": "paused"}
	}
	return map[string]string{"status": "available", "reason": ""}
}

func boolFlags(f ClientFeatures) string {
	b := []byte("0000")
	if f.Account {
		b[0] = '1'
	}
	if f.Models {
		b[1] = '1'
	}
	if f.Research {
		b[2] = '1'
	}
	if f.Payments {
		b[3] = '1'
	}
	return string(b)
}
