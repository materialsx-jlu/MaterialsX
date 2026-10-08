package mxpoints

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/migrations"
)

func fixture(t *testing.T) (*Store, string, string, *payments.TestProvider) {
	t.Helper()
	dsn := os.Getenv("MATERIALSX_IDENTITY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires isolated test PostgreSQL")
	}
	u, err := url.Parse(dsn)
	if err != nil || !strings.Contains(u.Path, "test") {
		t.Fatal("test DSN required")
	}
	ctx := context.Background()
	owner, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	db := "mx_points_test_" + id("")[0:12]
	if _, err = owner.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{db}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + db
	pool, err := identity.OpenPool(ctx, identity.Config{Environment: "development", DatabaseURL: u.String()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = owner.Exec(ctx, "DROP DATABASE "+pgx.Identifier{db}.Sanitize()+" WITH (FORCE)")
		_ = owner.Close(ctx)
	})
	if err = migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	user, admin := id("u"), id("a")
	_, err = pool.Exec(ctx, `INSERT INTO accounts(id,email,display_name,password_hash,role) VALUES($1,$2,'Fixture','fixture','user')`, user, user+"@example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO accounts(id,email,display_name,password_hash,role,mfa_cipher) VALUES($1,$2,'Admin','fixture','admin',decode('00','hex'))`, admin, admin+"@example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO billing_staff_roles(account_id,role) VALUES($1,'billing.admin')`, admin); err != nil {
		t.Fatal(err)
	}
	provider := payments.NewTestProvider("synthetic-merchant", "synthetic-app")
	return &Store{Pool: pool, Provider: provider, Merchant: "synthetic-merchant", AppID: "synthetic-app", Mode: "test"}, user, admin, provider
}
func paid(t *testing.T, s *Store, user string, p *payments.TestProvider, product string) Order {
	t.Helper()
	ctx := context.Background()
	o, err := s.Create(ctx, user, id("key"), product)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Tick(ctx, 1); err != nil {
		t.Fatal(err)
	}
	p.Simulate(o.ID)
	channelOrder, err := s.providerOrder(ctx, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := p.Query(ctx, channelOrder)
	if err != nil || s.ApplyPayment(ctx, evidence) != nil || s.ApplyPayment(ctx, evidence) != nil {
		t.Fatalf("verified payment did not settle idempotently: %v", err)
	}
	return o
}
func TestProductsAndPaymentReplay(t *testing.T) {
	s, user, _, p := fixture(t)
	ctx := context.Background()
	products, err := s.Products(ctx)
	if err != nil || len(products) != 4 {
		t.Fatalf("fixed products unavailable: %v", err)
	}
	for _, product := range products {
		if !product.TestOnly || !product.Enabled {
			t.Fatal("synthetic catalog mislabeled")
		}
	}
	key := id("same")
	ids := make(chan string, 8)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			o, err := s.Create(ctx, user, key, products[0].ID)
			if err != nil {
				ids <- "error:" + err.Error()
				return
			}
			ids <- o.ID
		}()
	}
	wg.Wait()
	close(ids)
	first := ""
	for value := range ids {
		if first == "" {
			first = value
		}
		if value != first || strings.HasPrefix(value, "error:") {
			t.Fatalf("idempotent create diverged: %s vs %s", value, first)
		}
	}
	if _, err := s.Create(ctx, user, key, products[1].ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed product reused key: %v", err)
	}
	if _, err := s.Tick(ctx, 1); err != nil {
		t.Fatal(err)
	}
	p.Simulate(first)
	o, err := s.providerOrder(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := p.Query(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	bad := evidence
	bad.Total++
	if err := s.ApplyPayment(ctx, bad); !errors.Is(err, ErrEvidence) {
		t.Fatalf("wrong amount accepted: %v", err)
	}
	verified := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			verified <- s.ApplyPayment(ctx, evidence)
		}()
	}
	wg.Wait()
	close(verified)
	for err := range verified {
		if err != nil {
			t.Fatalf("concurrent verified replay failed: %v", err)
		}
	}
	wallet, err := s.Wallet(ctx, user)
	if err != nil || wallet.Available != "100" || wallet.Unit != "mx-point" {
		t.Fatalf("one payment credited wrong wallet: %+v %v", wallet, err)
	}
	var grants, oldCredits int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM mx_point_ledger WHERE kind='grant'`).Scan(&grants); err != nil || grants != 1 {
		t.Fatalf("replay created extra grant: %d %v", grants, err)
	}
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM credit_grants WHERE account_id=$1`, user).Scan(&oldCredits); err != nil || oldCredits != 0 {
		t.Fatal("MX payment modified historic credit ledger")
	}
}

func TestRealMXPilotOnlyAdmitsDesignatedAccountAndTenYuanProduct(t *testing.T) {
	s, user, other, _ := fixture(t)
	s.Mode, s.PilotAccount = "wechat", user
	ctx := context.Background()
	if _, err := s.Create(ctx, other, id("key"), "mx-cny-10-v1"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("other account admitted to real-payment pilot: %v", err)
	}
	if _, err := s.Create(ctx, user, id("key"), "mx-cny-50-v1"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("higher amount admitted to real-payment pilot: %v", err)
	}
	order, err := s.Create(ctx, user, id("key"), "mx-cny-10-v1")
	if err != nil || order.AmountFen != "1000" || order.Channel != "wechat" || order.State != "pending" {
		t.Fatalf("designated ten-yuan order failed: %+v %v", order, err)
	}
}

func TestReserveSettleRefundConservation(t *testing.T) {
	s, user, admin, p := fixture(t)
	ctx := context.Background()
	first := paid(t, s, user, p, "mx-cny-10-v1")
	request := id("r")
	if err := s.Reserve(ctx, user, request, 10*Precision+500000); err != nil {
		t.Fatal(err)
	}
	if err := s.Reserve(ctx, user, request, 10*Precision+500000); err != nil {
		t.Fatal(err)
	}
	if err := s.Reserve(ctx, user, request, 11*Precision); !errors.Is(err, ErrConflict) {
		t.Fatalf("reservation key accepted changed amount: %v", err)
	}
	if _, err := s.RequestRefund(ctx, user, id("refund"), first.ID, "unused"); !errors.Is(err, ErrRefund) {
		t.Fatalf("held balance refunded: %v", err)
	}
	if err := s.Settle(ctx, user, request, Precision/2); err != nil {
		t.Fatal(err)
	}
	if err := s.Reserve(ctx, user, request, 10*Precision+500000); !errors.Is(err, ErrConflict) {
		t.Fatalf("settled reservation reused for another dispatch: %v", err)
	}
	if err := s.Settle(ctx, user, request, Precision/2); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RequestRefund(ctx, user, id("refund"), first.ID, "unused"); !errors.Is(err, ErrRefund) {
		t.Fatalf("spent balance refunded: %v", err)
	}
	second := paid(t, s, user, p, "mx-cny-50-v1")
	refund, err := s.RequestRefund(ctx, user, id("refund"), second.ID, "unused")
	if err != nil || refund.AmountFen != "5000" {
		t.Fatalf("refund freeze failed: %+v %v", refund, err)
	}
	listed, err := s.Refunds(ctx, user, second.ID)
	if err != nil || len(listed) != 1 || listed[0].ID != refund.ID {
		t.Fatalf("refund history missing: %+v %v", listed, err)
	}
	otherRefunds, err := s.Refunds(ctx, admin, second.ID)
	if err != nil || len(otherRefunds) != 0 {
		t.Fatalf("refund history leaked: %+v %v", otherRefunds, err)
	}
	if _, err := s.AvailableSubunits(ctx, user); err != nil {
		t.Fatal(err)
	}
	if err := s.DecideRefund(ctx, user, refund.ID, "approve", refund.Version); !errors.Is(err, ErrDisabled) {
		t.Fatalf("ordinary user approved refund: %v", err)
	}
	if err := s.DecideRefund(ctx, admin, refund.ID, "approve", refund.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Tick(ctx, 10); err != nil {
		t.Fatal(err)
	}
	processed, err := s.Refund(ctx, user, refund.ID)
	if err != nil || processed.Execution != "succeeded" {
		t.Fatalf("refund not confirmed: %+v %v", processed, err)
	}
	channelOrder, _ := s.providerOrder(ctx, second.ID)
	v, _ := p.QueryRefund(ctx, channelOrder, payments.Refund{ID: refund.ID, AmountFen: refund.AmountFen})
	if err = s.ApplyRefund(ctx, v); err != nil {
		t.Fatalf("refund replay changed wallet: %v", err)
	}
	wallet, err := s.Wallet(ctx, user)
	if err != nil || wallet.Available != "99.5" || wallet.Consumed != "0.5" || wallet.Returned != "500" || wallet.Frozen != "0" {
		t.Fatalf("wallet conservation failed: %+v %v", wallet, err)
	}
	assertLedger(t, s.Pool, first.ID)
	assertLedger(t, s.Pool, second.ID)
}

func assertLedger(t *testing.T, pool *pgxpool.Pool, orderID string) {
	t.Helper()
	ctx := context.Background()
	var grant, held, spent, frozen, returned int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(sum(granted_delta),0),COALESCE(sum(held_delta),0),COALESCE(sum(consumed_delta),0),COALESCE(sum(frozen_delta),0),COALESCE(sum(returned_delta),0) FROM mx_point_ledger WHERE order_id=$1`, orderID).Scan(&grant, &held, &spent, &frozen, &returned); err != nil {
		t.Fatal(err)
	}
	var bGrant, bHeld, bSpent, bFrozen, bReturned int64
	if err := pool.QueryRow(ctx, `SELECT granted,held,consumed,frozen,returned FROM mx_point_batches WHERE order_id=$1`, orderID).Scan(&bGrant, &bHeld, &bSpent, &bFrozen, &bReturned); err != nil || grant != bGrant || held != bHeld || spent != bSpent || frozen != bFrozen || returned != bReturned {
		t.Fatal("append-only ledger and batch totals differ", err)
	}
}

func TestConcurrentReserveCannotOverspend(t *testing.T) {
	s, user, _, p := fixture(t)
	paid(t, s, user, p, "mx-cny-10-v1")
	ctx := context.Background()
	var wg sync.WaitGroup
	out := make(chan error, 4)
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out <- s.Reserve(ctx, user, id("req"), 60*Precision)
		}()
	}
	wg.Wait()
	close(out)
	accepted := 0
	for err := range out {
		if err == nil {
			accepted++
		} else if !errors.Is(err, ErrBalance) {
			t.Fatalf("unexpected reserve result: %v", err)
		}
	}
	if accepted != 1 {
		t.Fatalf("overspent wallet: %d reservations accepted", accepted)
	}
	wallet, err := s.Wallet(ctx, user)
	if err != nil || wallet.Available != "40" || wallet.Held != "60" {
		t.Fatalf("concurrent wallet mismatch: %+v %v", wallet, err)
	}
}

func TestLateVerifiedPaymentAndRefundRejection(t *testing.T) {
	s, user, admin, provider := fixture(t)
	ctx := context.Background()
	o, err := s.Create(ctx, user, id("key"), "mx-cny-10-v1")
	if err != nil {
		t.Fatal(err)
	}
	channelOrder, err := s.providerOrder(ctx, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = provider.Close(ctx, channelOrder); err != nil {
		t.Fatal(err)
	}
	closed, _ := provider.Query(ctx, channelOrder)
	if err = s.ApplyPayment(ctx, closed); err != nil {
		t.Fatal(err)
	}
	provider.Simulate(o.ID)
	paidEvidence, _ := provider.Query(ctx, channelOrder)
	if err = s.ApplyPayment(ctx, paidEvidence); err != nil {
		t.Fatalf("late verified money was lost: %v", err)
	}
	r, err := s.RequestRefund(ctx, user, id("refund"), o.ID, "unused")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.DecideRefund(ctx, admin, r.ID, "reject", r.Version); err != nil {
		t.Fatal(err)
	}
	w, err := s.Wallet(ctx, user)
	if err != nil || w.Available != "100" || w.Frozen != "0" {
		t.Fatalf("rejected refund did not release freeze: %+v %v", w, err)
	}
	if _, err = s.RequestRefund(ctx, user, id("again"), o.ID, "reapply"); err != nil {
		t.Fatalf("rejected request blocked reapplication: %v", err)
	}
}

func TestCancelPendingFreesOrderLimitAfterChannelClose(t *testing.T) {
	s, user, _, provider := fixture(t)
	ctx := context.Background()
	ids := make([]string, 3)
	for i := range ids {
		o, err := s.Create(ctx, user, id("key"), "mx-cny-100-v1")
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = o.ID
	}
	if _, err := s.Create(ctx, user, id("key"), "mx-cny-500-v1"); !errors.Is(err, ErrConflict) {
		t.Fatalf("fourth pending order should be limited: %v", err)
	}
	if _, err := s.Cancel(ctx, "another-account", ids[0]); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another account cancelled an order: %v", err)
	}
	closing, err := s.Cancel(ctx, user, ids[0])
	if err != nil || !closing.CloseRequested || closing.State != "pending" {
		t.Fatalf("cancel request: %+v %v", closing, err)
	}
	if _, err = s.Cancel(ctx, user, ids[0]); err != nil {
		t.Fatalf("cancel must be idempotent: %v", err)
	}
	if _, err = s.tickJob(ctx, ids[0]); err != nil {
		t.Fatal(err)
	}
	closed, err := s.Order(ctx, user, ids[0])
	if err != nil || closed.State != "closed" {
		t.Fatalf("unsubmitted order not closed: %+v %v", closed, err)
	}
	if _, err = s.Create(ctx, user, id("key"), "mx-cny-500-v1"); err != nil {
		t.Fatalf("500-yuan order remained blocked: %v", err)
	}
	if _, err = s.Cancel(ctx, user, ids[1]); err != nil {
		t.Fatal(err)
	}
	if _, err = s.tickJob(ctx, ids[1]); err != nil {
		t.Fatal(err)
	}
	// A channel-backed order must be closed by the provider before its slot is released.
	ready, err := s.Create(ctx, user, id("key"), "mx-cny-100-v1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.tickJob(ctx, ready.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Cancel(ctx, user, ready.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.tickJob(ctx, ready.ID); err != nil {
		t.Fatal(err)
	}
	channelOrder, err := s.providerOrder(ctx, ready.ID)
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := provider.Query(ctx, channelOrder)
	if err != nil || evidence.State != "CLOSED" {
		t.Fatalf("channel not closed: %+v %v", evidence, err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE mx_point_jobs SET available_at=clock_timestamp() WHERE id=$1`, ready.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.tickJob(ctx, ready.ID); err != nil {
		t.Fatal(err)
	}
	closed, err = s.Order(ctx, user, ready.ID)
	if err != nil || closed.State != "closed" {
		t.Fatalf("channel close not recorded: %+v %v", closed, err)
	}
}

func TestAmountlessClosedQueryCannotGrantPoints(t *testing.T) {
	s, user, _, _ := fixture(t)
	ctx := context.Background()
	o, err := s.Create(ctx, user, id("key"), "mx-cny-100-v1")
	if err != nil {
		t.Fatal(err)
	}
	// The real WeChat CLOSED query omits amount and currency. It is sufficient
	// to close this order, but never sufficient to credit the wallet.
	if _, err = s.Pool.Exec(ctx, `UPDATE mx_point_orders SET channel='wechat' WHERE id=$1`, o.ID); err != nil {
		t.Fatal(err)
	}
	v := payments.Evidence{ID: id("query:"), OrderID: o.ID, Merchant: s.Merchant, AppID: s.AppID, State: "CLOSED", Source: "query"}
	if err = s.ApplyPayment(ctx, v); err != nil {
		t.Fatal(err)
	}
	closed, err := s.Order(ctx, user, o.ID)
	if err != nil || closed.State != "closed" {
		t.Fatalf("closed state missing: %+v %v", closed, err)
	}
	wallet, err := s.Wallet(ctx, user)
	if err != nil || wallet.Available != "0" {
		t.Fatalf("closed order credited wallet: %+v %v", wallet, err)
	}
	v.State = "SUCCESS"
	v.ID = id("query:")
	if err = s.ApplyPayment(ctx, v); !errors.Is(err, ErrEvidence) {
		t.Fatalf("amountless success was accepted: %v", err)
	}
}

type ambiguousProvider struct {
	*payments.TestProvider
	mu      sync.Mutex
	creates int
}

func (p *ambiguousProvider) Create(context.Context, payments.Order) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.creates++
	return "", errors.New("ambiguous test dispatch")
}
func TestAmbiguousCheckoutQueriesWithoutSecondPost(t *testing.T) {
	s, user, admin, base := fixture(t)
	p := &ambiguousProvider{TestProvider: base}
	s.Provider = p
	ctx := context.Background()
	o, err := s.Create(ctx, user, id("key"), "mx-cny-10-v1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Tick(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE mx_point_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1`, o.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Tick(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE mx_point_jobs SET state='manual' WHERE id=$1`, o.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.RecheckJob(ctx, user, o.ID, "check"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("user woke manual channel job: %v", err)
	}
	if err = s.RecheckJob(ctx, admin, o.ID, "check"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Tick(ctx, 1); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	count := p.creates
	p.mu.Unlock()
	if count != 1 {
		t.Fatalf("ambiguous order POST retried %d times", count)
	}
	current, err := s.Order(ctx, user, o.ID)
	if err != nil || current.CheckoutState != "unknown" {
		t.Fatalf("ambiguous checkout state lost: %+v %v", current, err)
	}
}

func TestSubunitDecimal(t *testing.T) {
	for input, expected := range map[string]int64{"0.000001": 1, "10.5": 10_500_000, "5000": 5_000_000_000} {
		actual, err := Subunits(input)
		if err != nil || actual != expected || Points(actual) != input {
			t.Fatalf("decimal roundtrip %s: %d %v", input, actual, err)
		}
	}
	for _, bad := range []string{"-1", "1.0000001", "1e2", "", "9223372036855"} {
		if _, err := Subunits(bad); err == nil {
			t.Fatalf("invalid decimal accepted: %s", bad)
		}
	}
}

func TestSalesModeGuard(t *testing.T) {
	t.Setenv("MATERIALSX_MX03_PAYMENT_MODE", "wechat")
	if _, err := FromPayments(nil, &payments.Store{}, "production"); !errors.Is(err, ErrDisabled) {
		t.Fatal("real MX sales enabled before release gate")
	}
	t.Setenv("MATERIALSX_MX03_PAYMENT_MODE", "test")
	if _, err := FromPayments(nil, &payments.Store{Mode: "test", Provider: payments.NewTestProvider("m", "a")}, "production"); !errors.Is(err, ErrDisabled) {
		t.Fatal("synthetic checkout enabled in production")
	}
}
