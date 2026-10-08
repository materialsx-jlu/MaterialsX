package gateway

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"net/url"
	"testing"
	"time"
)

// Synthetic payment evidence in a disposable PostgreSQL database; no merchant calls.
func paidFixture(t *testing.T) (*Store, identity.Principal, *metering.Store, *payments.Store, payments.Order) {
	t.Helper()
	s, p, m := metered(t)
	ctx := context.Background()
	s.Config.PaidAccount = p.ID
	s.Config.SalesPriceVersion = metering.PaidPriceID
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	if e = metering.PutPrice(ctx, tx, metering.PaidPrice()); e != nil {
		t.Fatal(e)
	}
	if e = payments.PutProduct(ctx, tx, payments.PilotSubscription()); e != nil {
		t.Fatal(e)
	}
	if _, e = tx.Exec(ctx, `INSERT INTO paid_credit_limits VALUES($1,10000000,10000000)`, p.ID); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	provider := payments.NewTestProvider("synthetic-merchant", "synthetic-app")
	pay := &payments.Store{Pool: s.Pool, Mode: "wechat-pilot", PilotAccount: p.ID, Provider: provider, Merchant: "synthetic-merchant", AppID: "synthetic-app"}
	o, e := pay.Create(ctx, p.ID, newID(), payments.PilotSubscription().ID)
	if e != nil {
		t.Fatal(e)
	}
	provider.Simulate(o.ID)
	v, e := provider.Query(ctx, o)
	if e != nil {
		t.Fatal(e)
	}
	v.Source = "query"
	if e = pay.ApplyPayment(ctx, v); e != nil {
		t.Fatal(e)
	}
	return s, p, m, pay, o
}
func paidTask(t *testing.T, s *Store, p identity.Principal, max string) Task {
	t.Helper()
	in := taskInput()
	in.Mode = "paid-credits"
	in.Budget.MaxCredits = max
	task, e := s.Create(context.Background(), p, in, newID())
	if e != nil {
		t.Fatal(e)
	}
	return task
}
func paidRuntime(t *testing.T, s *Store, m *metering.Store, pay *payments.Store) {
	t.Helper()
	ctx := context.Background()
	owner := s.Pool
	role := fmt.Sprintf("paid_rt_%d", time.Now().UnixNano())
	if _, e := owner.Exec(ctx, "CREATE ROLE "+pgx.Identifier{role}.Sanitize()+" LOGIN PASSWORD 'synthetic-runtime-test-only' NOSUPERUSER NOCREATEDB NOCREATEROLE"); e != nil {
		t.Fatal(e)
	}
	if e := identity.GrantRuntime(ctx, owner, role); e != nil {
		t.Fatal(e)
	}
	dsn, _ := url.Parse(owner.Config().ConnConfig.ConnString())
	dsn.User = url.UserPassword(role, "synthetic-runtime-test-only")
	pool, e := identity.OpenPool(ctx, identity.Config{Environment: "development", DatabaseURL: dsn.String()})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		pool.Close()
		owner.Exec(ctx, "DROP OWNED BY "+pgx.Identifier{role}.Sanitize())
		owner.Exec(ctx, "DROP ROLE "+pgx.Identifier{role}.Sanitize())
	})
	if e = identity.CheckRuntimeRole(ctx, pool); e != nil {
		t.Fatal(e)
	}
	for _, q := range []string{`UPDATE paid_credit_limits SET daily_subunits=1`, `UPDATE credit_grants SET credits=100000`, `UPDATE research_tasks SET credit_precision=1`, `UPDATE credit_reservations SET precision=1`} {
		if _, e = pool.Exec(ctx, q); e == nil {
			t.Fatal("runtime rewrote policy/denomination", q)
		}
	}
	s.Pool = pool
	m.Pool = pool
	pay.Pool = pool
}
func TestPaidConsumptionLifecycle(t *testing.T) {
	s, p, m, pay, o := paidFixture(t)
	ctx := context.Background()
	grantCredits(t, m, p, "test-only", "1000000", time.Now().Add(time.Hour))
	paidRuntime(t, s, m, pay)
	w, e := m.Wallet(ctx, p.ID)
	if e != nil || w.Purchased.Available != "1000" {
		t.Fatal(w, e)
	}
	task := paidTask(t, s, p, "500.0001")
	id := newID()
	r, _, e := s.Claim(ctx, p, task.ID, id, id, native())
	if e != nil || r.Mode != "paid-credits" {
		t.Fatal(r, e)
	}
	held, _ := m.Wallet(ctx, p.ID)
	if held.Purchased.Held == "0" || held.Held != "0" {
		t.Fatal(held)
	}
	if ok, e := s.RunningAllowed(ctx, p, id); e != nil || !ok {
		t.Fatal("paid stream not allowed", e)
	}
	if e = s.Dispatched(ctx, id); e != nil {
		t.Fatal(e)
	}
	u := &rootflow.Usage{Source: "responses", Input: i64(1), Cached: i64(1), Uncached: i64(0), Output: i64(0), Reasoning: i64(0)}
	if e = s.Finish(ctx, id, "completed", "", 200, true, u); e != nil {
		t.Fatal(e)
	}
	if e = s.Finish(ctx, id, "completed", "", 200, true, u); e != nil {
		t.Fatal(e)
	}
	r, e = s.Request(ctx, p.ID, id)
	if e != nil || r.Charged == nil || *r.Charged != "0.0001" || r.Settlement != "settled" {
		t.Fatal(r, e)
	}
	w, e = m.Wallet(ctx, p.ID)
	if e != nil || w.Purchased.Available != "999.9999" || w.Purchased.Consumed != "0.0001" || w.Purchased.Held != "0" || w.Consumed != "0" || w.Available != "1000000" {
		t.Fatal(w, e)
	}
	led, _, e := m.Ledger(ctx, p.ID, "")
	if e != nil {
		t.Fatal(e)
	}
	found := false
	for _, v := range led {
		if v.RequestID != nil && *v.RequestID == id && v.Kind == "settle" {
			found = true
			if v.Consumed != "0.0001" || v.Unit != "paid-credit" {
				t.Fatal(v)
			}
		}
	}
	if !found {
		t.Fatal("missing fractional entry")
	}
	b, _, e := s.Bills(ctx, p.ID, "")
	if e != nil || len(b) != 1 || b[0].Charged != "0.0001" || b[0].Mode != "paid-credits" {
		t.Fatal(b, e)
	}
	if _, e = m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
	refund, e := pay.RequestRefund(ctx, p.ID, newID(), o.ID, "100", "synthetic unused-refund check")
	if e != nil {
		t.Fatal(e)
	}
	preview, e := pay.Preview(ctx, refund.ID)
	if e != nil || preview.Eligible {
		t.Fatal("fractional use falsely eligible", preview, e)
	}
	// Restart recovery replays a known terminal without another debit.
	if _, e = s.Pool.Exec(ctx, `UPDATE billing_jobs SET status='pending',available_at=clock_timestamp()-interval '1 second' WHERE request_id=$1`, id); e != nil {
		t.Fatal(e)
	}
	if _, e = (&metering.Store{Pool: s.Pool}).Tick(ctx, 100); e != nil {
		t.Fatal(e)
	}
	after, _ := m.Wallet(ctx, p.ID)
	if after.Purchased.Consumed != w.Purchased.Consumed {
		t.Fatal("recovery double charge")
	}
}
func TestPaidTerminalWithoutCacheSplitSettlesAtCustomerDiscount(t *testing.T) {
	s, p, m, _, _ := paidFixture(t)
	ctx := context.Background()
	task := paidTask(t, s, p, "500")
	id := newID()
	if _, _, e := s.Claim(ctx, p, task.ID, id, id, native()); e != nil {
		t.Fatal(e)
	}
	if e := s.Dispatched(ctx, id); e != nil {
		t.Fatal(e)
	}
	usage := &rootflow.Usage{Source: "responses", Input: i64(10), Output: i64(1)}
	if e := s.Finish(ctx, id, "completed", "", 200, true, usage); e != nil {
		t.Fatal(e)
	}
	r, e := s.Request(ctx, p.ID, id)
	if e != nil || r.Execution != "completed" || r.Settlement != "settled" || r.Charged == nil || *r.Charged != "0.011" || r.Usage.Cached != nil || !r.CacheDiscountApplied {
		t.Fatal(r, e)
	}
	if _, e = m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
}
func TestPaidTaskWithoutCreditCapSettlesAgainstAccountBalance(t *testing.T) {
	s, p, m, _, _ := paidFixture(t)
	ctx := context.Background()
	in := taskInput()
	in.Mode = "paid-credits"
	in.Budget.MaxCredits = ""
	in.Budget.MaxRequests = 4
	task, e := s.Create(ctx, p, in, newID())
	if e != nil || task.Mode != "paid-credits" || task.Budget.MaxCredits != "" {
		t.Fatal(task, e)
	}
	loaded, e := s.Task(ctx, p.ID, task.ID)
	if e != nil || loaded.Mode != "paid-credits" || loaded.Budget.MaxCredits != "" {
		t.Fatal(loaded, e)
	}
	for i := 0; i < 3; i++ {
		id := newID()
		if _, _, e = s.Claim(ctx, p, task.ID, id, id, native()); e != nil {
			t.Fatal("claim", i, e)
		}
		if e = s.Dispatched(ctx, id); e != nil {
			t.Fatal(e)
		}
		if e = s.Finish(ctx, id, "completed", "", 200, true, &rootflow.Usage{Source: "responses", Input: i64(10), Output: i64(1)}); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE credit_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1`, p.ID); e != nil {
		t.Fatal(e)
	}
	id := newID()
	if _, _, e = s.Claim(ctx, p, task.ID, id, id, native()); !errors.Is(e, metering.ErrBalance) {
		t.Fatal("account balance did not stop the next call", e)
	}
	if _, e = m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
}
func TestPaidMissingUsageNoCallAndAdmission(t *testing.T) {
	s, p, m, _, o := paidFixture(t)
	ctx := context.Background()
	in := taskInput()
	in.Mode = "test-credits"
	in.Budget.MaxCredits = "500"
	if _, e := s.Create(ctx, p, in, newID()); e == nil {
		t.Fatal("mixed unit route admitted")
	}
	low := paidTask(t, s, p, "1")
	id := newID()
	if _, _, e := s.Claim(ctx, p, low.ID, id, id, native()); !errors.Is(e, metering.ErrBudget) {
		t.Fatal("reserve beyond budget", e)
	}
	task := paidTask(t, s, p, "500")
	id = newID()
	if _, _, e := s.Claim(ctx, p, task.ID, id, id, native()); e != nil {
		t.Fatal(e)
	}
	// Undispatched failures are released; a terminal without total input stays held.
	if e := s.Finish(ctx, id, "failed", "UPSTREAM_ERROR", 0, false, nil); e != nil {
		t.Fatal(e)
	}
	w, _ := m.Wallet(ctx, p.ID)
	if w.Purchased.Held != "0" || w.Purchased.Consumed != "0" {
		t.Fatal(w)
	}
	id = newID()
	if _, _, e := s.Claim(ctx, p, task.ID, id, id, native()); !errors.Is(e, ErrConflict) {
		t.Fatal("failed task round proceeded", e)
	}
	task = paidTask(t, s, p, "500")
	if _, _, e := s.Claim(ctx, p, task.ID, id, id, native()); e != nil {
		t.Fatal(e)
	}
	s.Dispatched(ctx, id)
	if e := s.Finish(ctx, id, "completed", "", 200, true, &rootflow.Usage{Source: "responses", Output: i64(1)}); e != nil {
		t.Fatal(e)
	}
	r, _ := s.Request(ctx, p.ID, id)
	if r.Settlement != "reconciliation_pending" || r.Charged != nil {
		t.Fatal(r)
	}
	w, _ = m.Wallet(ctx, p.ID)
	if w.Purchased.Held == "0" || w.Purchased.Consumed != "0" {
		t.Fatal(w)
	}
	if _, e := s.Pool.Exec(ctx, `UPDATE billing_jobs SET available_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '73 hours' WHERE request_id=$1`, id); e != nil {
		t.Fatal(e)
	}
	if _, e := m.Tick(ctx, 100); e != nil {
		t.Fatal(e)
	}
	pending, e := m.Pending(ctx)
	if e != nil || len(pending) != 1 || pending[0].Unit != "paid-credit" || pending[0].JobStatus != "manual" {
		t.Fatal(pending, e)
	}
	ev := metering.Evidence{RequestID: id, ExpectedVersion: pending[0].Version, Resolution: "usage", SourceRef: "synthetic-provider-bill", Reason: "fixture verified cache", Usage: &rootflow.Usage{Source: "responses", Input: i64(10), Cached: i64(2), Output: i64(1)}}
	preview, e := m.Preview(ctx, ev)
	if e != nil || preview.Charged != "0.0182" || preview.Unit != "paid-credit" {
		t.Fatal(preview, e)
	}
	if e = m.Reconcile(ctx, p.ID, ev); e != nil {
		t.Fatal(e)
	}
	if e = m.Reconcile(ctx, p.ID, ev); e != nil {
		t.Fatal(e)
	}
	if _, e = m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Pool.Exec(ctx, `UPDATE subscription_periods SET state='canceled' WHERE order_id=$1`, o.ID); e != nil {
		t.Fatal(e)
	}
	in.Mode = "paid-credits"
	if _, e = s.Create(ctx, p, in, newID()); !errors.Is(e, ErrForbidden) {
		t.Fatal("expired subscription allowed", e)
	}
}

func TestPaidBalanceCannotSpendTestGrants(t *testing.T) {
	s, p, m, _, _ := paidFixture(t)
	ctx := context.Background()
	grantCredits(t, m, p, "many-test-credits", "1000000", time.Now().Add(time.Hour))
	// Let the wallet, rather than the daily policy, be the binding ceiling.
	if _, e := s.Pool.Exec(ctx, `UPDATE paid_credit_limits SET daily_subunits=100000000,monthly_subunits=100000000 WHERE account_id=$1`, p.ID); e != nil {
		t.Fatal(e)
	}
	reserved := int64(0)
	blocked := false
	for i := 0; i < 16; i++ {
		task := paidTask(t, s, p, "500")
		id := newID()
		r, _, e := s.Claim(ctx, p, task.ID, id, id, native())
		if errors.Is(e, metering.ErrBalance) {
			blocked = true
			break
		}
		if e != nil {
			t.Fatal(e)
		}
		n, e := metering.DecimalAmount(r.Reserved)
		if e != nil {
			t.Fatal(e)
		}
		reserved += n
		if e = s.Dispatched(ctx, id); e != nil {
			t.Fatal(e)
		}
		if e = s.Finish(ctx, id, "unknown", "STREAM_INTERRUPTED", 0, false, nil); e != nil {
			t.Fatal(e)
		}
	}
	if !blocked || reserved > 1000*metering.PaidPrecision {
		t.Fatal("overspent or used test balance", reserved)
	}
	w, e := m.Wallet(ctx, p.ID)
	if e != nil || w.Available != "1000000" || w.Held != "0" || w.Purchased.Held != metering.Display(reserved, metering.PaidPrecision) || w.Purchased.Consumed != "0" {
		t.Fatal(w, e)
	}
	if _, e = m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
}
