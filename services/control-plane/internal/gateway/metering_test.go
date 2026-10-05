package gateway

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testPrice() metering.Price {
	return metering.Price{ID: "test-sales-v1", Model: ModelAlias, Route: RouteVersion, TestOnly: true, Unit: "test-credit", Tiers: []metering.Tier{{MinInput: 0, Input: "1000000", Cached: "1000000", Output: "1000000"}}, MaxInput: 100000, InputPolicy: "utf8-byte-test-estimate-v1", Evidence: "synthetic-fixture"}
}
func metered(t *testing.T) (*Store, identity.Principal, *metering.Store) {
	t.Helper()
	pool := poolFixture(t)
	ctx := context.Background()
	ident, e := identity.New(pool, make([]byte, 32))
	if e != nil {
		t.Fatal(e)
	}
	p, _ := principal(t, ident)
	s := &Store{Pool: pool, Config: Config{Enabled: true, MaxRequests: 16, MaxOutputTokens: 1024, MaxDurationSeconds: 180, MaxConcurrent: 8, SalesPriceVersion: "test-sales-v1"}}
	tx, _ := pool.Begin(ctx)
	defer tx.Rollback(ctx)
	if e = metering.PutPrice(ctx, tx, testPrice()); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	if e = s.Grant(ctx, p.ID, 10000, time.Now().Add(time.Hour)); e != nil {
		t.Fatal(e)
	}
	return s, p, &metering.Store{Pool: pool}
}
func grantCredits(t *testing.T, m *metering.Store, p identity.Principal, id, credits string, expires time.Time) {
	t.Helper()
	if e := m.Grant(context.Background(), metering.Grant{ID: id, AccountID: p.ID, EventID: id, Source: "trial", Credits: credits, ExpiresAt: expires, DailyLimit: "1000000", MonthlyLimit: "1000000"}); e != nil {
		t.Fatal(e)
	}
}
func meteredTask(t *testing.T, s *Store, p identity.Principal, max string) Task {
	t.Helper()
	in := taskInput()
	in.Mode = "test-credits"
	in.Budget.MaxCredits = max
	task, e := s.Create(context.Background(), p, in, newID())
	if e != nil {
		t.Fatal(e)
	}
	return task
}
func i64(n int64) *int64 { return &n }
func TestMeteredLifecycleAndRecovery(t *testing.T) {
	s, p, m := metered(t)
	ctx := context.Background()
	grantCredits(t, m, p, "soon", "1000", time.Now().Add(time.Hour))
	grantCredits(t, m, p, "later", "1000", time.Now().Add(2*time.Hour))
	task := meteredTask(t, s, p, "2000")
	id := newID()
	r, _, e := s.Claim(ctx, p, task.ID, id, id, native())
	if e != nil || r.Settlement != "reserved" || r.Mode != "test-credits" {
		t.Fatalf("claim %v %v", r, e)
	}
	var held int64
	s.Pool.QueryRow(ctx, `SELECT held FROM credit_grants WHERE id='soon'`).Scan(&held)
	if held == 0 {
		t.Fatal("did not select first expiry")
	}
	if e = s.Dispatched(ctx, id); e != nil {
		t.Fatal(e)
	}
	u := &rootflow.Usage{Source: "responses", Input: i64(10), Output: i64(4), Cached: i64(2), Uncached: i64(8), Reasoning: i64(1)}
	if e = s.Finish(ctx, id, "completed", "", 200, true, u); e != nil {
		t.Fatal(e)
	}
	if e = s.Finish(ctx, id, "completed", "", 200, true, u); e != nil {
		t.Fatal(e)
	}
	r, e = s.Request(ctx, p.ID, id)
	if e != nil || r.Charged == nil || *r.Charged != "14" || r.Settlement != "settled" {
		t.Fatalf("settle %v %v", r, e)
	}
	id2 := newID()
	if _, _, e = s.Claim(ctx, p, task.ID, id2, id2, native()); e != nil {
		t.Fatal(e)
	}
	s.Dispatched(ctx, id2)
	if e = s.Finish(ctx, id2, "unknown", "STREAM_INTERRUPTED", 0, false, nil); e != nil {
		t.Fatal(e)
	}
	w, e := m.Wallet(ctx, p.ID)
	if e != nil || w.Held == "0" || w.Pending != 1 {
		t.Fatalf("pending %v %v", w, e)
	}
	s.Pool.Exec(ctx, `UPDATE billing_jobs SET created_at=clock_timestamp()-interval '73 hours',available_at=clock_timestamp()-interval '1 second' WHERE request_id=$1`, id2)
	if _, e = m.Tick(ctx, 100); e != nil {
		t.Fatal(e)
	}
	pending, e := m.Pending(ctx)
	if e != nil || len(pending) != 1 || pending[0].JobStatus != "manual" || pending[0].Alerted == nil {
		t.Fatalf("recovery %v %v", pending, e)
	}
	w2, _ := m.Wallet(ctx, p.ID)
	if w.Held != w2.Held {
		t.Fatal("TTL refunded uncertain call")
	}
	evidence := metering.Evidence{RequestID: id2, ExpectedVersion: pending[0].Version, Resolution: "usage", SourceRef: "fixture-bill-1", Reason: "Synthetic reconciled usage", Usage: u}
	preview, e := m.Preview(ctx, evidence)
	if e != nil || preview.Charged != "14" {
		t.Fatal("preview", e)
	}
	if e = m.Reconcile(ctx, p.ID, evidence); e != nil {
		t.Fatal(e)
	}
	if e = m.Reconcile(ctx, p.ID, evidence); e != nil {
		t.Fatal(e)
	}
	evidence.SourceRef = "different"
	if e = m.Reconcile(ctx, p.ID, evidence); !errors.Is(e, metering.ErrConflict) {
		t.Fatal("changed evidence accepted")
	}
	r, _ = s.Request(ctx, p.ID, id2)
	if r.Execution != "unknown" || r.Settlement != "settled" || r.Usage == nil || r.Usage.Input == nil || r.Terminal {
		t.Fatal("reconciliation fabricated execution success")
	}
	w, _ = m.Wallet(ctx, p.ID)
	if w.Held != "0" || w.Consumed != "28" {
		t.Fatalf("wallet %v", w)
	}
	if _, e = m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE credit_ledger SET reason='tamper'`); e == nil {
		t.Fatal("mutable ledger")
	}
	tx, _ := s.Pool.Begin(ctx)
	defer tx.Rollback(ctx)
	price := testPrice()
	price.Tiers[0].Input = "2000000"
	if e = metering.PutPrice(ctx, tx, price); !errors.Is(e, metering.ErrConflict) {
		t.Fatal("mutable price")
	}
	tx.Rollback(ctx)
}
func TestOneHundredConcurrentReservations(t *testing.T) {
	s, p, m := metered(t)
	ctx := context.Background()
	price := testPrice()
	price.Tiers[0] = metering.Tier{Input: "1", Cached: "1", Output: "1"}
	price.ID = "small-test"
	tx, _ := s.Pool.Begin(ctx)
	defer tx.Rollback(ctx)
	if e := metering.PutPrice(ctx, tx, price); e != nil {
		t.Fatal(e)
	}
	tx.Commit(ctx)
	s.Config.SalesPriceVersion = price.ID
	grantCredits(t, m, p, "sixty", "60", time.Now().Add(time.Hour))
	task := meteredTask(t, s, p, "1000000")
	var accepted atomic.Int32
	var wg sync.WaitGroup
	errs := make(chan error, 100)
	for n := 0; n < 100; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			tx, e := s.Pool.Begin(ctx)
			if e != nil {
				errs <- e
				return
			}
			defer tx.Rollback(ctx)
			id := fmt.Sprintf("parallel-%d", n)
			// Simulate independently admitted requests; the account row serializes funding across processes.
			if _, e = tx.Exec(ctx, `SELECT id FROM accounts WHERE id=$1 FOR UPDATE`, p.ID); e != nil {
				errs <- e
				return
			}
			if _, e = tx.Exec(ctx, `INSERT INTO gateway_requests(id,task_id,account_id,session_id,operation_key,fingerprint,route_version,execution,settlement,deadline) VALUES($1,$2,$3,$4,$1,$1,$5,'unknown','reserved',$6)`, id, task.ID, p.ID, p.SessionID, RouteVersion, time.Now().Add(time.Minute)); e != nil {
				errs <- e
				return
			}
			_, e = metering.ReserveTx(ctx, tx, p.ID, task.ID, id, price.ID, "", 1000000, native(), 256, time.Now().Add(time.Minute))
			if errors.Is(e, metering.ErrBalance) {
				return
			}
			if e != nil {
				errs <- e
				return
			}
			if e = tx.Commit(ctx); e != nil {
				errs <- e
				return
			}
			accepted.Add(1)
		}(n)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Error(e)
	}
	if accepted.Load() != 60 {
		t.Fatalf("accepted %d", accepted.Load())
	}
	w, _ := m.Wallet(ctx, p.ID)
	if w.Available != "0" || w.Held != "60" {
		t.Fatal(w)
	}
	if _, e := m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
}
func TestUndispatchedReleaseExpiredGrantAndOverrun(t *testing.T) {
	s, p, m := metered(t)
	ctx := context.Background()
	grantCredits(t, m, p, "expiry", "1000", time.Now().Add(time.Hour))
	task := meteredTask(t, s, p, "2000")
	id := newID()
	s.Claim(ctx, p, task.ID, id, id, native())
	s.Pool.Exec(ctx, `UPDATE credit_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE id='expiry'`)
	s.Pool.Exec(ctx, `UPDATE gateway_requests SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1`, id)
	s.Pool.Exec(ctx, `UPDATE billing_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE request_id=$1`, id)
	if _, e := m.Tick(ctx, 100); e != nil {
		t.Fatal(e)
	}
	r, _ := s.Request(ctx, p.ID, id)
	if r.Settlement != "released" || r.Charged == nil || *r.Charged != "0" {
		t.Fatal(r)
	}
	w, _ := m.Wallet(ctx, p.ID)
	if w.Available != "0" || w.Held != "0" {
		t.Fatal("expired refund became spendable", w)
	}
	grantCredits(t, m, p, "new", "1000", time.Now().Add(time.Hour))
	task = meteredTask(t, s, p, "2000")
	id = newID()
	s.Claim(ctx, p, task.ID, id, id, native())
	s.Dispatched(ctx, id)
	u := &rootflow.Usage{Source: "responses", Input: i64(10000), Output: i64(2)}
	if e := s.Finish(ctx, id, "completed", "", 200, true, u); e != nil {
		t.Fatal(e)
	}
	r, _ = s.Request(ctx, p.ID, id)
	if r.Settlement != "reconciliation_pending" || r.Charged != nil {
		t.Fatal("overrun created debt", r)
	}
	var ver int64
	s.Pool.QueryRow(ctx, `SELECT version FROM credit_reservations WHERE request_id=$1`, id).Scan(&ver)
	if e := m.Reconcile(ctx, p.ID, metering.Evidence{RequestID: id, ExpectedVersion: ver, Resolution: "waiver", SourceRef: "operator-waiver-fixture", Reason: "Test platform absorbs unknown outcome"}); e != nil {
		t.Fatal(e)
	}
	var cost *int64
	var state string
	s.Pool.QueryRow(ctx, `SELECT cost_fen,state FROM procurement_costs WHERE request_id=$1`, id).Scan(&cost, &state)
	if cost != nil || state != "unknown" {
		t.Fatal("waiver fabricated free procurement")
	}
	if _, e := m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
}

func TestFundingAdmissionLimitsAndGrantReplay(t *testing.T) {
	s, p, m := metered(t)
	ctx := context.Background()
	g := metering.Grant{ID: "grant-once", AccountID: p.ID, EventID: "once", Source: "trial", Credits: "1000", ExpiresAt: time.Now().Add(time.Hour), DailyLimit: "1", MonthlyLimit: "1"}
	if e := m.Grant(ctx, g); e != nil {
		t.Fatal(e)
	}
	if e := m.Grant(ctx, g); e != nil {
		t.Fatal(e)
	}
	g.Credits = "2000"
	if e := m.Grant(ctx, g); !errors.Is(e, metering.ErrConflict) {
		t.Fatal("grant replay changed balance")
	}
	task := meteredTask(t, s, p, "1000")
	id := newID()
	if _, _, e := s.Claim(ctx, p, task.ID, id, id, native()); !errors.Is(e, metering.ErrBudget) {
		t.Fatal("daily cap ignored", e)
	}
	w, _ := m.Wallet(ctx, p.ID)
	if w.Held != "0" {
		t.Fatal("failed admission held credits")
	}
	s.Pool.Exec(ctx, `UPDATE credit_limits SET daily_limit=100000,monthly_limit=100000 WHERE account_id=$1`, p.ID)
	task = meteredTask(t, s, p, "1")
	id = newID()
	if _, _, e := s.Claim(ctx, p, task.ID, id, id, native()); !errors.Is(e, metering.ErrBudget) {
		t.Fatal("task cap ignored", e)
	}
	s.Pool.Exec(ctx, `UPDATE credit_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1`, p.ID)
	task = meteredTask(t, s, p, "1000")
	id = newID()
	if _, _, e := s.Claim(ctx, p, task.ID, id, id, native()); !errors.Is(e, metering.ErrBalance) {
		t.Fatal("expired credits admitted", e)
	}
	var count int
	s.Pool.QueryRow(ctx, `SELECT count(*) FROM gateway_requests WHERE account_id=$1`, p.ID).Scan(&count)
	if count != 0 {
		t.Fatal("rejected claim persisted")
	}
}
func TestFrozenPricesAndSeparateProcurement(t *testing.T) {
	s, p, m := metered(t)
	ctx := context.Background()
	purchase := metering.PurchasePrice{ID: "cost-fixture", Unit: "provider-credit-subunit", Tiers: []metering.Tier{{MinInput: 0, Input: "2", Cached: "1", Output: "3"}}, FenNumerator: "3", UnitDenominator: "2", Evidence: "synthetic-private-rate", Group: "fixture-group", Membership: "fixture-membership"}
	tx, _ := s.Pool.Begin(ctx)
	defer tx.Rollback(ctx)
	if e := metering.PutPurchase(ctx, tx, purchase); e != nil {
		t.Fatal(e)
	}
	tx.Commit(ctx)
	s.Config.PurchasePriceVersion = purchase.ID
	grantCredits(t, m, p, "funding", "1000", time.Now().Add(time.Hour))
	task := meteredTask(t, s, p, "1000")
	newPrice := testPrice()
	newPrice.ID = "sales-v2"
	newPrice.Tiers[0].Input = "2000000"
	tx2, _ := s.Pool.Begin(ctx)
	defer tx2.Rollback(ctx)
	metering.PutPrice(ctx, tx2, newPrice)
	tx2.Commit(ctx)
	s.Config.SalesPriceVersion = newPrice.ID
	id := newID()
	r, _, e := s.Claim(ctx, p, task.ID, id, id, native())
	if e != nil || r.Price == nil || *r.Price != "test-sales-v1" {
		t.Fatal("task price was not frozen", e)
	}
	s.Dispatched(ctx, id)
	u := &rootflow.Usage{Source: "responses", Input: i64(10), Output: i64(4), Cached: i64(2), Uncached: i64(8), Reasoning: i64(1)}
	if e = s.Finish(ctx, id, "completed", "", 200, true, u); e != nil {
		t.Fatal(e)
	}
	r, _ = s.Request(ctx, p.ID, id)
	var cost int64
	var version string
	if e = s.Pool.QueryRow(ctx, `SELECT cost_fen,purchase_price_version_id FROM procurement_costs WHERE request_id=$1`, id).Scan(&cost, &version); e != nil || cost != 1 || version != purchase.ID || r.Charged == nil || *r.Charged != "14" {
		t.Fatal("procurement and sale mixed", e)
	}
}

func TestMeteringThroughRestrictedRuntime(t *testing.T) {
	s, p, m := metered(t)
	ctx := context.Background()
	grantCredits(t, m, p, "runtime-funds", "1000", time.Now().Add(time.Hour))
	role := "mx_metering_" + strings.ToLower(strings.NewReplacer("-", "a", "_", "b").Replace(newID()[:10]))
	if _, e := s.Pool.Exec(ctx, "CREATE ROLE "+pgx.Identifier{role}.Sanitize()+" LOGIN PASSWORD 'synthetic-runtime-test-only'"); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		s.Pool.Exec(ctx, "DROP OWNED BY "+pgx.Identifier{role}.Sanitize())
		s.Pool.Exec(ctx, "DROP ROLE "+pgx.Identifier{role}.Sanitize())
	})
	if e := identity.GrantRuntime(ctx, s.Pool, role); e != nil {
		t.Fatal(e)
	}
	dsn, _ := url.Parse(s.Pool.Config().ConnConfig.ConnString())
	dsn.User = url.UserPassword(role, "synthetic-runtime-test-only")
	runtime, e := identity.OpenPool(ctx, identity.Config{Environment: "development", DatabaseURL: dsn.String()})
	if e != nil {
		t.Fatal(e)
	}
	defer runtime.Close()
	managed := &Store{Pool: runtime, Config: s.Config}
	task := meteredTask(t, managed, p, "1000")
	id := newID()
	if _, _, e = managed.Claim(ctx, p, task.ID, id, id, native()); e != nil {
		t.Fatal(e)
	}
	if e = managed.Dispatched(ctx, id); e != nil {
		t.Fatal(e)
	}
	if e = managed.Finish(ctx, id, "completed", "", 200, true, &rootflow.Usage{Source: "responses", Input: i64(10), Output: i64(4)}); e != nil {
		t.Fatal(e)
	}
	if _, e = (&metering.Store{Pool: runtime}).Verify(ctx); e != nil {
		t.Fatal(e)
	}
	record, e := managed.Request(ctx, p.ID, id)
	if e != nil || record.Settlement != "settled" {
		t.Fatal(e, record)
	}
}
