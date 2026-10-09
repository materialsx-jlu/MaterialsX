package observability

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type counters struct {
	Requests, Failures, Logins, LoginFailures, ProxyTimeouts uint64
	FirstByteTotalMs, FirstTokenTotalMs, FirstTokenCount     uint64
}
type Monitor struct {
	mu      sync.Mutex
	byRoute map[string]counters
	started time.Time
	log     *slog.Logger
	token   string
	Probe   func(context.Context) (map[string]int64, error)
}
type tokenTraceKey struct{}
type tokenTrace struct{ at time.Time }

// RecordFirstToken is called only after a user-visible text delta was flushed.
func RecordFirstToken(ctx context.Context) {
	if trace, ok := ctx.Value(tokenTraceKey{}).(*tokenTrace); ok && trace.at.IsZero() {
		trace.at = time.Now()
	}
}
func New(token string) *Monitor {
	return &Monitor{byRoute: map[string]counters{}, started: time.Now(), log: slog.New(slog.NewJSONHandler(os.Stdout, nil)), token: token}
}

type recorder struct {
	http.ResponseWriter
	status int
	first  time.Time
}

func (w *recorder) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.first = time.Now()
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *recorder) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(p)
}
func (w *recorder) Flush() {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
func (w *recorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// Route labels are fixed; raw paths, queries, bodies, account names and secrets are never logged.
func route(path string) string {
	switch {
	case path == "/health" || path == "/health/live":
		return "health"
	case strings.HasPrefix(path, "/v1/auth/") || strings.HasPrefix(path, "/auth/desktop/"):
		return "auth"
	case path == "/v1/model-gateway/responses":
		return "model_gateway"
	case strings.HasPrefix(path, "/v1/tasks/"):
		return "tasks"
	case strings.HasPrefix(path, "/v1/model-requests/"):
		return "model_requests"
	case strings.HasPrefix(path, "/v1/billing/orders") || strings.HasPrefix(path, "/v1/mx-points/orders") || strings.Contains(path, "payment") || strings.Contains(path, "wechat") || strings.Contains(path, "refund"):
		return "payments"
	case strings.HasPrefix(path, "/v1/models") || strings.HasPrefix(path, "/v1/providers"):
		return "catalog"
	case strings.HasPrefix(path, "/ops") || strings.HasPrefix(path, "/v1/admin/"):
		return "operations"
	case strings.HasPrefix(path, "/v1/"):
		return "api_other"
	default:
		return "other"
	}
}
func requestID() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		return "unavailable"
	}
	return hex.EncodeToString(b[:])
}
func safeID(value string) string {
	if len(value) == 0 || len(value) > 64 {
		return ""
	}
	for _, ch := range value {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_') {
			return ""
		}
	}
	return value
}
func (m *Monitor) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/internal/metrics" {
			m.metrics(w, r)
			return
		}
		start := time.Now()
		id := requestID()
		label := route(r.URL.Path)
		w.Header().Set("X-Request-ID", id)
		trace := &tokenTrace{}
		rec := &recorder{ResponseWriter: w}
		next.ServeHTTP(rec, r.WithContext(context.WithValue(r.Context(), tokenTraceKey{}, trace)))
		if rec.status == 0 {
			rec.status = 200
			rec.first = time.Now()
		}
		latency := time.Since(start).Milliseconds()
		first := rec.first.Sub(start).Milliseconds()
		tokenMs := int64(-1)
		if !trace.at.IsZero() {
			tokenMs = trace.at.Sub(start).Milliseconds()
		}
		m.mu.Lock()
		c := m.byRoute[label]
		c.Requests++
		if rec.status >= 500 {
			c.Failures++
		}
		if r.URL.Path == "/v1/auth/desktop/exchange" {
			if rec.status < 400 {
				c.Logins++
			} else {
				c.LoginFailures++
			}
		}
		if label == "model_gateway" && (rec.status == 503 || rec.status == 504) {
			c.ProxyTimeouts++
		}
		if label == "model_gateway" {
			c.FirstByteTotalMs += uint64(first)
			if tokenMs >= 0 {
				c.FirstTokenCount++
				c.FirstTokenTotalMs += uint64(tokenMs)
			}
		}
		m.byRoute[label] = c
		m.mu.Unlock()
		entity, taskID, modelRequestID, orderID := "", "", "", ""
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if label == "tasks" && len(parts) >= 3 {
			taskID = safeID(parts[2])
			entity = taskID
		}
		if label == "payments" && len(parts) >= 4 {
			orderID = safeID(parts[3])
			entity = orderID
		}
		if label == "model_gateway" {
			taskID = safeID(r.Header.Get("X-Materialsx-Task-Id"))
			modelRequestID = safeID(r.Header.Get("X-Materialsx-Request-Id"))
		}
		m.log.Info("http_request", "request_id", id, "route", label, "entity_id", entity, "task_id", taskID, "model_request_id", modelRequestID, "order_id", orderID, "method", r.Method, "status", rec.status, "duration_ms", latency, "first_byte_ms", first, "first_token_ms", tokenMs)
	})
}
func (m *Monitor) metrics(w http.ResponseWriter, r *http.Request) {
	host, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() || len(m.token) < 32 || r.Header.Get("X-MX-Metrics-Key") != m.token {
		http.NotFound(w, r)
		return
	}
	m.mu.Lock()
	data := make(map[string]counters, len(m.byRoute))
	for k, v := range m.byRoute {
		data[k] = v
	}
	m.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	result := map[string]any{"schemaVersion": 1, "uptimeSeconds": int(time.Since(m.started).Seconds()), "routes": data}
	if m.Probe != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if db, e := m.Probe(ctx); e == nil {
			result["database"] = db
		} else {
			result["databaseAvailable"] = false
		}
	}
	_ = json.NewEncoder(w).Encode(result)
}
