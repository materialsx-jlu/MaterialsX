package identity

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type deadlineWriter struct {
	*httptest.ResponseRecorder
	deadline time.Time
}

func (w *deadlineWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadline = deadline
	return nil
}

func TestProductionEdgeHostOriginAndLiveness(t *testing.T) {
	h := NewHTTP(nil, "https://api.materialsx-fixture.org", true)
	h.BillingPublicURL = "https://admin.materialsx-fixture.org"
	call := func(path, host, origin string) int {
		t.Helper()
		r := httptest.NewRequest(http.MethodGet, "https://"+host+path, nil)
		r.Host = host
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	if got := call("/health/live", "api.materialsx-fixture.org", ""); got != 200 {
		t.Fatal("liveness must not depend on database", got)
	}
	if got := call("/health/live", "other.materialsx-fixture.org", ""); got != 400 {
		t.Fatal("forged host", got)
	}
	if got := call("/health/live", "api.materialsx-fixture.org", "https://other.materialsx-fixture.org"); got != 403 {
		t.Fatal("forged origin", got)
	}
	if got := call("/ops/missing", "api.materialsx-fixture.org", ""); got != 400 {
		t.Fatal("admin route exposed through API host", got)
	}
	if got := call("/ops/missing", "admin.materialsx-fixture.org", ""); got != 404 {
		t.Fatal("admin route rejected on admin host", got)
	}
}

func TestServerAppliesWriteDeadlinePerRoute(t *testing.T) {
	h := NewHTTP(nil, "https://api.materialsx-fixture.org", true)
	h.Mount("POST /v1/model-gateway/responses", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })
	server := NewServer("127.0.0.1:0", h)
	if server.WriteTimeout != 0 || server.ReadHeaderTimeout == 0 || server.ReadTimeout == 0 {
		t.Fatal("server-wide write timeout would truncate long model streams")
	}
	call := func(method, path string) time.Duration {
		r := httptest.NewRequest(method, "https://api.materialsx-fixture.org"+path, nil)
		w := &deadlineWriter{ResponseRecorder: httptest.NewRecorder()}
		h.ServeHTTP(w, r)
		return time.Until(w.deadline)
	}
	if d := call("GET", "/health/live"); d < 29*time.Second || d > 30*time.Second {
		t.Fatal("ordinary API deadline changed", d)
	}
	if d := call("POST", "/v1/model-gateway/responses"); d < 24*time.Hour {
		t.Fatal("model stream inherited short deadline", d)
	}
}

func TestProductionEdgeListenerAndTrustedProxyMustBeLoopback(t *testing.T) {
	t.Setenv("MATERIALSX_IDENTITY_MASTER_KEY", base64.StdEncoding.EncodeToString([]byte(strings.Repeat("K", 32))))
	t.Setenv("MATERIALSX_DATABASE_URL", "postgres://fixture@127.0.0.1/test")
	t.Setenv("MATERIALSX_ENV", "production")
	t.Setenv("MATERIALSX_IDENTITY_PUBLIC_URL", "https://api.materialsx-fixture.org")
	t.Setenv("MATERIALSX_DEV_MODE", "")
	t.Setenv("MATERIALSX_IDENTITY_ADDR", "0.0.0.0:8788")
	if _, e := ConfigFromEnv(); e == nil || !strings.Contains(e.Error(), "loopback") {
		t.Fatal("production public listener accepted", e)
	}
	t.Setenv("MATERIALSX_IDENTITY_ADDR", "127.0.0.1:8788")
	t.Setenv("MATERIALSX_TRUSTED_PROXY_CIDRS", "10.0.0.0/24")
	if _, e := ConfigFromEnv(); e == nil || !strings.Contains(e.Error(), "loopback") {
		t.Fatal("production remote proxy trusted", e)
	}
	t.Setenv("MATERIALSX_TRUSTED_PROXY_CIDRS", "127.0.0.0/8")
	if _, e := ConfigFromEnv(); e == nil {
		t.Fatal("production broad loopback proxy trusted")
	}
	t.Setenv("MATERIALSX_TRUSTED_PROXY_CIDRS", "127.0.0.1/32,::1/128")
	if c, e := ConfigFromEnv(); e != nil || len(c.TrustedProxies) != 2 {
		t.Fatal("exact loopback proxies rejected", e)
	}
}
