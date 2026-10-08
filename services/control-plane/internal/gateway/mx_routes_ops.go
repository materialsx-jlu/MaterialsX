package gateway

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
)

type mxProbeReport struct {
	SchemaVersion string `json:"schemaVersion"`
	Environment   string `json:"environment"`
	PriceVersion  string `json:"priceVersion"`
	GeneratedAt   string `json:"generatedAt"`
	Routes        []struct {
		Slot           string `json:"slot"`
		ModelDiscovery struct {
			Status string `json:"status"`
		} `json:"modelDiscovery"`
		SelectedProtocol *string `json:"selectedProtocol"`
		Protocols        map[string]struct {
			Usage *struct {
				Complete bool `json:"complete"`
			} `json:"usage"`
		} `json:"protocols"`
	} `json:"routes"`
}

func (h *HTTP) mxProbeSummary() (map[string]map[string]any, *string) {
	path := h.MXProbeReportPath
	if !filepath.IsAbs(path) {
		return nil, nil
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 64*1024 {
		return nil, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil
	}
	var report mxProbeReport
	if json.Unmarshal(raw, &report) != nil || report.SchemaVersion != "mx-v0.3-supplier-probe-v1" || report.Environment != "real-provider" || report.PriceVersion != mxpricing.SnapshotVersion || len(report.Routes) > 3 {
		return nil, nil
	}
	if _, err = time.Parse(time.RFC3339Nano, report.GeneratedAt); err != nil {
		return nil, nil
	}
	results := make(map[string]map[string]any)
	for _, entry := range report.Routes {
		if _, ok := mxCredentialRefs[entry.Slot]; !ok {
			return nil, nil
		}
		if _, duplicate := results[entry.Slot]; duplicate {
			return nil, nil
		}
		protocol := ""
		complete := false
		if entry.SelectedProtocol != nil && (*entry.SelectedProtocol == "responses" || *entry.SelectedProtocol == "chat-completions") {
			protocol = *entry.SelectedProtocol
			complete = entry.Protocols[protocol].Usage != nil && entry.Protocols[protocol].Usage.Complete
		}
		discovery := "not_run"
		switch entry.ModelDiscovery.Status {
		case "exact_id_visible", "exact_id_missing", "http_error", "invalid_catalog", "credential_missing", "timeout", "transport_error":
			discovery = entry.ModelDiscovery.Status
		}
		results[entry.Slot] = map[string]any{"probeStatus": "reported", "discovery": discovery, "selectedProtocol": protocol, "usageComplete": complete}
	}
	stamp := report.GeneratedAt
	return results, &stamp
}

var mxCredentialRefs = map[string]string{
	"gpt-5.6-sol":      "MX_SUPPLIER_GPT56_KEY",
	"claude-opus-5-5":  "MX_SUPPLIER_OPUS55_KEY",
	"claude-fable-5-1": "MX_SUPPLIER_FABLE51_KEY",
}

// This is the process's deployed route snapshot. Credentials stay in the
// independently deployed LiteLLM service; its health and supplier probes are
// never inferred from an enabled switch.
func (h *HTTP) opsMXRoutes(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.opsAuthorized(w, r); !ok {
		return
	}
	routes := make([]map[string]any, 0, len(mx03Routes))
	walletSales := h.S.Config.MX03Wallet && h.MXPoints != nil && h.MXPoints.Mode == "wechat-live"
	releaseID, releaseStatus := mxpricing.SnapshotVersion, "draft"
	if walletSales {
		releaseID, releaseStatus = h.S.Config.MX03PriceVersion, "approved"
	}
	probes, probeAt := h.mxProbeSummary()
	for _, template := range mx03Routes {
		route, exists := h.S.Config.Routes[template.ModelID]
		if !exists {
			route = template
		}
		probe := probes[template.ModelID]
		if probe == nil {
			probe = map[string]any{"probeStatus": "not_synchronized", "discovery": "not_run", "selectedProtocol": "", "usageComplete": false}
		}
		routes = append(routes, map[string]any{"slotId": template.ModelID, "credentialRef": mxCredentialRefs[template.ModelID],
			"proxyAlias": template.UpstreamAlias, "routeVersionId": template.Version, "protocol": template.Protocol,
			"runtimeEnabled": h.S.Config.MX03Diagnostic && route.Enabled && route.Provider != nil, "probeStatus": probe["probeStatus"],
			"discovery": probe["discovery"], "selectedProtocol": probe["selectedProtocol"], "usageComplete": probe["usageComplete"], "salesEnabled": walletSales && route.Enabled && route.Provider != nil})
	}
	writeJSON(w, 200, map[string]any{"releaseId": releaseID, "releaseStatus": releaseStatus, "probeReportedAt": probeAt,
		"purchaseVersionId": releaseID + "-purchase", "fxVersionId": releaseID + "-fx",
		"retailVersionId": releaseID + "-retail", "salesEnabled": walletSales, "routes": routes})
}
