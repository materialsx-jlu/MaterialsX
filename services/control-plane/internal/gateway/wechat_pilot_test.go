package gateway

import (
	"context"
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"sync"
	"testing"
	"time"
)

type pilotProvider struct {
	payments.Provider
	evidence payments.Evidence
}

func (p pilotProvider) Query(_ context.Context, o payments.Order) (payments.Evidence, error) {
	v := p.evidence
	v.OrderID = o.ID
	return v, nil
}
func pilotFixture(t *testing.T) (*payments.Store, identity.Principal) {
	s, p, _ := paymentFixture(t)
	s.Mode = "wechat-pilot"
	s.PilotAccount = p.ID
	ctx := context.Background()
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	for _, v := range []payments.Product{payments.PilotSubscription(), payments.PilotDiagnosticPack()} {
		if e = payments.PutProduct(ctx, tx, v); e != nil {
			t.Fatal(e)
		}
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	return s, p
}
func TestWechatPilotAtomicGrantPeriodAndCap(t *testing.T) {
	s, p := pilotFixture(t)
	ctx := context.Background()
	if _, e := s.Create(ctx, "other-account", newID(), payments.PilotSubscription().ID); !errors.Is(e, payments.ErrDisabled) {
		t.Fatal("foreign pilot account", e)
	}
	if _, e := s.Create(ctx, p.ID, newID(), "test-pack"); !errors.Is(e, payments.ErrDisabled) {
		t.Fatal("test product in real channel", e)
	}
	key := newID()
	o, e := s.Create(ctx, p.ID, key, payments.PilotSubscription().ID)
	if e != nil {
		t.Fatal(e)
	}
	replay, e := s.Create(ctx, p.ID, key, payments.PilotSubscription().ID)
	if e != nil || replay.ID != o.ID {
		t.Fatal("replay", e)
	}
	if _, e = s.Create(ctx, p.ID, newID(), payments.PilotSubscription().ID); !errors.Is(e, payments.ErrDisabled) {
		t.Fatal("one-yuan cap", e)
	}
	v := payments.Evidence{ID: "pilot-query", OrderID: o.ID, TransactionID: "pilot-transaction", State: "SUCCESS", Total: 100, Currency: "CNY", Merchant: s.Merchant, AppID: s.AppID, Source: "query", PaidAt: time.Now().UTC().Truncate(time.Second)}
	bad := v
	bad.Total = 1
	if e = s.ApplyPayment(ctx, bad); !errors.Is(e, payments.ErrEvidence) {
		t.Fatal("wrong amount", e)
	}
	bad = v
	bad.Source = "test"
	if e = s.ApplyPayment(ctx, bad); !errors.Is(e, payments.ErrEvidence) {
		t.Fatal("synthetic evidence", e)
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
			t.Fatal(e)
		}
	}
	v.ID = "pilot-notification"
	v.Source = "notification"
	if e = s.ApplyPayment(ctx, v); e != nil {
		t.Fatal(e)
	}
	v.ID = "late-notpay"
	v.State = "NOTPAY"
	if e = s.ApplyPayment(ctx, v); e != nil {
		t.Fatal(e)
	}
	m := &metering.Store{Pool: s.Pool}
	w, e := m.Wallet(ctx, p.ID)
	if e != nil || w.Purchased.Available != "1000" || w.Available != "0" {
		t.Fatal("separate wallet", w, e)
	}
	periods, e := s.Periods(ctx, p.ID)
	if e != nil || len(periods) != 1 || periods[0].State != "active" || !periods[0].Starts.Equal(v.PaidAt) {
		t.Fatal("one active period", periods, e)
	}
	if !periods[0].Ends.After(periods[0].Starts.Add(27*24*time.Hour)) || periods[0].Ends.After(periods[0].Starts.Add(32*24*time.Hour)) {
		t.Fatal("calendar month")
	}
	if n, e := m.Verify(ctx); e != nil || n != 1 {
		t.Fatal("ledger rebuild", n, e)
	}
	var count int
	if e = s.Pool.QueryRow(ctx, `SELECT count(*) FROM payment_activations`).Scan(&count); e != nil || count != 0 {
		t.Fatal("real payments do not enable synthetic usage", e)
	}
}
func TestWechatPilotHistoricImportAndTestConsumptionIsolation(t *testing.T) {
	s, p := pilotFixture(t)
	ctx := context.Background()
	id := "mxp0123456789abcdef01234567"
	v := payments.Evidence{ID: "historic-query", TransactionID: "historic-transaction", State: "SUCCESS", Total: 1, Currency: "CNY", Merchant: s.Merchant, AppID: s.AppID, Source: "query", PaidAt: time.Now().UTC().Truncate(time.Second)}
	bad := v
	bad.Total = 2
	s.Provider = pilotProvider{evidence: bad}
	if _, e := s.ImportPaidDiagnostic(ctx, id); !errors.Is(e, payments.ErrEvidence) {
		t.Fatal("unmatched historical payment", e)
	}
	var count int
	_ = s.Pool.QueryRow(ctx, `SELECT count(*) FROM payment_orders WHERE id=$1`, id).Scan(&count)
	if count != 0 {
		t.Fatal("bad evidence created order")
	}
	s.Provider = pilotProvider{evidence: v}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := s.ImportPaidDiagnostic(ctx, id); errs <- e }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	if _, e := s.ImportPaidDiagnostic(ctx, "mxp1123456789abcdef01234567"); !errors.Is(e, payments.ErrDisabled) {
		t.Fatal("historic import cap", e)
	}
	m := &metering.Store{Pool: s.Pool}
	w, e := m.Wallet(ctx, p.ID)
	if e != nil || w.Purchased.Available != "10" || w.Available != "0" {
		t.Fatal("historic grants", w, e)
	}
	// Technical model calls cannot reserve real money's denomination, even if
	// daily policy exists and the paid grant otherwise meets validity criteria.
	gs := &Store{Pool: s.Pool, Config: Config{Enabled: true, MaxRequests: 16, MaxOutputTokens: 1024, MaxDurationSeconds: 180, MaxConcurrent: 8, SalesPriceVersion: "test-sales-v1"}}
	task := meteredTask(t, gs, p, "1000")
	_, _, e = gs.Claim(ctx, p, task.ID, newID(), newID(), native())
	if !errors.Is(e, metering.ErrBalance) {
		t.Fatal("paid credits spent by test route", e)
	}
	entries, _, e := m.Ledger(ctx, p.ID, "")
	if e != nil || len(entries) != 1 || entries[0].Unit != "paid-credit" {
		t.Fatal("ledger denomination", entries, e)
	}
	if n, e := m.Verify(ctx); e != nil || n != 1 {
		t.Fatal("historic rebuild", n, e)
	}
}
func TestWechatPilotNoConcurrentSecondPurchase(t *testing.T) {
	s, p := pilotFixture(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := s.Create(ctx, p.ID, newID(), payments.PilotSubscription().ID)
			errs <- e
		}()
	}
	wg.Wait()
	close(errs)
	successes := 0
	for e := range errs {
		if e == nil {
			successes++
		} else if !errors.Is(e, payments.ErrDisabled) {
			t.Fatal(e)
		}
	}
	if successes != 1 {
		t.Fatal("concurrent cap", successes)
	}
}
