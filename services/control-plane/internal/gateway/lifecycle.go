package gateway

import (
	"context"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
	"net/http"
	"net/url"
	"os"
	"time"
)

func (h *HTTP) ConfigureLifecycle(key []byte, approvals string) {
	s := lifecycle.Store{Pool: h.S.Pool, Key: append([]byte(nil), key...)}
	user := func(fn func(http.ResponseWriter, *http.Request, string, bool)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			p, ok := h.auth(w, r)
			if !ok {
				return
			}
			if r.Method != "GET" && !operation(w, r) {
				return
			}
			fn(w, r, p.ID, false)
		}
	}
	admin := func(fn func(http.ResponseWriter, *http.Request, string, bool)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			clone, ok := h.opsAuthorized(w, r)
			if !ok {
				return
			}
			p, ok := h.admin(w, clone)
			if !ok {
				return
			}
			if r.Method != "GET" && !operation(w, r) {
				return
			}
			fn(w, r, p.ID, true)
		}
	}
	list := func(w http.ResponseWriter, r *http.Request, owner string, isAdmin bool) {
		items, cursor, e := s.List(r.Context(), owner, isAdmin, r.URL.Query().Get("cursor"))
		if e != nil {
			fail(w, e)
			return
		}
		var next any
		if cursor != "" {
			next = cursor
		}
		writeJSON(w, 200, map[string]any{"items": items, "nextCursor": next})
	}
	reply := func(w http.ResponseWriter, r *http.Request, owner string, isAdmin bool) {
		var in lifecycle.Reply
		if !decode(w, r, &in) {
			return
		}
		v, e := s.Reply(r.Context(), owner, r.PathValue("id"), r.Header.Get("Idempotency-Key"), isAdmin, in)
		if e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, v)
	}
	attachRead := func(w http.ResponseWriter, r *http.Request, owner string, isAdmin bool) {
		v, e := s.Attachment(r.Context(), owner, r.PathValue("id"), isAdmin)
		if e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, map[string]string{"text": v})
	}
	h.Identity.Mount("GET /v1/support/tickets", user(list))
	h.Identity.Mount("POST /v1/support/tickets", user(func(w http.ResponseWriter, r *http.Request, owner string, _ bool) {
		var in lifecycle.NewTicket
		if !decode(w, r, &in) {
			return
		}
		v, e := s.Create(r.Context(), owner, r.Header.Get("Idempotency-Key"), in)
		if e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, v)
	}))
	h.Identity.Mount("POST /v1/support/tickets/{id}/reply", user(reply))
	h.Identity.Mount("POST /v1/support/tickets/{id}/attachments", user(func(w http.ResponseWriter, r *http.Request, owner string, _ bool) {
		var in lifecycle.AttachInput
		if !decode(w, r, &in) {
			return
		}
		v, e := s.Attach(r.Context(), owner, r.PathValue("id"), in)
		if e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, v)
	}))
	h.Identity.Mount("GET /v1/support/attachments/{id}", user(attachRead))
	h.Identity.Mount("GET /ops/api/support", admin(list))
	h.Identity.Mount("POST /ops/api/support/{id}/reply", admin(reply))
	h.Identity.Mount("GET /ops/api/support/attachments/{id}", admin(attachRead))
	h.Identity.Mount("GET /ops/api/procurement", admin(func(w http.ResponseWriter, r *http.Request, _ string, _ bool) {
		v, e := s.Costs(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, v)
	}))
	h.Identity.Mount("POST /ops/api/procurement", admin(func(w http.ResponseWriter, r *http.Request, owner string, _ bool) {
		var in struct {
			Lines []lifecycle.StatementLine `json:"lines"`
		}
		if !decode(w, r, &in) {
			return
		}
		if e := s.ImportStatement(r.Context(), owner, in.Lines); e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, map[string]bool{"imported": true})
	}))
	h.Identity.Mount("GET /ops/api/alerts", admin(func(w http.ResponseWriter, r *http.Request, _ string, _ bool) {
		v, e := s.Alerts(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"items": v})
	}))
	h.Identity.Mount("POST /ops/api/alerts/{id}/acknowledge", admin(func(w http.ResponseWriter, r *http.Request, owner string, _ bool) {
		var in struct {
			Reason string `json:"reason"`
		}
		if !decode(w, r, &in) {
			return
		}
		if e := s.Acknowledge(r.Context(), owner, r.PathValue("id"), in.Reason, r.Header.Get("Idempotency-Key")); e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, map[string]bool{"acknowledged": true})
	}))
	h.Identity.Mount("GET /ops/api/readiness", admin(func(w http.ResponseWriter, r *http.Request, _ string, _ bool) {
		v, e := s.Readiness(r.Context(), approvals, RouteVersion)
		if e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, v)
	}))
	h.Identity.Mount("GET /ops/api/beta", admin(func(w http.ResponseWriter, r *http.Request, _ string, _ bool) {
		v, e := s.Enrollments(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, map[string]any{"items": v})
	}))
	h.Identity.Mount("POST /ops/api/beta/{id}", admin(func(w http.ResponseWriter, r *http.Request, owner string, _ bool) {
		var in struct {
			State   string `json:"state"`
			Reason  string `json:"reason"`
			Version int64  `json:"expectedVersion,string"`
		}
		if !decode(w, r, &in) {
			return
		}
		if e := s.Enroll(r.Context(), owner, r.PathValue("id"), in.State, in.Reason, in.Version, r.Header.Get("Idempotency-Key")); e != nil {
			fail(w, e)
			return
		}
		writeJSON(w, 200, map[string]bool{"enrolled": true})
	}))
	h.Identity.Mount("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		var worker, pendingPayments, pendingMX bool
		e := s.Pool.QueryRow(r.Context(), `SELECT
			EXISTS(SELECT 1 FROM worker_heartbeats WHERE name='billing' AND touched_at>clock_timestamp()-interval '60 seconds'),
			EXISTS(SELECT 1 FROM payment_jobs WHERE state='pending'),
			EXISTS(SELECT 1 FROM mx_point_jobs WHERE state='pending')`).Scan(&worker, &pendingPayments, &pendingMX)
		workerRequired := os.Getenv("MATERIALSX_ENV") == "production" || h.Identity.ClientFeatures.Payments || h.S.Config.Enabled ||
			(h.Payments != nil && h.Payments.Mode != "disabled") ||
			(h.MXPoints != nil && h.MXPoints.Mode != "disabled") || pendingPayments || pendingMX
		modelProxyRequired := h.Identity.ClientFeatures.Models && h.S.Config.MX03Diagnostic
		modelProxy := "not_required"
		if modelProxyRequired {
			modelProxy = "unavailable"
			if modelProxyHealthy(r.Context(), os.Getenv("MATERIALSX_LITELLM_URL")) {
				modelProxy = "healthy"
			}
		}
		status := 200
		if e != nil || (workerRequired && !worker) || (modelProxyRequired && modelProxy != "healthy") {
			status = 503
		}
		writeJSON(w, status, map[string]any{
			"ready": status == 200,
			"components": map[string]any{
				"accountDatabase": e == nil,
				"billingWorker":   map[string]any{"required": workerRequired, "healthy": e == nil && worker},
				"modelProxy":      map[string]any{"required": modelProxyRequired, "status": modelProxy},
			},
			"features": h.Identity.ClientFeatures,
		})
	})
}

func modelProxyHealthy(ctx context.Context, raw string) bool {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "http" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" ||
		(u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
		return false
	}
	probeCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	req, e := http.NewRequestWithContext(probeCtx, http.MethodGet, u.String()+"/health/liveliness", nil)
	if e != nil {
		return false
	}
	client := &http.Client{Timeout: 1500 * time.Millisecond, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, e := client.Do(req)
	if e != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
