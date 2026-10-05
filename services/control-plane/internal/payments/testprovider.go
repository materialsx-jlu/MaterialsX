package payments

import (
	"context"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"sync"
	"time"
)

// Explicit synthetic provider. It cannot send network requests or produce a scannable payment URL.
// Simulation is admin-only, unavailable in production; upstream state is in memory, not real money.
type TestProvider struct {
	mu            sync.Mutex
	merchant, app string
	paid          map[string]time.Time
	closed        map[string]bool
	refunds       map[string]bool
}

func NewTestProvider(merchant, app string) *TestProvider {
	return &TestProvider{merchant: merchant, app: app, paid: map[string]time.Time{}, closed: map[string]bool{}, refunds: map[string]bool{}}
}
func (p *TestProvider) Simulate(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, ok := p.paid[id]; !ok {
		p.paid[id] = time.Now().UTC()
	}
}
func (p *TestProvider) Create(_ context.Context, _ Order) (string, error) {
	return "test://not-a-real-payment", nil
}
func (p *TestProvider) Query(_ context.Context, o Order) (Evidence, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	n, _ := metering.Amount(o.AmountFen)
	v := Evidence{OrderID: o.ID, Merchant: p.merchant, AppID: p.app, Currency: "CNY", Total: n, State: "NOTPAY", Source: "test"}
	if p.closed[o.ID] {
		v.State = "CLOSED"
	}
	if t, ok := p.paid[o.ID]; ok {
		v.State = "SUCCESS"
		v.PaidAt = t
		v.TransactionID = "test:" + o.ID
	}
	v.ID = "test:" + fp(v)
	return v, nil
}
func (p *TestProvider) Close(_ context.Context, o Order) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed[o.ID] = true
	return nil
}
func (p *TestProvider) Refund(ctx context.Context, o Order, r Refund) (Evidence, error) {
	p.mu.Lock()
	p.refunds[r.ID] = true
	p.mu.Unlock()
	return p.QueryRefund(ctx, o, r)
}
func (p *TestProvider) QueryRefund(_ context.Context, o Order, r Refund) (Evidence, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.refunds[r.ID] {
		return Evidence{}, ErrNotFound
	}
	total, _ := metering.Amount(o.AmountFen)
	n, _ := metering.Amount(r.AmountFen)
	v := Evidence{OrderID: o.ID, RefundID: r.ID, ProviderRefundID: "test-refund:" + r.ID, TransactionID: "test:" + o.ID, Merchant: p.merchant, AppID: p.app, Currency: "CNY", Total: total, Refund: n, State: "SUCCESS", Source: "test"}
	v.ID = "test:" + fp(v)
	return v, nil
}
