package metering

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"time"
)

type Store struct{ Pool *pgxpool.Pool }
type Grant struct {
	ID           string    `json:"id"`
	AccountID    string    `json:"accountId"`
	EventID      string    `json:"eventId"`
	Source       string    `json:"source"`
	Credits      string    `json:"credits"`
	ExpiresAt    time.Time `json:"expiresAt"`
	DailyLimit   string    `json:"dailyLimit"`
	MonthlyLimit string    `json:"monthlyLimit"`
}

// Deployment-only grants are test credits, never evidence of a payment.
func (s *Store) Grant(ctx context.Context, g Grant) error {
	n, e := Amount(g.Credits)
	daily, e2 := Amount(g.DailyLimit)
	monthly, e3 := Amount(g.MonthlyLimit)
	if e != nil || e2 != nil || e3 != nil || n < 1 || daily < 1 || monthly < daily || !identifier.MatchString(g.ID) || !identifier.MatchString(g.EventID) || g.Source != "trial" || !g.ExpiresAt.After(time.Now()) || g.ExpiresAt.After(time.Now().Add(366*24*time.Hour)) {
		return ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = lockAccount(ctx, tx, g.AccountID); e != nil {
		return e
	}
	var prior string
	e = tx.QueryRow(ctx, `SELECT fingerprint FROM credit_grants WHERE event_id=$1`, g.EventID).Scan(&prior)
	if e == nil {
		if prior != fingerprint(g) {
			return ErrConflict
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return e
	}
	var total string
	if e = tx.QueryRow(ctx, `SELECT COALESCE(sum(credits),0)::text FROM credit_grants WHERE account_id=$1 AND unit='test-credit'`, g.AccountID).Scan(&total); e != nil {
		return e
	}
	t, e := Amount(total)
	if e != nil || n > int64(^uint64(0)>>1)-t {
		return ErrValidation
	}
	_, e = tx.Exec(ctx, `INSERT INTO credit_grants(id,account_id,source,event_id,fingerprint,credits,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, g.ID, g.AccountID, g.Source, g.EventID, fingerprint(g), n, g.ExpiresAt)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO credit_limits(account_id,daily_limit,monthly_limit) VALUES($1,$2,$3) ON CONFLICT(account_id) DO UPDATE SET daily_limit=$2,monthly_limit=$3`, g.AccountID, daily, monthly)
	if e != nil {
		return e
	}
	if e = entry(ctx, tx, g.AccountID, g.ID, "", g.EventID, "grant", n, 0, 0, "test_credit_grant"); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO audit_events(action,target_id,result,reason) VALUES('billing.test_grant',$1,'succeeded','test credits; no payment')`, g.AccountID)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func lockAccount(ctx context.Context, tx pgx.Tx, owner string) error {
	var id string
	e := tx.QueryRow(ctx, `SELECT id FROM accounts WHERE id=$1 FOR UPDATE`, owner).Scan(&id)
	if errors.Is(e, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return e
}
func entry(ctx context.Context, tx pgx.Tx, owner, grant, request, event, kind string, g, h, c int64, reason string) error {
	_, e := tx.Exec(ctx, `INSERT INTO credit_ledger(account_id,grant_id,request_id,event_id,kind,granted_delta,held_delta,consumed_delta,reason) VALUES($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9)`, owner, grant, request, event, kind, g, h, c, reason)
	return e
}

type Reservation struct {
	RequestID string  `json:"requestId"`
	Reserved  string  `json:"reservedCredits"`
	Charged   *string `json:"chargedCredits"`
	Price     string  `json:"salesPriceVersionId"`
	Status    string  `json:"settlement"`
	Version   int64   `json:"version"`
	Precision int64   `json:"-"`
}

// Caller holds the account and task locks and inserts the request in this transaction.
func ReserveTx(ctx context.Context, tx pgx.Tx, owner, task, request, price, purchase string, max int64, payload map[string]any, output int, deadline time.Time) (Reservation, error) {
	r := Reservation{RequestID: request, Price: price, Status: "reserved", Version: 1}
	if e := lockAccount(ctx, tx, owner); e != nil {
		return r, e
	}
	p, e := PriceTx(ctx, tx, price)
	if e != nil {
		return r, e
	}
	verifiedBounds := []int64{}
	if p.InputPolicy == CountedInputPolicy {
		var input *int64
		var evidence *string
		if e = tx.QueryRow(ctx, `SELECT counted_input_tokens,input_count_evidence FROM gateway_requests WHERE id=$1 AND account_id=$2`, request, owner).Scan(&input, &evidence); e != nil {
			return r, e
		}
		if input == nil || *input < 1 || evidence == nil || *evidence == "" {
			return r, ErrPrice
		}
		verifiedBounds = append(verifiedBounds, *input)
	}
	amount, bound, e := p.Reserve(payload, output, verifiedBounds...)
	if e != nil {
		return r, e
	}
	r.Precision = p.Precision()
	r.Reserved = Display(amount, r.Precision)
	var usage string
	e = tx.QueryRow(ctx, `SELECT COALESCE(sum(CASE WHEN status IN ('reserved','reconciliation_pending') THEN reserved ELSE COALESCE(charged,0) END),0)::text FROM credit_reservations WHERE task_id=$1 AND precision=$2`, task, r.Precision).Scan(&usage)
	if e != nil {
		return r, e
	}
	used, e := Amount(usage)
	if e != nil || amount > max-used {
		return r, ErrBudget
	}
	var daily, monthly int64
	if r.Precision == PaidPrecision {
		e = tx.QueryRow(ctx, `SELECT daily_subunits,monthly_subunits FROM paid_credit_limits WHERE account_id=$1`, owner).Scan(&daily, &monthly)
	} else {
		e = tx.QueryRow(ctx, `SELECT daily_limit,monthly_limit FROM credit_limits WHERE account_id=$1`, owner).Scan(&daily, &monthly)
	}
	if errors.Is(e, pgx.ErrNoRows) {
		return r, ErrBalance
	}
	if e != nil {
		return r, e
	}
	for _, cap := range []struct {
		period string
		limit  int64
	}{{"day", daily}, {"month", monthly}} {
		var current string
		e = tx.QueryRow(ctx, `SELECT COALESCE(sum(CASE WHEN status IN ('reserved','reconciliation_pending') THEN reserved ELSE COALESCE(charged,0) END),0)::text FROM credit_reservations WHERE account_id=$1 AND precision=$3 AND created_at>=date_trunc($2,clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, owner, cap.period, r.Precision).Scan(&current)
		if e != nil {
			return r, e
		}
		v, e := Amount(current)
		if e != nil || amount > cap.limit-v {
			return r, ErrBudget
		}
	}
	query := `SELECT id,credits-consumed-held-refund_frozen-returned FROM credit_grants WHERE account_id=$1 AND unit='test-credit' AND available_at<=clock_timestamp() AND expires_at>clock_timestamp() AND credits>consumed+held+refund_frozen+returned ORDER BY expires_at,created_at,id FOR UPDATE`
	if r.Precision == PaidPrecision {
		query = `SELECT id,((credits::numeric-consumed-held-refund_frozen-returned)*10000-paid_held_subunits-paid_consumed_subunits)::bigint FROM credit_grants WHERE account_id=$1 AND unit='paid-credit' AND available_at<=clock_timestamp() AND expires_at>clock_timestamp() AND (credits::numeric-consumed-held-refund_frozen-returned)*10000>paid_held_subunits+paid_consumed_subunits ORDER BY expires_at,created_at,id FOR UPDATE`
	}
	rows, e := tx.Query(ctx, query, owner)
	if e != nil {
		return r, e
	}
	type allocation struct {
		id string
		n  int64
	}
	alloc := []allocation{}
	remaining := amount
	for rows.Next() {
		var id string
		var available int64
		if e = rows.Scan(&id, &available); e != nil {
			rows.Close()
			return r, e
		}
		if remaining > 0 {
			take := available
			if take > remaining {
				take = remaining
			}
			alloc = append(alloc, allocation{id, take})
			remaining -= take
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return r, e
	}
	if remaining > 0 {
		return r, ErrBalance
	}
	if purchase != "" {
		if _, e = PurchaseTx(ctx, tx, purchase); e != nil {
			return r, e
		}
	}
	_, e = tx.Exec(ctx, `INSERT INTO credit_reservations(request_id,account_id,task_id,sales_price_version_id,purchase_price_version_id,reserved,status,input_bound,output_bound,precision) VALUES($1,$2,$3,$4,NULLIF($5,''),$6,'reserved',$7,$8,$9)`, request, owner, task, price, purchase, amount, bound, output, r.Precision)
	if e != nil {
		return r, e
	}
	for _, a := range alloc {
		heldColumn := "held"
		if r.Precision == PaidPrecision {
			heldColumn = "paid_held_subunits"
		}
		if _, e = tx.Exec(ctx, `UPDATE credit_grants SET `+heldColumn+`=`+heldColumn+`+$2 WHERE id=$1`, a.id, a.n); e != nil {
			return r, e
		}
		if _, e = tx.Exec(ctx, `INSERT INTO reservation_allocations(request_id,grant_id,credits) VALUES($1,$2,$3)`, request, a.id, a.n); e != nil {
			return r, e
		}
		if e = preciseEntry(ctx, tx, owner, a.id, request, "reserve:"+request+":"+a.id, "reserve", 0, a.n, 0, "request_admitted", r.Precision); e != nil {
			return r, e
		}
	}
	_, e = tx.Exec(ctx, `INSERT INTO billing_jobs(request_id,available_at) VALUES($1,$2)`, request, deadline)
	return r, e
}

// SettleTx uses reliable usage or explicit no-call evidence. An unknown outcome retains its entire hold.
// Caller holds account then gateway request locks. Replays never add another ledger entry.
func SettleTx(ctx context.Context, tx pgx.Tx, id string, u *rootflow.Usage, noCall bool, reason string) error {
	var owner, price, status string
	var purchase *string
	var reserved, inputBound, outputBound, precision int64
	var oldFP *string
	e := tx.QueryRow(ctx, `SELECT account_id,sales_price_version_id,purchase_price_version_id,status,reserved,input_bound,output_bound,usage_fingerprint,precision FROM credit_reservations WHERE request_id=$1 FOR UPDATE`, id).Scan(&owner, &price, &purchase, &status, &reserved, &inputBound, &outputBound, &oldFP, &precision)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil
	}
	if e != nil {
		return e
	}
	fp := fingerprint([]any{u, noCall})
	if status == "settled" || status == "released" {
		if oldFP != nil && *oldFP != fp {
			return ErrConflict
		}
		return nil
	}
	charged := int64(0)
	if !noCall {
		if u == nil {
			return pending(ctx, tx, id, "missing_usage")
		}
		p, e := PriceTx(ctx, tx, price)
		if e != nil {
			return e
		}
		charged, e = p.Quote(*u)
		if errors.Is(e, ErrPending) {
			return pending(ctx, tx, id, "missing_usage_component")
		}
		if e != nil {
			return pending(ctx, tx, id, "invalid_usage")
		}
		if *u.Input > inputBound || *u.Output > outputBound || charged > reserved {
			return pending(ctx, tx, id, "usage_exceeds_reservation")
		}
	}
	rows, e := tx.Query(ctx, `SELECT a.grant_id,a.credits FROM reservation_allocations a JOIN credit_grants g ON g.id=a.grant_id WHERE request_id=$1 ORDER BY g.expires_at,g.created_at,g.id`, id)
	if e != nil {
		return e
	}
	type allocation struct {
		id string
		n  int64
	}
	alloc := []allocation{}
	for rows.Next() {
		var a allocation
		if e = rows.Scan(&a.id, &a.n); e != nil {
			rows.Close()
			return e
		}
		alloc = append(alloc, a)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	remaining := charged
	for _, a := range alloc {
		take := a.n
		if take > remaining {
			take = remaining
		}
		remaining -= take
		h, c := "held", "consumed"
		if precision == PaidPrecision {
			h, c = "paid_held_subunits", "paid_consumed_subunits"
		}
		if _, e = tx.Exec(ctx, `UPDATE credit_grants SET `+h+`=`+h+`-$2,`+c+`=`+c+`+$3 WHERE id=$1`, a.id, a.n, take); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `UPDATE reservation_allocations SET charged=$3 WHERE request_id=$1 AND grant_id=$2`, id, a.id, take); e != nil {
			return e
		}
		kind := "settle"
		if noCall {
			kind = "release"
			if reason == "operator_waiver" {
				kind = "waiver"
			}
		}
		if e = preciseEntry(ctx, tx, owner, a.id, id, kind+":"+id+":"+a.id, kind, 0, -a.n, take, reason, precision); e != nil {
			return e
		}
	}
	if remaining != 0 {
		return ErrConflict
	}
	status = "settled"
	if noCall {
		status = "released"
	}
	if _, e = tx.Exec(ctx, `UPDATE credit_reservations SET status=$2,charged=$3,usage_fingerprint=$4,version=version+1 WHERE request_id=$1`, id, status, charged, fp); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `UPDATE gateway_requests SET settlement=$2 WHERE id=$1`, id, status); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `UPDATE billing_jobs SET status='completed',reason=$2 WHERE request_id=$1`, id, reason); e != nil {
		return e
	}
	var cost *int64
	costState := "unknown"
	if !noCall && purchase != nil {
		p, e := PurchaseTx(ctx, tx, *purchase)
		if e != nil {
			return e
		}
		v, e := p.Quote(*u)
		if e == nil {
			cost = &v
			costState = "verified"
		}
	}
	if noCall && reason != "operator_waiver" {
		zero := int64(0)
		cost = &zero
		costState = "verified"
	}
	_, e = tx.Exec(ctx, `INSERT INTO procurement_costs(request_id,purchase_price_version_id,cost_fen,state) VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO NOTHING`, id, purchase, cost, costState)
	return e
}
func pending(ctx context.Context, tx pgx.Tx, id, reason string) error {
	if _, e := tx.Exec(ctx, `UPDATE credit_reservations SET status='reconciliation_pending',version=version+CASE WHEN status<>'reconciliation_pending' THEN 1 ELSE 0 END WHERE request_id=$1`, id); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `UPDATE gateway_requests SET settlement='reconciliation_pending' WHERE id=$1`, id); e != nil {
		return e
	}
	_, e := tx.Exec(ctx, `UPDATE billing_jobs SET status='pending',reason=$2,available_at=LEAST(available_at,clock_timestamp()+interval '1 minute') WHERE request_id=$1 AND status<>'completed'`, id, reason)
	return e
}
func (s *Store) Reservation(ctx context.Context, owner, id string) (Reservation, error) {
	var r Reservation
	var n int64
	var c *int64
	e := s.Pool.QueryRow(ctx, `SELECT request_id,reserved,charged,sales_price_version_id,status,version,precision FROM credit_reservations WHERE account_id=$1 AND request_id=$2`, owner, id).Scan(&r.RequestID, &n, &c, &r.Price, &r.Status, &r.Version, &r.Precision)
	if errors.Is(e, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	r.Reserved = Display(n, r.Precision)
	if c != nil {
		v := Display(*c, r.Precision)
		r.Charged = &v
	}
	return r, e
}

type Wallet struct {
	Unit         string      `json:"unit"`
	Purchased    *PaidWallet `json:"purchased,omitempty"`
	Available    string      `json:"availableCredits"`
	Held         string      `json:"heldCredits"`
	Consumed     string      `json:"consumedCredits"`
	Frozen       string      `json:"refundFrozenCredits"`
	Returned     string      `json:"returnedCredits"`
	Pending      int         `json:"pendingRequests"`
	DailyLimit   *string     `json:"dailyLimit"`
	MonthlyLimit *string     `json:"monthlyLimit"`
}

func (s *Store) Wallet(ctx context.Context, owner string) (Wallet, error) {
	w := Wallet{Unit: "test-credit"}
	e := s.Pool.QueryRow(ctx, `SELECT COALESCE(sum(CASE WHEN available_at<=clock_timestamp() AND expires_at>clock_timestamp() THEN credits-consumed-held-refund_frozen-returned ELSE 0 END),0)::text,COALESCE(sum(held),0)::text,COALESCE(sum(consumed),0)::text,COALESCE(sum(refund_frozen),0)::text,COALESCE(sum(returned),0)::text,(SELECT count(*) FROM credit_reservations WHERE account_id=$1 AND status='reconciliation_pending'),(SELECT daily_limit::text FROM credit_limits WHERE account_id=$1),(SELECT monthly_limit::text FROM credit_limits WHERE account_id=$1) FROM credit_grants WHERE account_id=$1 AND unit='test-credit'`, owner).Scan(&w.Available, &w.Held, &w.Consumed, &w.Frozen, &w.Returned, &w.Pending, &w.DailyLimit, &w.MonthlyLimit)
	if e != nil {
		return w, e
	}
	paid := &PaidWallet{Unit: "paid-credit"}
	e = s.Pool.QueryRow(ctx, `SELECT COALESCE(sum(CASE WHEN available_at<=clock_timestamp() AND expires_at>clock_timestamp() THEN (credits::numeric-consumed-held-refund_frozen-returned)*10000-paid_held_subunits-paid_consumed_subunits ELSE 0 END),0)::text,COALESCE(sum(held::numeric*10000+paid_held_subunits),0)::text,COALESCE(sum(consumed::numeric*10000+paid_consumed_subunits),0)::text,COALESCE(sum(refund_frozen::numeric*10000),0)::text,COALESCE(sum(returned::numeric*10000),0)::text FROM credit_grants WHERE account_id=$1 AND unit='paid-credit'`, owner).Scan(&paid.Available, &paid.Held, &paid.Consumed, &paid.Frozen, &paid.Returned)
	if e == nil {
		for _, v := range []*string{&paid.Available, &paid.Held, &paid.Consumed, &paid.Frozen, &paid.Returned} {
			*v, e = displayText(*v, PaidPrecision)
			if e != nil {
				return w, e
			}
		}
	}
	w.Purchased = paid
	return w, e
}

type PaidWallet struct {
	Unit      string `json:"unit"`
	Available string `json:"availableCredits"`
	Held      string `json:"heldCredits"`
	Consumed  string `json:"consumedCredits"`
	Frozen    string `json:"refundFrozenCredits"`
	Returned  string `json:"returnedCredits"`
}

type Entry struct {
	Unit      string    `json:"unit"`
	ID        string    `json:"id"`
	RequestID *string   `json:"requestId"`
	Kind      string    `json:"kind"`
	GrantID   string    `json:"grantId"`
	Granted   string    `json:"grantedDelta"`
	Held      string    `json:"heldDelta"`
	Consumed  string    `json:"consumedDelta"`
	Frozen    string    `json:"frozenDelta"`
	Returned  string    `json:"returnedDelta"`
	Created   time.Time `json:"createdAt"`
}

func (s *Store) Ledger(ctx context.Context, owner, cursor string) ([]Entry, *string, error) {
	after := int64(0)
	var e error
	if cursor != "" {
		after, e = Amount(cursor)
		if e != nil {
			return nil, nil, e
		}
	}
	rows, e := s.Pool.Query(ctx, `SELECT id::text,request_id,kind,grant_id,granted_delta::text,held_delta::text,consumed_delta::text,frozen_delta::text,returned_delta::text,created_at,(SELECT unit FROM credit_grants g WHERE g.id=credit_ledger.grant_id),precision FROM credit_ledger WHERE account_id=$1 AND id>$2 ORDER BY id LIMIT 101`, owner, after)
	if e != nil {
		return nil, nil, e
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		var v Entry
		var precision int64
		if e = rows.Scan(&v.ID, &v.RequestID, &v.Kind, &v.GrantID, &v.Granted, &v.Held, &v.Consumed, &v.Frozen, &v.Returned, &v.Created, &v.Unit, &precision); e != nil {
			return nil, nil, e
		}
		for _, d := range []*string{&v.Granted, &v.Held, &v.Consumed, &v.Frozen, &v.Returned} {
			*d, e = displayText(*d, precision)
			if e != nil {
				return nil, nil, e
			}
		}
		v.Created = v.Created.UTC()
		items = append(items, v)
	}
	var next *string
	if len(items) > 100 {
		v := items[99].ID
		next = &v
		items = items[:100]
	}
	return items, next, rows.Err()
}

// Verify rebuilds all balances from immutable entries under a consistent snapshot.
func (s *Store) Verify(ctx context.Context) (int, error) {
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return 0, e
	}
	defer tx.Rollback(ctx)
	var bad, n int
	e = tx.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE credits<>COALESCE(g,0) OR held<>COALESCE(h,0) OR consumed<>COALESCE(c,0) OR refund_frozen<>COALESCE(f,0) OR returned<>COALESCE(r,0)) FROM credit_grants b LEFT JOIN (SELECT grant_id,sum(granted_delta) g,sum(held_delta) h,sum(consumed_delta) c,sum(frozen_delta) f,sum(returned_delta) r FROM credit_ledger WHERE precision=1 GROUP BY grant_id) l ON l.grant_id=b.id`).Scan(&n, &bad)
	if e != nil {
		return n, e
	}
	var allocationBad int
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM credit_grants g LEFT JOIN (SELECT grant_id,sum(CASE WHEN r.status IN ('reserved','reconciliation_pending') THEN a.credits ELSE 0 END) h,sum(a.charged) c FROM reservation_allocations a JOIN credit_reservations r USING(request_id) WHERE r.precision=1 GROUP BY grant_id) a ON a.grant_id=g.id WHERE g.held<>COALESCE(a.h,0) OR g.consumed<>COALESCE(a.c,0)`).Scan(&allocationBad); e != nil {
		return n, e
	}
	var refundBad int
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM credit_grants g LEFT JOIN (SELECT o.grant_id,sum(CASE WHEN r.execution IN ('not_started','submitting','pending') AND r.approval='approved' THEN r.frozen_credits ELSE 0 END) f,sum(CASE WHEN r.execution='succeeded' THEN r.frozen_credits ELSE 0 END) b FROM payment_refunds r JOIN payment_orders o ON o.id=r.order_id GROUP BY o.grant_id) q ON q.grant_id=g.id WHERE g.refund_frozen<>COALESCE(q.f,0) OR g.returned<>COALESCE(q.b,0)`).Scan(&refundBad); e != nil {
		return n, e
	}
	var paidBad int
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM credit_grants g LEFT JOIN (SELECT grant_id,sum(held_delta) h,sum(consumed_delta) c FROM credit_ledger WHERE precision=10000 GROUP BY grant_id) l ON l.grant_id=g.id LEFT JOIN (SELECT grant_id,sum(CASE WHEN r.status IN ('reserved','reconciliation_pending') THEN a.credits ELSE 0 END) h,sum(a.charged) c FROM reservation_allocations a JOIN credit_reservations r USING(request_id) WHERE r.precision=10000 GROUP BY grant_id) a ON a.grant_id=g.id WHERE g.paid_held_subunits<>COALESCE(l.h,0) OR g.paid_consumed_subunits<>COALESCE(l.c,0) OR g.paid_held_subunits<>COALESCE(a.h,0) OR g.paid_consumed_subunits<>COALESCE(a.c,0)`).Scan(&paidBad); e != nil {
		return n, e
	}
	if bad > 0 || allocationBad > 0 || refundBad > 0 || paidBad > 0 {
		return n, fmt.Errorf("ledger_verification_failed")
	}
	return n, tx.Commit(ctx)
}

func preciseEntry(ctx context.Context, tx pgx.Tx, owner, grant, request, event, kind string, g, h, c int64, reason string, precision int64) error {
	_, e := tx.Exec(ctx, `INSERT INTO credit_ledger(account_id,grant_id,request_id,event_id,kind,granted_delta,held_delta,consumed_delta,reason,precision) VALUES($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10)`, owner, grant, request, event, kind, g, h, c, reason, precision)
	return e
}
