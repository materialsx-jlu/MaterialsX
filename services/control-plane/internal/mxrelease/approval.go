package mxrelease

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
)

// Approval is a private, time-limited production release contract. Each
// evidence digest is checked against its actual local file, not merely trusted
// because a path and hash appear in the JSON.
type Approval struct {
	SchemaVersion string     `json:"schemaVersion"`
	ReleaseID     string     `json:"releaseId"`
	PriceVersion  string     `json:"priceVersion"`
	APIOrigin     string     `json:"apiOrigin"`
	MerchantID    string     `json:"merchantId"`
	RefundRule    string     `json:"refundRule"`
	ExpiresAt     time.Time  `json:"expiresAt"`
	Evidence      []Evidence `json:"evidence"`
	Routes        []Route    `json:"routes"`
}

type Route struct {
	ModelID string `json:"modelId"`
	Version string `json:"routeVersion"`
}

func (a Approval) Allows(model, version string) bool {
	for _, route := range a.Routes {
		if route.ModelID == model && route.Version == version {
			return true
		}
	}
	return false
}

type Evidence struct {
	Kind       string    `json:"kind"`
	Path       string    `json:"path"`
	SHA256     string    `json:"sha256"`
	ApprovedBy string    `json:"approvedBy"`
	ApprovedAt time.Time `json:"approvedAt"`
}

var required = []string{"price-and-fx", "supplier-usage", "merchant-and-callback", "unused-full-refund", "wallet-reconciliation", "release-approval"}

const PriceVersion = mxpricing.ApprovedVersion

var StaticRouteVersions = map[string]string{
	"gpt-5.6-sol":      "mx03-gpt56-litellm-responses-20261007-v1",
	"claude-opus-5-5":  "mx03-opus55-litellm-chat-adapter-20261007-v1",
	"claude-fable-5-1": "mx03-fable51-litellm-chat-adapter-20261007-v1",
}

var identifier = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

func originValid(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Port() != "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || net.ParseIP(u.Hostname()) != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return strings.Contains(host, ".") && !strings.HasSuffix(host, ".invalid") && !strings.HasSuffix(host, ".test") && !strings.HasSuffix(host, ".localhost") && !strings.HasSuffix(host, ".local") && !strings.HasSuffix(host, ".example")
}

func privateFile(path string, limit int64) ([]byte, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("absolute_private_file_required")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() == 0 || st.Size() > limit {
		return nil, errors.New("private_file_invalid")
	}
	return io.ReadAll(io.LimitReader(f, limit+1))
}

func uniqueJSON(d *json.Decoder) error {
	token, err := d.Token()
	if err != nil {
		return err
	}
	open, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	if open == '{' {
		seen := map[string]bool{}
		for d.More() {
			token, err := d.Token()
			key, valid := token.(string)
			if err != nil || !valid || seen[key] {
				return errors.New("duplicate_approval_key")
			}
			seen[key] = true
			if err := uniqueJSON(d); err != nil {
				return err
			}
		}
	} else if open == '[' {
		for d.More() {
			if err := uniqueJSON(d); err != nil {
				return err
			}
		}
	} else {
		return errors.New("invalid_approval_json")
	}
	_, err = d.Token()
	return err
}

// Read rejects missing, expired, stale, mutable or incomplete evidence. It is
// deliberately called again on new admissions so removing the approval closes
// sales without disrupting historical payment/refund reconciliation.
func Read(path string, now time.Time) (Approval, error) {
	var a Approval
	raw, err := privateFile(path, 64*1024)
	if err != nil {
		return a, err
	}
	check := json.NewDecoder(strings.NewReader(string(raw)))
	if uniqueJSON(check) != nil || check.Decode(new(any)) != io.EOF {
		return a, errors.New("invalid_approval_json")
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if d.Decode(&a) != nil || d.Decode(new(any)) != io.EOF || a.SchemaVersion != "mx-production-release-v1" ||
		a.ReleaseID != mxpricing.ApprovedVersion || a.PriceVersion != a.ReleaseID || !originValid(a.APIOrigin) ||
		a.MerchantID == "" || a.RefundRule != "unused-full-v1" || !a.ExpiresAt.After(now) || a.ExpiresAt.After(now.Add(90*24*time.Hour)) || len(a.Evidence) != len(required) || len(a.Routes) == 0 || len(a.Routes) > 100 {
		return Approval{}, errors.New("production_approval_invalid")
	}
	seenRoutes := map[string]bool{}
	for _, route := range a.Routes {
		if !identifier.MatchString(route.ModelID) || !identifier.MatchString(route.Version) || seenRoutes[route.ModelID] {
			return Approval{}, errors.New("production_route_invalid")
		}
		seenRoutes[route.ModelID] = true
	}
	seen := map[string]bool{}
	for _, e := range a.Evidence {
		validKind := false
		for _, kind := range required {
			validKind = validKind || e.Kind == kind
		}
		if !validKind || seen[e.Kind] || len(e.ApprovedBy) < 2 || e.ApprovedAt.IsZero() || e.ApprovedAt.After(now) || now.Sub(e.ApprovedAt) > 90*24*time.Hour || len(e.SHA256) != 64 {
			return Approval{}, errors.New("production_evidence_invalid")
		}
		seen[e.Kind] = true
		body, err := privateFile(e.Path, 1024*1024)
		if err != nil {
			return Approval{}, errors.New("production_evidence_unavailable")
		}
		h := sha256.Sum256(body)
		if hex.EncodeToString(h[:]) != e.SHA256 {
			return Approval{}, errors.New("production_evidence_changed")
		}
	}
	return a, nil
}
