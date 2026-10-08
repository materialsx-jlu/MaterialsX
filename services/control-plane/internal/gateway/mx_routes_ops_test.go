package gateway

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpsMXRoutesStayPrivateAndDraft(t *testing.T) {
	fixture := workspaceTest(t)
	anon := httptest.NewRequest("GET", "http://ops.test/ops/api/mx-routes", nil)
	response := httptest.NewRecorder()
	fixture.parent.ServeHTTP(response, anon)
	if response.Code != 401 {
		t.Fatalf("anonymous routes: %d", response.Code)
	}
	view := fixture.ops("GET", "mx-routes", nil, "")
	if view.Code != 200 {
		t.Fatalf("ops routes: %d %s", view.Code, view.Body.String())
	}
	var body struct {
		ReleaseID    string `json:"releaseId"`
		SalesEnabled bool   `json:"salesEnabled"`
		Routes       []struct {
			SlotID         string `json:"slotId"`
			CredentialRef  string `json:"credentialRef"`
			ProbeStatus    string `json:"probeStatus"`
			RuntimeEnabled bool   `json:"runtimeEnabled"`
		} `json:"routes"`
	}
	if err := json.Unmarshal(view.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Routes) != 3 || body.SalesEnabled || body.ReleaseID == "" {
		t.Fatalf("unsafe route view: %+v", body)
	}
	for _, route := range body.Routes {
		if route.CredentialRef == "" || route.ProbeStatus != "not_synchronized" || route.RuntimeEnabled {
			t.Fatalf("unexpected probe/enable state: %+v", route)
		}
	}
}

func TestOpsMXRoutesSummarizesPrivateProbeWithoutRawReport(t *testing.T) {
	fixture := workspaceTest(t)
	path := filepath.Join(t.TempDir(), "supplier-probe.json")
	report := `{"schemaVersion":"mx-v0.3-supplier-probe-v1","generatedAt":"2026-10-07T00:00:00Z","environment":"real-provider","priceVersion":"mx-v0.3-rootflow-svip-20261007-3model-draft","privateNote":"never-expose-this","routes":[{"slot":"gpt-5.6-sol","modelDiscovery":{"status":"exact_id_visible"},"selectedProtocol":"responses","protocols":{"responses":{"usage":{"complete":true}}}}]}`
	if err := os.WriteFile(path, []byte(report), 0600); err != nil {
		t.Fatal(err)
	}
	fixture.h.MXProbeReportPath = path
	view := fixture.ops("GET", "mx-routes", nil, "")
	if view.Code != 200 || !strings.Contains(view.Body.String(), `"probeStatus":"reported"`) || !strings.Contains(view.Body.String(), `"usageComplete":true`) || strings.Contains(view.Body.String(), "never-expose-this") {
		t.Fatalf("probe summary unsafe: %d %s", view.Code, view.Body.String())
	}
}
