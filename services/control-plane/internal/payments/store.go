package payments

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"time"
)

type Store struct {
	Pool          *pgxpool.Pool
	Mode          string
	Provider      Provider
	Merchant      string
	PilotAccount  string
	AppID         string
	FormalEnabled bool
	ApprovalsPath string
}

func PutProduct(ctx context.Context, tx pgx.Tx, p Product) error {
	if e := p.Validate(); e != nil {
		return e
	}
	b, _ := json.Marshal(p)
	var prior string
	e := tx.QueryRow(ctx, `INSERT INTO payment_products(id,body,fingerprint) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING fingerprint`, p.ID, b, fp(p)).Scan(&prior)
	if errors.Is(e, pgx.ErrNoRows) {
		e = tx.QueryRow(ctx, `SELECT fingerprint FROM payment_products WHERE id=$1`, p.ID).Scan(&prior)
	}
	if e != nil {
		return e
	}
	if prior != fp(p) {
		return ErrConflict
	}
	return nil
}
func (s *Store) Products(ctx context.Context) ([]Product, error) {
	rows, e := s.Pool.Query(ctx, `SELECT body FROM payment_products ORDER BY created_at,id LIMIT 100`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Product{}
	for rows.Next() {
		var b []byte
		var p Product
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &p); e != nil {
			return nil, e
		}
		if p == PilotDiagnosticPack() {
			continue
		}
		if s.Mode == "wechat-pilot" && p != PilotSubscription() {
			continue
		}
		if s.Mode == "wechat-native" && (p.TestOnly || p.RefundRule != "unused-full-v1" || !s.FormalEnabled) {
			continue
		}
		if s.Mode == "test" && !p.TestOnly {
			continue
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func scanOrder(row pgx.Row) (Order, error) {
	var o Order
	var b []byte
	e := row.Scan(&o.ID, &b, &o.AmountFen, &o.Currency, &o.Channel, &o.State, &o.Checkout, &o.CodeURL, &o.RefundedFen, &o.Version, &o.Created, &o.Expires, &o.PaidAt, &o.CloseRequested)
	if errors.Is(e, pgx.ErrNoRows) {
		return o, ErrNotFound
	}
	if e == nil {
		o.Created = o.Created.UTC()
		o.Expires = o.Expires.UTC()
		if o.PaidAt != nil {
			v := o.PaidAt.UTC()
			o.PaidAt = &v
		}
		e = json.Unmarshal(b, &o.Product)
	}
	return o, e
}

const orderColumns = `id,snapshot,amount_fen::text,currency,channel,state,checkout_state,code_url,refunded_fen::text,version,created_at,expires_at,paid_at,close_requested`

func (s *Store) Order(ctx context.Context, owner, id string) (Order, error) {
	return scanOrder(s.Pool.QueryRow(ctx, `SELECT `+orderColumns+` FROM payment_orders WHERE account_id=$1 AND id=$2`, owner, id))
}
func (s *Store) Orders(ctx context.Context, owner, cursor string) ([]Order, *string, error) {
	if cursor != "" && !identifier.MatchString(cursor) {
		return nil, nil, ErrValidation
	}
	rows, e := s.Pool.Query(ctx, `SELECT id FROM payment_orders WHERE account_id=$1 AND ($2='' OR (created_at,id)<(SELECT created_at,id FROM payment_orders WHERE id=$2 AND account_id=$1)) ORDER BY created_at DESC,id DESC LIMIT 51`, owner, cursor)
	if e != nil {
		return nil, nil, e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return nil, nil, e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, nil, e
	}
	var next *string
	if len(ids) > 50 {
		v := ids[49]
		next = &v
		ids = ids[:50]
	}
	out := []Order{}
	for _, id := range ids {
		o, e := s.Order(ctx, owner, id)
		if e != nil {
			return nil, nil, e
		}
		out = append(out, o)
	}
	return out, next, nil
}
func accountLock(ctx context.Context, tx pgx.Tx, owner string) error {
	var status string
	e := tx.QueryRow(ctx, `SELECT status FROM accounts WHERE id=$1 FOR UPDATE`, owner).Scan(&status)
	if e != nil {
		return ErrNotFound
	}
	if status != "active" {
		return ErrDisabled
	}
	return nil
}
func (s *Store) Create(ctx context.Context, owner, key, product string) (Order, error) {
	if (s.Mode != "test" && !(s.Mode == "wechat-native" && s.FormalEnabled) && (s.Mode != "wechat-pilot" || owner != s.PilotAccount || owner == "")) || s.Provider == nil {
		return Order{}, ErrDisabled
	}
	if s.Mode == "wechat-native" {
		a, err := lifecycle.ReadApprovals(s.ApprovalsPath, "rootflow-sol-responses-2026-10-01-v1")
		if err != nil || len(a.Missing(time.Now().UTC())) > 0 {
			return Order{}, ErrDisabled
		}
	}
	if !identifier.MatchString(key) || !identifier.MatchString(product) {
		return Order{}, ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Order{}, e
	}
	defer tx.Rollback(ctx)
	if e = accountLock(ctx, tx, owner); e != nil {
		return Order{}, e
	}
	fingerprint := fp([]string{product, s.Mode})
	var old, prior string
	e = tx.QueryRow(ctx, `SELECT id,fingerprint FROM payment_orders WHERE account_id=$1 AND idempotency_key=$2`, owner, key).Scan(&old, &prior)
	if e == nil {
		if prior != fingerprint {
			return Order{}, ErrConflict
		}
		if e = tx.Commit(ctx); e != nil {
			return Order{}, e
		}
		return s.Order(ctx, owner, old)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return Order{}, e
	}
	var paused bool
	if e = tx.QueryRow(ctx, `SELECT sales_paused FROM operations_controls WHERE id FOR SHARE`).Scan(&paused); e != nil {
		return Order{}, e
	}
	if paused {
		return Order{}, ErrDisabled
	}
	var count int
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM payment_orders WHERE account_id=$1 AND state='pending'`, owner).Scan(&count); e != nil {
		return Order{}, e
	}
	if count >= 3 {
		return Order{}, ErrConflict
	}
	var b []byte
	if e = tx.QueryRow(ctx, `SELECT body FROM payment_products WHERE id=$1`, product).Scan(&b); e != nil {
		return Order{}, ErrNotFound
	}
	var p Product
	if json.Unmarshal(b, &p) != nil || p.Validate() != nil {
		return Order{}, ErrValidation
	}
	channel, reason := "test", "test order; no real payment"
	if s.Mode == "wechat-native" {
		var admitted bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM beta_enrollments WHERE account_id=$1 AND state='active')`, owner).Scan(&admitted); e != nil {
			return Order{}, e
		}
		if !admitted || p.TestOnly || p.RefundRule != "unused-full-v1" {
			return Order{}, ErrDisabled
		}
		channel, reason = "wechat", "approved enrolled beta order"
	}
	if s.Mode == "wechat-pilot" {
		if p != PilotSubscription() {
			return Order{}, ErrDisabled
		}
		var used int64
		if e = tx.QueryRow(ctx, `SELECT COALESCE(sum(amount_fen),0) FROM payment_orders WHERE account_id=$1 AND channel='wechat' AND product_id=$2`, owner, p.ID).Scan(&used); e != nil {
			return Order{}, e
		}
		// This pilot authorizes exactly one 100-fen purchase, including ambiguous attempts.
		if used != 0 {
			return Order{}, ErrDisabled
		}
		channel, reason = "wechat", "authorized one-yuan real payment pilot"
	} else if s.Mode != "wechat-native" && !p.TestOnly {
		return Order{}, ErrDisabled
	}
	n, _ := metering.Amount(p.PriceFen)
	id := newID()
	_, e = tx.Exec(ctx, `INSERT INTO payment_orders(id,account_id,idempotency_key,fingerprint,product_id,snapshot,amount_fen,currency,test_only,channel,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'CNY',$8,$9,clock_timestamp()+interval '20 minutes');`, id, owner, key, fingerprint, product, b, n, p.TestOnly, channel)
	if e != nil {
		return Order{}, e
	}
	if _, e = tx.Exec(ctx, `INSERT INTO payment_jobs(id,order_id,kind) VALUES($1,$1,'order')`, id); e != nil {
		return Order{}, e
	}
	if e = audit(ctx, tx, owner, "payment.order_create", id, reason); e != nil {
		return Order{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Order{}, e
	}
	return s.Order(ctx, owner, id)
}
func audit(ctx context.Context, tx pgx.Tx, actor, action, target, reason string) error {
	_, e := tx.Exec(ctx, `INSERT INTO audit_events(actor_id,action,target_id,result,reason) VALUES(NULLIF($1,''),$2,$3,'succeeded',$4)`, actor, action, target, reason)
	return e
}
func (s *Store) transaction(ctx context.Context, id string, fn func(pgx.Tx, string, Order) error) error {
	var owner string
	if e := s.Pool.QueryRow(ctx, `SELECT account_id FROM payment_orders WHERE id=$1`, id).Scan(&owner); e != nil {
		return ErrNotFound
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx) // Existing verified payments/refunds must still settle when an account is suspended.
	var locked string
	if e = tx.QueryRow(ctx, `SELECT id FROM accounts WHERE id=$1 FOR UPDATE`, owner).Scan(&locked); e != nil {
		return e
	}
	o, e := scanOrder(tx.QueryRow(ctx, `SELECT `+orderColumns+` FROM payment_orders WHERE id=$1 FOR UPDATE`, id))
	if e != nil {
		return e
	}
	if e = fn(tx, owner, o); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) evidence(ctx context.Context, tx pgx.Tx, o Order, v Evidence) error {
	total, _ := metering.Amount(o.AmountFen)
	if v.OrderID != o.ID || !(v.Total == total && v.Currency == "CNY" || v.AmountlessClose()) || v.Merchant != s.Merchant || v.AppID != s.AppID || !identifier.MatchString(v.ID) || (v.Source != "query" && v.Source != "notification" && v.Source != "test") || (o.Channel == "test") != (v.Source == "test") {
		return ErrEvidence
	}
	b, _ := json.Marshal(v)
	var prior string
	e := tx.QueryRow(ctx, `SELECT fingerprint FROM payment_evidence WHERE id=$1`, v.ID).Scan(&prior)
	if e == nil {
		if prior != fp(v) {
			return ErrEvidence
		}
		return nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO payment_evidence(id,fingerprint,order_id,refund_id,source,body) VALUES($1,$2,$3,NULLIF($4,''),$5,$6)`, v.ID, fp(v), o.ID, v.RefundID, v.Source, b)
	return e
}
func (s *Store) ApplyPayment(ctx context.Context, v Evidence) error {
	return s.transaction(ctx, v.OrderID, func(tx pgx.Tx, owner string, o Order) error {
		if v.RefundID != "" {
			return ErrEvidence
		}
		if e := s.evidence(ctx, tx, o, v); e != nil {
			return e
		}
		if v.State == "NOTPAY" || v.State == "USERPAYING" {
			return nil
		}
		if v.State == "CLOSED" {
			if o.State != "pending" {
				return nil
			}
			_, e := tx.Exec(ctx, `UPDATE payment_orders SET state='closed',version=version+1 WHERE id=$1;`, o.ID)
			if e != nil {
				return e
			}
			_, e = tx.Exec(ctx, `UPDATE payment_jobs SET state='completed' WHERE id=$1`, o.ID)
			return e
		}
		if v.State != "SUCCESS" || !identifier.MatchString(v.TransactionID) || v.PaidAt.IsZero() || v.PaidAt.After(time.Now().Add(5*time.Minute)) {
			return ErrEvidence
		}
		var prior *string
		if e := tx.QueryRow(ctx, `SELECT transaction_id FROM payment_orders WHERE id=$1`, o.ID).Scan(&prior); e != nil {
			return e
		}
		if prior != nil {
			if *prior != v.TransactionID {
				return ErrEvidence
			}
			return nil
		} // A late verified payment is accounted even after local expiry; never drop received money.
		credits, _ := metering.Amount(o.Product.Credits)
		var sum string
		if e := tx.QueryRow(ctx, `SELECT COALESCE(sum(credits),0)::text FROM credit_grants WHERE account_id=$1 AND unit=$2`, owner, paymentUnit(o)).Scan(&sum); e != nil {
			return e
		}
		t, e := metering.Amount(sum)
		limit := int64(^uint64(0) >> 1)
		if paymentUnit(o) == "paid-credit" {
			limit /= metering.PaidPrecision
		}
		if e != nil || t > limit || credits > limit-t {
			return ErrConflict
		}
		start := v.PaidAt.UTC()
		end := start.Add(time.Duration(o.Product.ValidDays) * 24 * time.Hour)
		if o.Product.Kind == "subscription" {
			anchor := start.Day()
			var last time.Time
			var oldAnchor int
			e = tx.QueryRow(ctx, `SELECT p.ends_at,p.anchor_day FROM subscription_periods p JOIN payment_orders o ON o.id=p.order_id WHERE p.account_id=$1 AND p.state='active' AND o.channel=$2 ORDER BY p.ends_at DESC LIMIT 1`, owner, o.Channel).Scan(&last, &oldAnchor)
			if e != nil && !errors.Is(e, pgx.ErrNoRows) {
				return e
			}
			if e == nil && last.After(start) {
				start = last
				anchor = oldAnchor
			}
			end = nextMonth(start, anchor)
			if _, e = tx.Exec(ctx, `INSERT INTO subscription_periods(order_id,account_id,product_id,starts_at,ends_at,anchor_day) VALUES($1,$2,$3,$4,$5,$6)`, o.ID, owner, o.Product.ID, start, end, anchor); e != nil {
				return e
			}
		}
		grant := "pay:" + o.ID
		event := "paid:" + o.ID
		if _, e = tx.Exec(ctx, `INSERT INTO credit_grants(id,account_id,source,event_id,fingerprint,credits,available_at,expires_at,unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, grant, owner, o.Product.Kind, event, fp(v), credits, start, end, paymentUnit(o)); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `INSERT INTO credit_ledger(account_id,grant_id,event_id,kind,granted_delta,reason) VALUES($1,$2,$3,'grant',$4,$5)`, owner, grant, event, credits, "verified "+o.Channel+" payment ("+paymentUnit(o)+")"); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `UPDATE payment_orders SET state='paid',transaction_id=$2,paid_at=$3,grant_id=$4,version=version+1 WHERE id=$1`, o.ID, v.TransactionID, v.PaidAt, grant); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `UPDATE payment_jobs SET state='completed' WHERE id=$1`, o.ID); e != nil {
			return e
		}
		if o.Channel == "wechat" && o.Product.RefundRule == "unused-full-v1" {
			if _, e = tx.Exec(ctx, `SELECT activate_paid_limits($1)`, o.ID); e != nil {
				return e
			}
		}
		if o.Channel == "test" {
			if _, e = tx.Exec(ctx, `SELECT activate_test_payment($1)`, o.ID); e != nil {
				return e
			}
		}
		return audit(ctx, tx, "", "payment.verified", o.ID, v.Source)
	})
}
func (s *Store) Periods(ctx context.Context, owner string) ([]Period, error) {
	rows, e := s.Pool.Query(ctx, `SELECT order_id,product_id,starts_at,ends_at,CASE WHEN p.state='canceled' THEN 'canceled' WHEN a.status<>'active' THEN 'suspended' WHEN ends_at<=clock_timestamp() THEN 'expired' WHEN starts_at>clock_timestamp() THEN 'pending' ELSE 'active' END FROM subscription_periods p JOIN accounts a ON a.id=p.account_id WHERE account_id=$1 ORDER BY starts_at DESC LIMIT 100`, owner)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Period{}
	for rows.Next() {
		var p Period
		if e = rows.Scan(&p.OrderID, &p.ProductID, &p.Starts, &p.Ends, &p.State); e != nil {
			return nil, e
		}
		p.Starts = p.Starts.UTC()
		p.Ends = p.Ends.UTC()
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) Close(ctx context.Context, owner, id string) error {
	return s.transaction(ctx, id, func(tx pgx.Tx, account string, o Order) error {
		if account != owner {
			return ErrNotFound
		}
		if o.State != "pending" {
			return ErrConflict
		}
		if o.CloseRequested {
			return nil
		}
		if _, e := tx.Exec(ctx, `UPDATE payment_orders SET close_requested=true,version=version+1 WHERE id=$1`, id); e != nil {
			return e
		}
		if _, e := tx.Exec(ctx, `UPDATE payment_jobs SET available_at=clock_timestamp() WHERE id=$1 AND state='pending'`, id); e != nil {
			return e
		}
		return audit(ctx, tx, owner, "payment.close_requested", id, "channel verification required")
	})
}
func (s *Store) Recheck(ctx context.Context, actor, id, reason string, version int64) error {
	if len(reason) < 1 || len(reason) > 256 {
		return ErrValidation
	}
	return s.transaction(ctx, id, func(tx pgx.Tx, _ string, o Order) error {
		if o.Version != version || (o.State != "pending" && o.State != "refund_pending") {
			return ErrConflict
		}
		if _, e := tx.Exec(ctx, `UPDATE payment_jobs SET state='pending',available_at=clock_timestamp(),last_error='operator_recheck' WHERE order_id=$1 AND state IN ('manual','pending')`, id); e != nil {
			return e
		}
		return audit(ctx, tx, actor, "payment.recheck", id, reason)
	})
}
