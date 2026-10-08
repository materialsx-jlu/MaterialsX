package gateway

import (
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"net/http"
)

func (h *HTTP) wallet(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	v, e := (&metering.Store{Pool: h.S.Pool}).Wallet(r.Context(), p.ID)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) ledger(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	items, next, e := (&metering.Store{Pool: h.S.Pool}).Ledger(r.Context(), p.ID, r.URL.Query().Get("cursor"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "nextCursor": next})
}
func (h *HTTP) admin(w http.ResponseWriter, r *http.Request) (identity.Principal, bool) {
	p, ok := h.auth(w, r)
	if !ok {
		return p, false
	}
	if !h.Identity.S.AdminAllowed(p) {
		fail(w, ErrForbidden)
		return p, false
	}
	return p, true
}
func (h *HTTP) pendingBilling(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.admin(w, r); !ok {
		return
	}
	items, e := (&metering.Store{Pool: h.S.Pool}).Pending(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (h *HTTP) reconcile(w http.ResponseWriter, r *http.Request) {
	p, ok := h.admin(w, r)
	if !ok || !operation(w, r) {
		return
	}
	var in metering.Evidence
	if !decode(w, r, &in) {
		return
	}
	if r.Header.Get("Idempotency-Key") != in.RequestID {
		fail(w, ErrValidation)
		return
	}
	if e := (&metering.Store{Pool: h.S.Pool}).Reconcile(r.Context(), p.ID, in); e != nil {
		fail(w, e)
		return
	}
	v, e := h.S.Request(r.Context(), billingOwner(r, h), in.RequestID)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func billingOwner(r *http.Request, h *HTTP) string {
	var owner string
	_ = h.S.Pool.QueryRow(r.Context(), `SELECT account_id FROM gateway_requests WHERE id=$1`, r.Header.Get("Idempotency-Key")).Scan(&owner)
	return owner
}
func (h *HTTP) billingVerify(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.admin(w, r); !ok {
		return
	}
	n, e := (&metering.Store{Pool: h.S.Pool}).Verify(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"verified": true, "grants": n})
}

func (h *HTTP) previewBilling(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.admin(w, r); !ok {
		return
	}
	var in metering.Evidence
	if !decode(w, r, &in) {
		return
	}
	value, e := (&metering.Store{Pool: h.S.Pool}).Preview(r.Context(), in)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, value)
}
