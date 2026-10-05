package gateway

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func paymentFixture(t *testing.T) (*payments.Store, identity.Principal, *metering.Store) {
	s, p, m := metered(t)
	ctx := context.Background()
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	for _, kind := range []string{"pack", "subscription"} {
		v := payments.Product{ID: "test-" + kind, Name: "测试 " + kind, Kind: kind, Currency: "CNY", PriceFen: "100", Credits: "1000", ValidDays: 30, RefundPolicyVersion: "test-policy-v1", RefundRule: "unused-proportional-v1", TestOnly: true, DailyLimit: "1000000", MonthlyLimit: "1000000", RequestLimit: 1000}
		if e = payments.PutProduct(ctx, tx, v); e != nil {
			t.Fatal(e)
		}
		if e = payments.PutProduct(ctx, tx, v); e != nil {
			t.Fatal("immutable duplicate", e)
		}
		v.Name = "changed"
		if e = payments.PutProduct(ctx, tx, v); !errors.Is(e, payments.ErrConflict) {
			t.Fatal("changed immutable product")
		}
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	return &payments.Store{Pool: s.Pool, Mode: "test", Provider: payments.NewTestProvider("synthetic-merchant", "synthetic-app"), Merchant: "synthetic-merchant", AppID: "synthetic-app"}, p, m
}
func paidOrder(t *testing.T, s *payments.Store, p identity.Principal, kind string) payments.Order {
	t.Helper()
	ctx := context.Background()
	o, e := s.Create(ctx, p.ID, newID(), "test-"+kind)
	if e != nil {
		t.Fatal(e)
	}
	provider := s.Provider.(*payments.TestProvider)
	provider.Simulate(o.ID)
	v, e := provider.Query(ctx, o)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.ApplyPayment(ctx, v); e != nil {
		t.Fatal(e)
	}
	o, e = s.Order(ctx, p.ID, o.ID)
	if e != nil {
		t.Fatal(e)
	}
	return o
}
func TestPaymentsDuplicateEvidenceAndRefundConservation(t *testing.T) {
	s, p, m := paymentFixture(t)
	ctx := context.Background()
	key := newID()
	o, e := s.Create(ctx, p.ID, key, "test-pack")
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.Create(ctx, p.ID, key, "test-pack")
	if e != nil || o.ID != again.ID {
		t.Fatal("order replay", e)
	}
	if _, e := s.Create(ctx, p.ID, key, "test-subscription"); !errors.Is(e, payments.ErrConflict) {
		t.Fatal("key conflict", e)
	}
	provider := s.Provider.(*payments.TestProvider)
	provider.Simulate(o.ID)
	v, _ := provider.Query(ctx, o)
	bad := v
	bad.Total++
	if e = s.ApplyPayment(ctx, bad); !errors.Is(e, payments.ErrEvidence) {
		t.Fatal("amount mismatch", e)
	}
	bad = v
	bad.Merchant = "foreign"
	if e = s.ApplyPayment(ctx, bad); !errors.Is(e, payments.ErrEvidence) {
		t.Fatal("merchant mismatch", e)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- s.ApplyPayment(ctx, v) }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal("callback replay", e)
		}
	}
	w, _ := m.Wallet(ctx, p.ID)
	if w.Available != "1000" {
		t.Fatal("double grant", w)
	}
	if _, e := m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
	for _, n := range []string{"33", "33", "34"} {
		r, e := s.RequestRefund(ctx, p.ID, newID(), o.ID, n, "测试退款")
		if e != nil {
			t.Fatal(e)
		}
		preview, e := s.Preview(ctx, r.ID)
		if e != nil || !preview.Eligible {
			t.Fatal("preview", preview, e)
		}
		if e = s.Decide(ctx, p.ID, r.ID, "approve", "fixture approval", preview.Refund.Version, preview.OrderVersion); e != nil {
			t.Fatal(e)
		}
		if e = s.Decide(ctx, p.ID, r.ID, "approve", "fixture approval", preview.Refund.Version, preview.OrderVersion); e != nil {
			t.Fatal("decision replay", e)
		}
		if _, e := m.Verify(ctx); e != nil {
			t.Fatal("frozen ledger", e)
		}
		if _, e := s.Tick(ctx, 100); e != nil {
			t.Fatal("refund job", e)
		}
		o, e = s.Order(ctx, p.ID, o.ID)
		if e != nil {
			t.Fatal(e)
		}
		if _, e := m.Verify(ctx); e != nil {
			t.Fatal("refund ledger", e)
		}
	}
	w, _ = m.Wallet(ctx, p.ID)
	if o.State != "refunded" || o.RefundedFen != "100" || w.Returned != "1000" || w.Available != "0" || w.Frozen != "0" {
		t.Fatal("refund conservation", o, w)
	}
}
func TestPaymentFreezeBlocksInferenceAndHeldBlocksRefund(t *testing.T) {
	pay, p, m := paymentFixture(t)
	ctx := context.Background()
	o := paidOrder(t, pay, p, "pack")
	s := &Store{Pool: pay.Pool, Config: Config{Enabled: true, SalesPriceVersion: "test-sales-v1", MaxRequests: 16, MaxOutputTokens: 1024, MaxDurationSeconds: 180, MaxConcurrent: 8}}
	task := meteredTask(t, s, p, "1000")
	id := newID()
	if _, _, e := s.Claim(ctx, p, task.ID, id, id, native()); e != nil {
		t.Fatal("purchase inference", e)
	}
	r, e := pay.RequestRefund(ctx, p.ID, newID(), o.ID, "100", "refund")
	if e != nil {
		t.Fatal(e)
	}
	preview, _ := pay.Preview(ctx, r.ID)
	if preview.Eligible {
		t.Fatal("held credits refundable")
	}
	if e = pay.Decide(ctx, p.ID, r.ID, "approve", "blocked", r.Version, preview.OrderVersion); !errors.Is(e, payments.ErrRefund) {
		t.Fatal("held approval", e)
	}
	if e = s.Finish(ctx, id, "failed", "fixture", 0, false, nil); e != nil {
		t.Fatal(e)
	}
	preview, _ = pay.Preview(ctx, r.ID)
	if !preview.Eligible {
		t.Fatal("unused released grant blocked")
	}
	if e = pay.Decide(ctx, p.ID, r.ID, "approve", "approve", r.Version, preview.OrderVersion); e != nil {
		t.Fatal(e)
	}
	task2 := meteredTask(t, s, p, "1000")
	id = newID()
	if _, _, e = s.Claim(ctx, p, task2.ID, id, id, native()); !errors.Is(e, metering.ErrBalance) {
		t.Fatal("refund freeze spent", e)
	}
	if _, e := m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
}

type ambiguousRefund struct {
	payments.Provider
	creates int
}

func (p *ambiguousRefund) Refund(ctx context.Context, o payments.Order, r payments.Refund) (payments.Evidence, error) {
	p.creates++
	_, _ = p.Provider.Refund(ctx, o, r)
	return payments.Evidence{}, fmt.Errorf("timeout-private-provider-detail")
}
func TestRefundTimeoutRestartQueriesOriginalID(t *testing.T) {
	s, p, m := paymentFixture(t)
	ctx := context.Background()
	o := paidOrder(t, s, p, "pack")
	r, _ := s.RequestRefund(ctx, p.ID, newID(), o.ID, "50", "refund")
	v, _ := s.Preview(ctx, r.ID)
	if e := s.Decide(ctx, p.ID, r.ID, "approve", "approve", r.Version, v.OrderVersion); e != nil {
		t.Fatal(e)
	}
	adapter := &ambiguousRefund{Provider: s.Provider}
	s.Provider = adapter
	if _, e := s.Tick(ctx, 100); e != nil {
		t.Fatal(e)
	}
	w, _ := m.Wallet(ctx, p.ID)
	if w.Frozen != "500" || w.Returned != "0" {
		t.Fatal("unknown released freeze", w)
	}
	s2 := *s
	s2.Pool.Exec(ctx, `UPDATE payment_jobs SET available_at=clock_timestamp() WHERE id=$1`, r.ID)
	if _, e := s2.Tick(ctx, 100); e != nil {
		t.Fatal(e)
	}
	w, _ = m.Wallet(ctx, p.ID)
	if adapter.creates != 1 || w.Frozen != "0" || w.Returned != "500" {
		t.Fatal("reposted refund", adapter.creates, w)
	}
	if _, e := m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
}
func TestMissingPaymentCallbackAndSubscriptionRenewal(t *testing.T) {
	s, p, m := paymentFixture(t)
	ctx := context.Background()
	o, e := s.Create(ctx, p.ID, newID(), "test-subscription")
	if e != nil {
		t.Fatal(e)
	}
	if _, e := s.Tick(ctx, 100); e != nil {
		t.Fatal(e)
	}
	s.Provider.(*payments.TestProvider).Simulate(o.ID)
	s.Wake(ctx, p.ID, o.ID)
	if _, e := s.Tick(ctx, 100); e != nil {
		t.Fatal(e)
	}
	o, _ = s.Order(ctx, p.ID, o.ID)
	if o.State != "paid" {
		t.Fatal("missing callback not recovered", o)
	}
	_ = paidOrder(t, s, p, "subscription")
	periods, e := s.Periods(ctx, p.ID)
	if e != nil || len(periods) != 2 || periods[0].State != "pending" || !periods[0].Starts.Equal(periods[1].Ends) {
		t.Fatal("renewal overlap", periods, e)
	}
	w, _ := m.Wallet(ctx, p.ID)
	if w.Available != "1000" {
		t.Fatal("future subscription spent early", w)
	}
	r, _ := s.RequestRefund(ctx, p.ID, newID(), o.ID, "100", "refund")
	v, _ := s.Preview(ctx, r.ID)
	if v.Eligible {
		t.Fatal("earlier subscription refund breaks following period")
	}
	if _, e := m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
}
func TestPaymentsOwnerAndMFAHTTP(t *testing.T) {
	s, p, _ := paymentFixture(t)
	ctx := context.Background()
	ident, _ := identity.New(s.Pool, make([]byte, 32))
	other, token := principal(t, ident)
	o := paidOrder(t, s, p, "pack")
	parent := identity.NewHTTP(ident, "http://finance.test", false)
	MountPayments(Mount(parent, &Store{Pool: s.Pool}), s)
	for _, path := range []string{"/v1/billing/orders/" + o.ID, "/v1/billing/orders/" + o.ID + "/refunds", "/v1/admin/payments"} {
		r := httptest.NewRequest("GET", "http://finance.test"+path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		parent.ServeHTTP(w, r)
		want := 404
		if strings.Contains(path, "admin") {
			want = 403
		}
		if w.Code != want {
			t.Fatal(path, w.Code, w.Body.String())
		}
	}
	_ = other
	for _, path := range []string{"/ops/api/finance", "/ops/api/finance/simulate"} {
		r := httptest.NewRequest("POST", "http://finance.test"+path, strings.NewReader(`{}`))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		parent.ServeHTTP(w, r)
		if w.Code < 400 {
			t.Fatal("unauthenticated ops")
		}
	}
	if csvCell(" =1+1") != "' =1+1" {
		t.Fatal("CSV formula")
	}
	if _, e := s.Create(ctx, p.ID, newID(), "does-not-exist"); !errors.Is(e, payments.ErrNotFound) {
		t.Fatal(e)
	}
	s.Mode = "wechat-native"
	if _, e := s.Create(ctx, p.ID, newID(), "test-pack"); !errors.Is(e, payments.ErrDisabled) {
		t.Fatal("test products sold for money", e)
	}
	_ = time.Now()
}

func TestPaymentRefundFailureAndOrderClose(t *testing.T) {
	s, p, m := paymentFixture(t)
	ctx := context.Background()
	o := paidOrder(t, s, p, "pack")
	r, e := s.RequestRefund(ctx, p.ID, newID(), o.ID, "50", "refund")
	if e != nil {
		t.Fatal(e)
	}
	v, _ := s.Preview(ctx, r.ID)
	if e = s.Decide(ctx, p.ID, r.ID, "approve", "approve", r.Version, v.OrderVersion); e != nil {
		t.Fatal(e)
	}
	bad := payments.Evidence{ID: "bad-refund", OrderID: o.ID, RefundID: r.ID, ProviderRefundID: "provider-r", TransactionID: "foreign-transaction", State: "SUCCESS", Currency: "CNY", Total: 100, Refund: 50, Merchant: s.Merchant, AppID: s.AppID, Source: "test"}
	if e = s.ApplyRefund(ctx, bad); !errors.Is(e, payments.ErrEvidence) {
		t.Fatal("refund transaction mismatch", e)
	}
	bad.TransactionID = "test:" + o.ID
	bad.State = "CLOSED"
	if e = s.ApplyRefund(ctx, bad); e != nil {
		t.Fatal(e)
	}
	if e = s.ApplyRefund(ctx, bad); e != nil {
		t.Fatal("closed refund replay", e)
	}
	w, _ := m.Wallet(ctx, p.ID)
	if w.Available != "1000" || w.Frozen != "0" || w.Returned != "0" {
		t.Fatal("failed refund balance", w)
	}
	if _, e = m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
	pending, e := s.Create(ctx, p.ID, newID(), "test-pack")
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Close(ctx, p.ID, pending.ID); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 3; i++ {
		s.Wake(ctx, p.ID, pending.ID)
		if _, e = s.Tick(ctx, 100); e != nil {
			t.Fatal(e)
		}
	}
	pending, _ = s.Order(ctx, p.ID, pending.ID)
	if pending.State != "closed" {
		t.Fatal("close not verified", pending)
	}
	provider := s.Provider.(*payments.TestProvider)
	provider.Simulate(pending.ID)
	late, _ := provider.Query(ctx, pending)
	if e = s.ApplyPayment(ctx, late); e != nil {
		t.Fatal("late verified money dropped", e)
	}
	pending, _ = s.Order(ctx, p.ID, pending.ID)
	if pending.State != "paid" {
		t.Fatal("late verified money dropped")
	}
	if _, e = m.Verify(ctx); e != nil {
		t.Fatal(e)
	}
}

func TestPaymentsRestrictedRuntimeAndActivationReceipt(t *testing.T) {
	s, p, _ := paymentFixture(t)
	ctx := context.Background()
	role := "mx_payment_" + strings.ToLower(strings.NewReplacer("-", "a", "_", "b").Replace(newID()[:10]))
	if _, e := s.Pool.Exec(ctx, "CREATE ROLE "+pgx.Identifier{role}.Sanitize()+" LOGIN PASSWORD 'synthetic-runtime-test-only'"); e != nil {
		t.Fatal(e)
	}
	defer func() {
		s.Pool.Exec(ctx, "DROP OWNED BY "+pgx.Identifier{role}.Sanitize())
		s.Pool.Exec(ctx, "DROP ROLE "+pgx.Identifier{role}.Sanitize())
	}()
	if e := identity.GrantRuntime(ctx, s.Pool, role); e != nil {
		t.Fatal(e)
	}
	dsn, _ := url.Parse(s.Pool.Config().ConnConfig.ConnString())
	dsn.User = url.UserPassword(role, "synthetic-runtime-test-only")
	pool, e := identity.OpenPool(ctx, identity.Config{Environment: "development", DatabaseURL: dsn.String()})
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	runtime := *s
	runtime.Pool = pool
	o := paidOrder(t, &runtime, p, "pack")
	var before, after int
	if e = pool.QueryRow(ctx, `SELECT request_limit FROM cloud_access WHERE account_id=$1`, p.ID).Scan(&before); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, `SELECT activate_test_payment($1)`, o.ID); e != nil {
		t.Fatal(e)
	}
	pool.QueryRow(ctx, `SELECT request_limit FROM cloud_access WHERE account_id=$1`, p.ID).Scan(&after)
	if before != after {
		t.Fatal("replay enlarged entitlement")
	}
	for _, sql := range []string{`UPDATE cloud_access SET request_limit=10000`, `UPDATE credit_limits SET daily_limit=1`, `UPDATE credit_grants SET unit='paid-credit'`, `UPDATE credit_grants SET credits=100000`, `INSERT INTO payment_activations(order_id) VALUES('fake')`, `UPDATE payment_products SET body='{}'`, `UPDATE payment_orders SET amount_fen=1`} {
		if _, e = pool.Exec(ctx, sql); e == nil {
			t.Fatal("runtime changed deployment policy", sql)
		}
	}
	r, e := runtime.RequestRefund(ctx, p.ID, newID(), o.ID, "50", "refund")
	if e != nil {
		t.Fatal(e)
	}
	v, e := runtime.Preview(ctx, r.ID)
	if e != nil {
		t.Fatal(e)
	}
	if e = runtime.Decide(ctx, p.ID, r.ID, "approve", "approval", r.Version, v.OrderVersion); e != nil {
		t.Fatal(e)
	}
	if _, e = runtime.Tick(ctx, 100); e != nil {
		t.Fatal(e)
	}
	if _, e = (&metering.Store{Pool: pool}).Verify(ctx); e != nil {
		t.Fatal(e)
	}
}
