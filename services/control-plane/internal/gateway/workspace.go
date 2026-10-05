package gateway

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Controls struct {
	CloudPaused    bool   `json:"cloudPaused"`
	SalesPaused    bool   `json:"salesPaused"`
	AnnouncementZh string `json:"announcementZh"`
	AnnouncementEn string `json:"announcementEn"`
	Version        int64  `json:"version,string"`
}

func (s *Store) Controls(ctx context.Context) (Controls, error) {
	var c Controls
	e := s.Pool.QueryRow(ctx, `SELECT cloud_paused,sales_paused,announcement_zh,announcement_en,version FROM operations_controls WHERE id`).Scan(&c.CloudPaused, &c.SalesPaused, &c.AnnouncementZh, &c.AnnouncementEn, &c.Version)
	return c, e
}
func cloudAdmission(ctx context.Context, tx pgx.Tx) error {
	var paused bool
	if e := tx.QueryRow(ctx, `SELECT cloud_paused FROM operations_controls WHERE id FOR SHARE`).Scan(&paused); e != nil {
		return e
	}
	if paused {
		return ErrUnavailable
	}
	return nil
}
func (h *HTTP) workspaceStatus(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.auth(w, r); !ok {
		return
	}
	c, e := h.S.Controls(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	mode := "disabled"
	if h.Payments != nil {
		mode = h.Payments.Mode
	}
	writeJSON(w, 200, map[string]any{"controls": c, "gatewayConfigured": h.S.Config.Enabled, "gatewayHealth": "not_measured", "protocol": "responses", "routeVersionId": RouteVersion, "modelId": ModelAlias, "upstreamModelId": "gpt-5.6-sol", "providerId": "rootflowai", "paymentMode": mode, "formalSalesEnabled": h.Payments != nil && h.Payments.FormalEnabled, "limits": Limits{MaxRequests: h.S.Config.MaxRequests, MaxOutput: h.S.Config.MaxOutputTokens, MaxDuration: h.S.Config.MaxDurationSeconds}})
}

type TaskBill struct {
	ID       string    `json:"id"`
	State    string    `json:"state"`
	Mode     string    `json:"billingMode"`
	Quality  string    `json:"scientificQuality"`
	Created  time.Time `json:"createdAt"`
	Requests int       `json:"requestCount"`
	Pending  int       `json:"pendingRequests"`
	Held     string    `json:"heldCredits"`
	Charged  string    `json:"chargedCredits"`
	Input    *string   `json:"inputTokens"`
	Output   *string   `json:"outputTokens"`
	Price    *string   `json:"salesPriceVersionId"`
}

func (s *Store) Bills(ctx context.Context, owner, cursor string) ([]TaskBill, *string, error) {
	if cursor != "" && !identifier.MatchString(cursor) {
		return nil, nil, ErrValidation
	}
	rows, e := s.Pool.Query(ctx, `SELECT t.id,t.state,CASE WHEN t.credit_precision=10000 THEN 'paid-credits' WHEN t.sales_price_version_id IS NULL THEN 'alpha-test' ELSE 'test-credits' END,t.created_at,t.sales_price_version_id,
 count(r.id)::integer,count(r.id) FILTER(WHERE r.settlement='reconciliation_pending')::integer,
 COALESCE(sum(c.reserved) FILTER(WHERE c.status IN ('reserved','reconciliation_pending')),0)::text,
 COALESCE(sum(c.charged),0)::text,
 CASE WHEN count(r.id)>0 AND count(r.id)=count((r.usage->>'inputTokens')::bigint) THEN sum((r.usage->>'inputTokens')::bigint)::text END,
 CASE WHEN count(r.id)>0 AND count(r.id)=count((r.usage->>'outputTokens')::bigint) THEN sum((r.usage->>'outputTokens')::bigint)::text END
 FROM research_tasks t LEFT JOIN gateway_requests r ON r.task_id=t.id AND r.account_id=t.account_id LEFT JOIN credit_reservations c ON c.request_id=r.id
 WHERE t.account_id=$1 AND ($2='' OR (t.created_at,t.id)<(SELECT created_at,id FROM research_tasks WHERE id=$2 AND account_id=$1))
 GROUP BY t.id ORDER BY t.created_at DESC,t.id DESC LIMIT 51`, owner, cursor)
	if e != nil {
		return nil, nil, e
	}
	defer rows.Close()
	out := []TaskBill{}
	for rows.Next() {
		var b TaskBill
		b.Quality = "not_evaluated"
		if e = rows.Scan(&b.ID, &b.State, &b.Mode, &b.Created, &b.Price, &b.Requests, &b.Pending, &b.Held, &b.Charged, &b.Input, &b.Output); e != nil {
			return nil, nil, e
		}
		if b.Mode == "paid-credits" {
			for _, v := range []*string{&b.Held, &b.Charged} {
				n, e := metering.Amount(*v)
				if e != nil {
					return nil, nil, e
				}
				*v = metering.Display(n, metering.PaidPrecision)
			}
		}
		b.Created = b.Created.UTC()
		out = append(out, b)
	}
	if e = rows.Err(); e != nil {
		return nil, nil, e
	}
	var next *string
	if len(out) > 50 {
		v := out[49].ID
		next = &v
		out = out[:50]
	}
	return out, next, nil
}
func (h *HTTP) taskBills(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	b, c, e := h.S.Bills(r.Context(), p.ID, r.URL.Query().Get("cursor"))
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"items": b, "nextCursor": c})
}
func (h *HTTP) taskBillsExport(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	b, c, e := h.S.Bills(r.Context(), p.ID, r.URL.Query().Get("cursor"))
	if e != nil {
		fail(w, e)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="materialsx-task-bills.csv"`)
	if c != nil {
		w.Header().Set("X-Next-Cursor", *c)
	}
	out := csv.NewWriter(w)
	_ = out.Write([]string{"task_id", "created_at", "execution", "billing_mode", "requests", "pending_requests", "held_credits", "known_charged_credits", "input_tokens", "output_tokens", "price_version", "scientific_quality"})
	token := func(n *string) string {
		if n == nil {
			return "unknown"
		}
		return *n
	}
	for _, v := range b {
		price := ""
		if v.Price != nil {
			price = *v.Price
		}
		fields := []string{v.ID, v.Created.Format(time.RFC3339Nano), v.State, v.Mode, strconv.Itoa(v.Requests), strconv.Itoa(v.Pending), v.Held, v.Charged, token(v.Input), token(v.Output), price, v.Quality}
		for i := range fields {
			fields[i] = csvCell(fields[i])
		}
		_ = out.Write(fields)
	}
	out.Flush()
}

func (h *HTTP) opsUsers(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if !ok {
		return
	}
	p, ok := h.admin(w, clone)
	if !ok {
		return
	}
	cursor := r.URL.Query().Get("cursor")
	if len(cursor) > 128 {
		fail(w, ErrValidation)
		return
	}
	v, e := h.Identity.S.Users(r.Context(), p, cursor, 51)
	if e != nil {
		fail(w, e)
		return
	}
	var next *string
	if len(v) > 50 {
		x := v[49].ID
		next = &x
		v = v[:50]
	}
	writeJSON(w, 200, map[string]any{"items": v, "nextCursor": next})
}
func (h *HTTP) opsUserStatus(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if !ok || !operation(w, r) {
		return
	}
	p, ok := h.admin(w, clone)
	if !ok {
		return
	}
	var in struct {
		Status  string `json:"status"`
		Reason  string `json:"reason"`
		Version int64  `json:"expectedVersion,string"`
	}
	if !decode(w, r, &in) {
		return
	}
	v, e := h.Identity.S.SetStatus(r.Context(), p, r.PathValue("id"), in.Status, in.Reason, r.Header.Get("Idempotency-Key"), in.Version)
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, v)
}
func (h *HTTP) opsAudit(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if !ok {
		return
	}
	p, ok := h.admin(w, clone)
	if !ok {
		return
	}
	var cursor int64
	raw := r.URL.Query().Get("cursor")
	if raw != "" {
		var e error
		cursor, e = strconv.ParseInt(raw, 10, 64)
		if e != nil || cursor < 1 {
			fail(w, ErrValidation)
			return
		}
	}
	v, e := h.Identity.S.Audit(r.Context(), p, cursor, 101)
	if e != nil {
		fail(w, e)
		return
	}
	var next *string
	if len(v) > 100 {
		x := strconv.FormatInt(v[99].ID, 10)
		next = &x
		v = v[:100]
	}
	writeJSON(w, 200, map[string]any{"items": v, "nextCursor": next})
}
func (h *HTTP) liveAdmin(ctx context.Context, tx pgx.Tx, p identity.Principal) error {
	if !h.Identity.S.AdminAllowed(p) {
		return ErrForbidden
	}
	if e := liveAccount(ctx, tx, p); e != nil {
		return e
	}
	var ok bool
	e := tx.QueryRow(ctx, `SELECT a.role='admin' AND EXISTS(SELECT 1 FROM sessions WHERE id=$2 AND account_id=a.id AND ($3 OR mfa_verified_at>clock_timestamp()-interval '12 hours')) FROM accounts a WHERE a.id=$1`, p.ID, p.SessionID, h.Identity.S.DisableAdminTOTP).Scan(&ok)
	if e != nil {
		return e
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}

// Account lock serializes operation keys. The stored result survives browser timeouts.
func priorOperation(ctx context.Context, tx pgx.Tx, p identity.Principal, key, fp string) (json.RawMessage, error) {
	var old string
	var response []byte
	e := tx.QueryRow(ctx, `SELECT fingerprint,response FROM workspace_operations WHERE actor_id=$1 AND operation_key=$2`, p.ID, key).Scan(&old, &response)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	if old != fp {
		return nil, ErrIdempotency
	}
	return response, nil
}
func recordOperation(ctx context.Context, tx pgx.Tx, p identity.Principal, key, fp, action, target, reason string, response any) error {
	b, e := json.Marshal(response)
	if e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO workspace_operations(actor_id,operation_key,fingerprint,response) VALUES($1,$2,$3,$4)`, p.ID, key, fp, b); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO audit_events(actor_id,action,target_id,result,reason) VALUES($1,$2,$3,'succeeded',$4)`, p.ID, action, target, reason)
	return e
}
func (h *HTTP) opsControls(w http.ResponseWriter, r *http.Request) {
	clone, ok := h.opsAuthorized(w, r)
	if !ok {
		return
	}
	if r.Method == "GET" {
		h.workspaceStatus(w, clone)
		return
	}
	p, ok := h.admin(w, clone)
	if !ok || !operation(w, r) {
		return
	}
	var in struct {
		Controls
		Reason string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Version < 1 || len(strings.TrimSpace(in.Reason)) < 1 || len(in.Reason) > 256 || len([]rune(in.AnnouncementZh)) > 1000 || len([]rune(in.AnnouncementEn)) > 1000 {
		fail(w, ErrValidation)
		return
	}
	tx, e := h.S.Pool.Begin(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if e = h.liveAdmin(r.Context(), tx, p); e != nil {
		fail(w, e)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	fp := fingerprint([]any{"controls", in})
	old, e := priorOperation(r.Context(), tx, p, key, fp)
	if e != nil {
		fail(w, e)
		return
	}
	if old != nil {
		writeJSON(w, 200, old)
		return
	}
	tag, e := tx.Exec(r.Context(), `UPDATE operations_controls SET cloud_paused=$1,sales_paused=$2,announcement_zh=$3,announcement_en=$4,version=version+1 WHERE id AND version=$5`, in.CloudPaused, in.SalesPaused, in.AnnouncementZh, in.AnnouncementEn, in.Version)
	if e == nil && tag.RowsAffected() != 1 {
		e = ErrConflict
	}
	in.Version++
	if e == nil {
		e = recordOperation(r.Context(), tx, p, key, fp, "operations.controls", "singleton", in.Reason, in.Controls)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, in.Controls)
}

// Seven UTC days, independent of the task-history page; unknown usage remains null.
type ActivityDay struct {
	Day         string  `json:"day"`
	Requests    int     `json:"requests"`
	Pending     int     `json:"pendingRequests"`
	Charged     string  `json:"chargedCredits"`
	PaidCharged string  `json:"paidChargedCredits"`
	Input       *string `json:"inputTokens"`
	Output      *string `json:"outputTokens"`
}

func (h *HTTP) activity(w http.ResponseWriter, r *http.Request) {
	p, ok := h.auth(w, r)
	if !ok {
		return
	}
	rows, e := h.S.Pool.Query(r.Context(), `WITH days AS (SELECT generate_series(date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC')-interval '6 days',date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC'),interval '1 day') AS day)
 SELECT to_char(d.day,'YYYY-MM-DD'),count(r.id)::integer,count(r.id) FILTER(WHERE r.settlement='reconciliation_pending')::integer,COALESCE(sum(c.charged) FILTER(WHERE c.precision=1),0)::text,COALESCE(sum(c.charged) FILTER(WHERE c.precision=10000),0)::text,
 CASE WHEN count(r.id)>0 AND count(r.id)=count(r.usage->>'inputTokens') THEN sum((r.usage->>'inputTokens')::bigint)::text END,
 CASE WHEN count(r.id)>0 AND count(r.id)=count(r.usage->>'outputTokens') THEN sum((r.usage->>'outputTokens')::bigint)::text END
 FROM days d LEFT JOIN gateway_requests r ON r.account_id=$1 AND r.created_at >= d.day AT TIME ZONE 'UTC' AND r.created_at < (d.day+interval '1 day') AT TIME ZONE 'UTC' LEFT JOIN credit_reservations c ON c.request_id=r.id
 GROUP BY d.day ORDER BY d.day`, p.ID)
	if e != nil {
		fail(w, e)
		return
	}
	defer rows.Close()
	out := []ActivityDay{}
	for rows.Next() {
		var d ActivityDay
		if e = rows.Scan(&d.Day, &d.Requests, &d.Pending, &d.Charged, &d.PaidCharged, &d.Input, &d.Output); e != nil {
			fail(w, e)
			return
		}
		n, e := metering.Amount(d.PaidCharged)
		if e != nil {
			fail(w, e)
			return
		}
		d.PaidCharged = metering.Display(n, metering.PaidPrecision)
		out = append(out, d)
	}
	if e = rows.Err(); e != nil {
		fail(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"items": out, "timezone": "UTC"})
}
