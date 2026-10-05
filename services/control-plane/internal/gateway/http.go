package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type HTTP struct {
	S                   *Store
	Identity            *identity.HTTP
	Payments            *payments.Store
	AdminAssets         *os.Root
	ReleaseEvidencePath string
	releaseVerifier     func(context.Context, ReleaseManifest) error
}

func Mount(parent *identity.HTTP, s *Store) *HTTP {
	h := &HTTP{S: s, Identity: parent}
	parent.Mount("GET /ops", h.opsPage)
	h.mountWorkspace()
	parent.Mount("GET /ops/app.js", h.opsScript)
	parent.Mount("GET /ops/api/auth-config", h.opsAuthConfig)
	parent.Mount("POST /ops/api/login", h.opsLogin)
	parent.Mount("GET /ops/api/session", h.opsSession)
	parent.Mount("POST /ops/api/logout", h.opsLogout)
	parent.Mount("GET /ops/api/pending", h.opsPending)
	parent.Mount("GET /ops/api/overview", h.opsOverview)
	parent.Mount("GET /ops/api/verify", h.opsVerify)
	parent.Mount("POST /ops/api/preview", h.opsPreview)
	parent.Mount("POST /ops/api/reconcile", h.opsReconcile)
	parent.Mount("GET /v1/admin/billing/overview", h.billingOverview)
	parent.Mount("GET /v1/billing/wallet", h.wallet)
	parent.Mount("GET /v1/billing/ledger", h.ledger)
	parent.Mount("GET /v1/admin/billing/pending", h.pendingBilling)
	parent.Mount("POST /v1/admin/billing/preview", h.previewBilling)
	parent.Mount("POST /v1/admin/billing/reconcile", h.reconcile)
	parent.Mount("GET /v1/admin/billing/verify", h.billingVerify)
	parent.Mount("GET /v1/providers", h.providers)
	parent.Mount("GET /v1/models", h.models)
	parent.Mount("POST /v1/tasks", h.create)
	parent.Mount("GET /v1/tasks/{id}", h.task)
	parent.Mount("POST /v1/tasks/{id}/finish", h.end)
	parent.Mount("POST /v1/tasks/{id}/cancel", h.cancelTask)
	parent.Mount("GET /v1/tasks/{id}/requests", h.requests)
	parent.Mount("GET /v1/model-requests/{id}", h.request)
	parent.Mount("POST /v1/model-requests/{id}/cancel", h.cancel)
	parent.Mount("POST /v1/model-gateway/responses", h.stream)
	return h
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, e error) {
	status, code := 503, "UPSTREAM_ERROR"
	for _, v := range []struct {
		E error
		S int
	}{{ErrReleaseGates, 409}, {ErrReleaseRemote, 503}, {payments.ErrValidation, 400}, {payments.ErrConflict, 409}, {payments.ErrNotFound, 404}, {payments.ErrDisabled, 503}, {payments.ErrEvidence, 400}, {payments.ErrRefund, 409}, {metering.ErrValidation, 400}, {metering.ErrConflict, 409}, {metering.ErrPrice, 409}, {metering.ErrBalance, 402}, {metering.ErrBudget, 409}, {metering.ErrPending, 409}, {metering.ErrNotFound, 404}, {ErrValidation, 400}, {identity.ErrUnauthenticated, 401}, {ErrForbidden, 403}, {ErrNotFound, 404}, {ErrConflict, 409}, {ErrIdempotency, 409}, {ErrBudget, 409}, {ErrUnavailable, 503}, {ErrRate, 429}, {identity.ErrRateLimited, 429}, {identity.ErrForbidden, 403}, {identity.ErrConflict, 409}, {identity.ErrNotFound, 404}, {identity.ErrValidation, 400}, {identity.ErrIdempotency, 409}} {
		if errors.Is(e, v.E) {
			status, code = v.S, v.E.Error()
			break
		}
	}
	if status == 429 {
		w.Header().Set("Retry-After", "60")
	}
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": code, "requestId": newID(), "retryable": false}})
}
func (h *HTTP) auth(w http.ResponseWriter, r *http.Request) (identity.Principal, bool) {
	raw := r.Header.Get("Authorization")
	if !strings.HasPrefix(raw, "Bearer ") || len(raw) > 4096 {
		fail(w, identity.ErrUnauthenticated)
		return identity.Principal{}, false
	}
	p, e := h.Identity.S.Authenticate(r.Context(), strings.TrimPrefix(raw, "Bearer "))
	if e != nil {
		fail(w, e)
		return p, false
	}
	if e = h.Identity.S.Limit(r.Context(), "gateway:"+p.ID, 240); e != nil {
		fail(w, e)
		return p, false
	}
	return p, true
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, ErrValidation)
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil || d.Decode(new(any)) != io.EOF {
		fail(w, ErrValidation)
		return false
	}
	return true
}
func operation(w http.ResponseWriter, r *http.Request) bool {
	if !identifier.MatchString(r.Header.Get("Idempotency-Key")) {
		fail(w, ErrValidation)
		return false
	}
	return true
}
func (h *HTTP) providers(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.auth(w, r); !ok {
		return
	}
	status := "disabled"
	if h.S.Config.Enabled {
		status = "limited"
	}
	writeJSON(w, 200, map[string]any{"items": []any{map[string]any{"id": "rootflowai", "name": "RootFlowAI", "kind": "relay", "status": status, "documentationUrl": "https://rootflowai.com/docs"}}, "nextCursor": nil})
}
func (h *HTTP) models(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	var available bool
	var expires *time.Time
	var remaining int
	e := h.S.Pool.QueryRow(r.Context(), `SELECT COALESCE(expires_at>clock_timestamp() AND request_count<request_limit,false),expires_at,GREATEST(request_limit-request_count,0) FROM cloud_access WHERE account_id=$1`, p.ID).Scan(&available, &expires, &remaining)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		fail(w, e)
		return
	}
	if e != nil {
		available = false
		expires = nil
		remaining = 0
	}
	if expires != nil {
		utc := expires.UTC()
		expires = &utc
	}
	controls, e := h.S.Controls(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	available = available && !controls.CloudPaused
	cap := func(status string, evidence any) any { return map[string]any{"status": status, "evidenceId": evidence} }
	status := "unknown"
	var evidence any
	if h.S.Config.Enabled {
		status = "verified"
		evidence = "m5.0-rootflow-sol-core"
	}
	if h.S.Config.PaidAccount != "" {
		tx, e := h.S.Pool.Begin(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		available, e = paidAdmission(r.Context(), tx, p.ID, h.S.Config.PaidAccount)
		_ = tx.Rollback(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		available = available && !controls.CloudPaused
		remaining = h.S.Config.MaxRequests
		if available {
			e = h.S.Pool.QueryRow(r.Context(), `SELECT max(ends_at) FROM subscription_periods WHERE account_id=$1 AND state='active' AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp()`, p.ID).Scan(&expires)
			if e != nil {
				fail(w, e)
				return
			}
			if expires != nil {
				v := expires.UTC()
				expires = &v
			}
		}
	}
	mode := "alpha-test"
	var price any
	var testPricing *metering.Price
	var paidPricing *metering.Price
	if h.S.Config.SalesPriceVersion != "" {
		mode = "test-credits"
		tx, e := h.S.Pool.Begin(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		value, e := metering.PriceTx(r.Context(), tx, h.S.Config.SalesPriceVersion)
		_ = tx.Rollback(r.Context())
		if e != nil {
			fail(w, e)
			return
		}
		price = value.ID
		if value.Unit == "paid-credit" {
			// Catalogue rates are displayed in credits; stored retail arithmetic uses subunits.
			for i := range value.Tiers {
				for _, v := range []*string{&value.Tiers[i].Input, &value.Tiers[i].Cached, &value.Tiers[i].Output} {
					n, e := metering.Amount(*v)
					if e != nil {
						fail(w, e)
						return
					}
					*v = metering.Display(n, metering.PaidPrecision)
				}
			}
			paidPricing = &value
			mode = "paid-credits"
		} else {
			testPricing = &value
		}
	}
	writeJSON(w, 200, map[string]any{"items": []any{map[string]any{"id": ModelAlias, "providerId": "rootflowai", "upstreamModelId": "gpt-5.6-sol", "protocol": "responses", "enabled": h.S.Config.Enabled && available, "contextWindow": nil, "maxOutputTokens": h.S.Config.MaxOutputTokens, "capabilities": map[string]any{"streaming": cap(status, evidence), "tools": cap(status, evidence), "structuredOutput": cap("unknown", nil), "cancellation": cap("unknown", nil)}, "salesPriceVersionId": price, "verifiedAt": nil, "accessMode": mode, "routeVersionId": RouteVersion}}, "nextCursor": nil, "testPricing": testPricing, "paidPricing": paidPricing, "alpha": map[string]any{"configured": h.S.Config.Enabled, "available": h.S.Config.Enabled && available, "remainingRequests": remaining, "expiresAt": expires, "limits": Limits{MaxRequests: h.S.Config.MaxRequests, MaxOutput: h.S.Config.MaxOutputTokens, MaxDuration: h.S.Config.MaxDurationSeconds}}})
}
func (h *HTTP) create(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	var in CreateTask
	if !decode(w, r, &in) {
		return
	}
	v, e := h.S.Create(r.Context(), p, in, r.Header.Get("Idempotency-Key"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) task(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	v, e := h.S.Task(r.Context(), p.ID, r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) request(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	v, e := h.S.Request(r.Context(), p.ID, r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) cancel(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	v, e := h.S.Cancel(r.Context(), p.ID, r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) cancelTask(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	v, e := h.S.CancelTask(r.Context(), p.ID, r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) end(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	var in struct {
		State string `json:"state"`
	}
	if !decode(w, r, &in) {
		return
	}
	v, e := h.S.EndTask(r.Context(), p.ID, r.PathValue("id"), in.State)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) requests(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	task, e := h.S.Task(r.Context(), p.ID, r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return
	}
	rows, e := h.S.Pool.Query(r.Context(), `SELECT id FROM gateway_requests WHERE task_id=$1 AND account_id=$2 ORDER BY created_at LIMIT 16`, task.ID, p.ID)
	if e != nil {
		fail(w, e)
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	items := []Request{}
	for _, id := range ids {
		v, e := h.S.Request(r.Context(), p.ID, id)
		if e != nil {
			fail(w, e)
			return
		}
		items = append(items, v)
	}
	writeJSON(w, 200, map[string]any{"items": items, "nextCursor": nil})
}
