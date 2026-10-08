package gateway

import (
	"encoding/csv"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Separate optional mount keeps M5.1/2/3 services and fixtures compatible.
func MountPayments(parent *HTTP, s *payments.Store) {
	parent.Payments = s
	i := parent.Identity
	i.Mount("GET /v1/billing/plans", parent.paymentPlans)
	i.Mount("GET /v1/billing/orders", parent.paymentOrders)
	i.Mount("POST /v1/billing/orders", parent.paymentCreate)
	i.Mount("GET /v1/billing/orders/{id}", parent.paymentOrder)
	i.Mount("POST /v1/billing/orders/{id}/query", parent.paymentQuery)
	i.Mount("POST /v1/billing/orders/{id}/close", parent.paymentClose)
	i.Mount("POST /v1/billing/orders/{id}/refunds", parent.paymentRefund)
	i.Mount("GET /v1/billing/orders/{id}/refunds", parent.paymentRefunds)
	i.Mount("GET /v1/billing/subscriptions", parent.paymentPeriods)
	i.Mount("GET /v1/billing/export", parent.paymentExport)
	i.Mount("POST /v1/payments/wechat/notify", parent.paymentNotify)
	i.Mount("GET /v1/admin/payments", parent.paymentAdminList)
	i.Mount("POST /v1/admin/refunds/{id}/preview", parent.paymentPreview)
	i.Mount("POST /v1/admin/refunds/{id}/decision", parent.paymentDecision)
	i.Mount("GET /ops/finance.js", parent.financeScript)
	i.Mount("GET /ops/api/finance", parent.opsFinance)
	i.Mount("POST /ops/api/finance/preview", parent.opsFinancePreview)
	i.Mount("POST /ops/api/finance/recheck", parent.opsFinanceRecheck)
	i.Mount("POST /ops/api/finance/decision", parent.opsFinanceDecision)
	// No test success control exists when disabled or live. Simulation is labeled and MFA + CSRF protected.
	if s.Mode == "test" {
		i.Mount("POST /ops/api/finance/simulate", parent.opsFinanceSimulate)
	}
}
func (h *HTTP) paymentPlans(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.auth(w, r); !ok {
		return
	}
	v, e := h.Payments.Products(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"items": v, "mode": h.Payments.Mode, "formalSalesEnabled": h.Payments != nil && h.Payments.FormalEnabled})
}
func (h *HTTP) paymentCreate(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	var in struct {
		ProductVersionID string `json:"productVersionId"`
		Channel          string `json:"channel"`
	}
	if !decode(w, r, &in) {
		return
	}
	if (h.Payments.Mode == "test" && in.Channel != "test") || (h.Payments.Mode == "wechat-pilot" && in.Channel != "wechat") || (h.Payments.Mode != "test" && h.Payments.Mode != "wechat-pilot" && !(h.Payments.Mode == "wechat-native" && h.Payments.FormalEnabled)) || (h.Payments.Mode == "wechat-native" && in.Channel != "wechat") {
		fail(w, payments.ErrDisabled)
		return
	}
	v, e := h.Payments.Create(r.Context(), p.ID, r.Header.Get("Idempotency-Key"), in.ProductVersionID)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) paymentOrders(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	v, c, e := h.Payments.Orders(r.Context(), p.ID, r.URL.Query().Get("cursor"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"items": v, "nextCursor": c})
}
func (h *HTTP) paymentOrder(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	v, e := h.Payments.Order(r.Context(), p.ID, r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) paymentQuery(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	if e := h.Payments.Wake(r.Context(), p.ID, r.PathValue("id")); e != nil {
		fail(w, e)
		return
	}
	v, e := h.Payments.Order(r.Context(), p.ID, r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) paymentRefund(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	var in struct {
		AmountFen string `json:"amountFen"`
		Reason    string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	v, e := h.Payments.RequestRefund(r.Context(), p.ID, r.Header.Get("Idempotency-Key"), r.PathValue("id"), in.AmountFen, in.Reason)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) paymentRefunds(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	if _, e := h.Payments.Order(r.Context(), p.ID, r.PathValue("id")); e != nil {
		fail(w, e)
		return
	}
	v, e := h.Payments.Refunds(r.Context(), p.ID, r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"items": v})
}
func (h *HTTP) paymentPeriods(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	v, e := h.Payments.Periods(r.Context(), p.ID)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"items": v})
}
func (h *HTTP) paymentNotify(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.Payments.Provider.(*payments.Wechat)
	if !ok {
		fail(w, payments.ErrDisabled)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	v, e := provider.Notification(r.Context(), r)
	if e == nil {
		if strings.HasPrefix(v.OrderID, "mx") {
			if h.MXPoints == nil {
				e = payments.ErrDisabled
			} else {
				e = h.MXPoints.ApplyPayment(r.Context(), v)
			}
		} else {
			e = h.Payments.ApplyPayment(r.Context(), v)
		}
	}
	if e != nil {
		fail(w, payments.ErrEvidence)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *HTTP) paymentAdminList(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.admin(w, r); !ok {
		return
	}
	rows, e := h.S.Pool.Query(r.Context(), `SELECT id,account_id FROM payment_orders ORDER BY created_at DESC,id DESC LIMIT 100`)
	if e != nil {
		fail(w, e)
		return
	}
	type row struct {
		ID    string
		Owner string
	}
	ids := []row{}
	for rows.Next() {
		var v row
		if e = rows.Scan(&v.ID, &v.Owner); e != nil {
			rows.Close()
			fail(w, e)
			return
		}
		ids = append(ids, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		fail(w, e)
		return
	}
	items := []any{}
	for _, v := range ids {
		o, e := h.Payments.Order(r.Context(), v.Owner, v.ID)
		if e != nil {
			fail(w, e)
			return
		}
		refunds, e := h.Payments.Refunds(r.Context(), v.Owner, v.ID)
		if e != nil {
			fail(w, e)
			return
		}
		evidence := []map[string]any{}
		proofs, e := h.S.Pool.Query(r.Context(), `SELECT id,source,body->>'state',body->>'transactionId',body->>'providerRefundId',body->>'total',body->>'refund' FROM payment_evidence WHERE order_id=$1 ORDER BY created_at DESC LIMIT 20`, o.ID)
		if e != nil {
			fail(w, e)
			return
		}
		for proofs.Next() {
			var id, source, state, txn, provider, total, back string
			if e = proofs.Scan(&id, &source, &state, &txn, &provider, &total, &back); e != nil {
				proofs.Close()
				fail(w, e)
				return
			}
			evidence = append(evidence, map[string]any{"id": id, "source": source, "state": state, "transactionId": txn, "providerRefundId": provider, "totalFen": total, "refundFen": back})
		}
		e = proofs.Err()
		proofs.Close()
		if e != nil {
			fail(w, e)
			return
		}
		jobs := []map[string]any{}
		queue, e := h.S.Pool.Query(r.Context(), `SELECT id,kind,state,attempts,available_at,last_error FROM payment_jobs WHERE order_id=$1 ORDER BY created_at LIMIT 100`, o.ID)
		if e != nil {
			fail(w, e)
			return
		}
		for queue.Next() {
			var id, kind, state, reason string
			var attempts int
			var available time.Time
			if e = queue.Scan(&id, &kind, &state, &attempts, &available, &reason); e != nil {
				queue.Close()
				fail(w, e)
				return
			}
			jobs = append(jobs, map[string]any{"id": id, "kind": kind, "state": state, "attempts": attempts, "availableAt": available.UTC(), "lastError": reason})
		}
		e = queue.Err()
		queue.Close()
		if e != nil {
			fail(w, e)
			return
		}
		items = append(items, map[string]any{"accountId": v.Owner, "order": o, "refunds": refunds, "evidence": evidence, "jobs": jobs})
	}
	var cash, refunds, testCash, testRefunds, netCash string
	var due, manual, alerted int
	e = h.S.Pool.QueryRow(r.Context(), `SELECT COALESCE(sum(amount_fen) FILTER(WHERE NOT test_only AND paid_at IS NOT NULL),0)::text,COALESCE(sum(refunded_fen) FILTER(WHERE NOT test_only),0)::text,COALESCE(sum(amount_fen) FILTER(WHERE test_only AND paid_at IS NOT NULL),0)::text,COALESCE(sum(refunded_fen) FILTER(WHERE test_only),0)::text,(SELECT count(*) FROM payment_jobs WHERE state='pending'),(SELECT count(*) FROM payment_jobs WHERE state='manual'),(SELECT count(*) FROM payment_jobs WHERE alerted_at IS NOT NULL AND state<>'completed'),(COALESCE(sum(amount_fen) FILTER(WHERE NOT test_only AND paid_at IS NOT NULL),0)-COALESCE(sum(refunded_fen) FILTER(WHERE NOT test_only),0))::text FROM payment_orders`).Scan(&cash, &refunds, &testCash, &testRefunds, &due, &manual, &alerted, &netCash)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "mode": h.Payments.Mode, "formalSalesEnabled": h.Payments != nil && h.Payments.FormalEnabled, "cashInFen": cash, "cashRefundedFen": refunds, "syntheticInFen": testCash, "syntheticRefundedFen": testRefunds, "pendingJobs": due, "manualJobs": manual, "alertedJobs": alerted, "netCashFen": netCash, "limitedToLatest": 100})
}
func (h *HTTP) paymentPreview(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.admin(w, r); !ok {
		return
	}
	v, e := h.Payments.Preview(r.Context(), r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) paymentDecision(w http.ResponseWriter, r *http.Request) {
	p, ok := h.admin(w, r)
	if !ok || !operation(w, r) {
		return
	}
	var in struct {
		Decision        string `json:"decision"`
		Reason          string `json:"reason"`
		ExpectedVersion int64  `json:"expectedVersion"`
		OrderVersion    int64  `json:"orderVersion"`
	}
	if !decode(w, r, &in) {
		return
	}
	if r.Header.Get("Idempotency-Key") != r.PathValue("id") {
		fail(w, payments.ErrValidation)
		return
	}
	if e := h.Payments.Decide(r.Context(), p.ID, r.PathValue("id"), in.Decision, in.Reason, in.ExpectedVersion, in.OrderVersion); e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]bool{"accepted": true})
}
func (h *HTTP) opsFinance(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if ok {
		h.paymentAdminList(w, clone)
	}
}
func (h *HTTP) opsFinancePreview(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if !ok {
		return
	}
	var in struct {
		RefundID string `json:"refundId"`
	}
	if !decode(w, clone, &in) {
		return
	}
	clone.SetPathValue("id", in.RefundID)
	h.paymentPreview(w, clone)
}
func (h *HTTP) opsFinanceDecision(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if !ok {
		return
	}
	clone.SetPathValue("id", clone.Header.Get("Idempotency-Key"))
	h.paymentDecision(w, clone)
}
func (h *HTTP) opsFinanceSimulate(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if !ok || !operation(w, clone) {
		return
	}
	var in struct {
		OrderID string `json:"orderId"`
	}
	if !decode(w, clone, &in) {
		return
	}
	if !identifier.MatchString(in.OrderID) || in.OrderID != clone.Header.Get("Idempotency-Key") {
		fail(w, payments.ErrValidation)
		return
	}
	var owner string
	if e := h.S.Pool.QueryRow(r.Context(), `SELECT account_id FROM payment_orders WHERE id=$1 AND test_only AND channel='test' AND state='pending'`, in.OrderID).Scan(&owner); e != nil {
		fail(w, payments.ErrConflict)
		return
	}
	o, e := h.Payments.Order(r.Context(), owner, in.OrderID)
	if e != nil {
		fail(w, e)
		return
	}
	provider, ok := h.Payments.Provider.(*payments.TestProvider)
	if !ok {
		fail(w, payments.ErrDisabled)
		return
	}
	provider.Simulate(o.ID)
	v, e := provider.Query(r.Context(), o)
	if e == nil {
		e = h.Payments.ApplyPayment(r.Context(), v)
	}
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]bool{"syntheticPayment": true})
}
func csvCell(v string) string {
	t := strings.TrimLeft(v, " \t\r\n")
	if strings.HasPrefix(t, "=") || strings.HasPrefix(t, "+") || strings.HasPrefix(t, "-") || strings.HasPrefix(t, "@") {
		return "'" + v
	}
	return v
}
func (h *HTTP) paymentExport(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	} // Bounded, authenticated whitelist. Each page is explicitly exportable.
	v, c, e := h.Payments.Orders(r.Context(), p.ID, r.URL.Query().Get("cursor"))
	if e != nil {
		fail(w, e)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=materialsx-orders.csv")
	if c != nil {
		w.Header().Set("X-Next-Cursor", *c)
	}
	out := csv.NewWriter(w)
	_ = out.Write([]string{"order_id", "product", "test_only", "amount_fen", "currency", "state", "refunded_fen", "created_at"})
	for _, o := range v {
		_ = out.Write([]string{o.ID, csvCell(o.Product.Name), strconv.FormatBool(o.Product.TestOnly), o.AmountFen, o.Currency, o.State, o.RefundedFen, o.Created.UTC().Format("2006-01-02T15:04:05Z")})
	}
	out.Flush()
}

func (h *HTTP) paymentClose(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok || !operation(w, r) {
		return
	}
	if e := h.Payments.Close(r.Context(), p.ID, r.PathValue("id")); e != nil {
		fail(w, e)
		return
	}
	v, e := h.Payments.Order(r.Context(), p.ID, r.PathValue("id"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) opsFinanceRecheck(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if !ok || !operation(w, clone) {
		return
	}
	p, ok := h.admin(w, clone)
	if !ok {
		return
	}
	var in struct {
		OrderID         string `json:"orderId"`
		Reason          string `json:"reason"`
		ExpectedVersion int64  `json:"expectedVersion"`
	}
	if !decode(w, clone, &in) {
		return
	}
	if in.OrderID != clone.Header.Get("Idempotency-Key") {
		fail(w, payments.ErrValidation)
		return
	}
	if e := h.Payments.Recheck(r.Context(), p.ID, in.OrderID, in.Reason, in.ExpectedVersion); e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]bool{"scheduled": true})
}
