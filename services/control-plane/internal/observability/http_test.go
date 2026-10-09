package observability

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRedactedMetricsAndCorrelation(t *testing.T) {
	token := strings.Repeat("a", 32)
	m := New(token)
	h := m.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	r := httptest.NewRequest("POST", "http://example.org/v1/model-gateway/responses?api_key=secret", strings.NewReader("private research text"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Header().Get("X-Request-ID") == "" {
		t.Fatal("missing correlation ID")
	}
	metric := httptest.NewRequest("GET", "http://example.org/internal/metrics", nil)
	metric.RemoteAddr = "127.0.0.1:44001"
	metric.Header.Set("X-MX-Metrics-Key", token)
	out := httptest.NewRecorder()
	h.ServeHTTP(out, metric)
	if out.Code != 200 {
		t.Fatalf("metrics status %d", out.Code)
	}
	if strings.Contains(out.Body.String(), "secret") || strings.Contains(out.Body.String(), "research") {
		t.Fatal("private input leaked")
	}
	var parsed struct {
		Routes map[string]struct {
			Requests      uint64
			ProxyTimeouts uint64
		}
	}
	if err := json.Unmarshal(out.Body.Bytes(), &parsed); err != nil || parsed.Routes["model_gateway"].ProxyTimeouts != 1 {
		t.Fatalf("wrong metrics: %v %+v", err, parsed)
	}
	denied := httptest.NewRecorder()
	metric.Header.Del("X-MX-Metrics-Key")
	h.ServeHTTP(denied, metric)
	if denied.Code != 404 {
		t.Fatal("metrics without token exposed")
	}
}
func TestFirstTokenIsDistinctFromConnectionByte(t *testing.T) {
	m := New(strings.Repeat("b", 32))
	h := m.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(": connected\n\n"))
		RecordFirstToken(r.Context())
		w.Write([]byte("data: text\n\n"))
	}))
	r := httptest.NewRequest("POST", "http://example.org/v1/model-gateway/responses", nil)
	h.ServeHTTP(httptest.NewRecorder(), r)
	metric := httptest.NewRequest("GET", "http://example.org/internal/metrics", nil)
	metric.RemoteAddr = "127.0.0.1:44002"
	metric.Header.Set("X-MX-Metrics-Key", strings.Repeat("b", 32))
	out := httptest.NewRecorder()
	h.ServeHTTP(out, metric)
	var parsed struct {
		Routes map[string]struct{ FirstTokenCount uint64 }
	}
	if e := json.Unmarshal(out.Body.Bytes(), &parsed); e != nil || parsed.Routes["model_gateway"].FirstTokenCount != 1 {
		t.Fatal("first token not counted")
	}
}
func TestLabelsAndIDsDoNotIncludePrivatePath(t *testing.T) {
	if route("/v1/mx-points/orders/mx-test") != "payments" || route("/v1/billing/orders/legacy") != "payments" {
		t.Fatal("order routes not grouped")
	}
	if safeID("id-within-limits") != "id-within-limits" || safeID("email@example.org") != "" || safeID(strings.Repeat("a", 65)) != "" {
		t.Fatal("unsafe entity ID admitted")
	}
}
