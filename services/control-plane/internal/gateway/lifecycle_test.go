package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/delivery"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSupportOwnershipReplayConsentAndConcurrentVersions(t *testing.T) {
	ctx := context.Background()
	pool := poolFixture(t)
	id, _ := identity.New(pool, []byte(strings.Repeat("K", 32)))
	owner, token := principal(t, id)
	other, _ := principal(t, id)
	admin, e := id.CreateAccount(ctx, "ops@example.test", "Admin", "synthetic-password-only", "admin", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
	if e != nil {
		t.Fatal(e)
	}
	s := lifecycle.Store{Pool: pool, Key: []byte(strings.Repeat("K", 32))}
	in := lifecycle.NewTicket{Subject: "Usage question", Category: "usage", Body: "Please investigate", ReferenceID: ""}
	ticket, e := s.Create(ctx, owner.ID, "ticket-key", in)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.Create(ctx, owner.ID, "ticket-key", in)
	if e != nil || ticket.ID != again.ID {
		t.Fatal("replay", e)
	}
	in.Body = "different"
	if _, e = s.Create(ctx, owner.ID, "ticket-key", in); !errors.Is(e, identity.ErrConflict) {
		t.Fatal("conflicting replay", e)
	}
	if _, e = s.Get(ctx, other.ID, ticket.ID, false); !errors.Is(e, identity.ErrNotFound) {
		t.Fatal("cross-user read", e)
	}
	reply := lifecycle.Reply{Body: "New evidence", State: "open", ExpectedVersion: 1}
	ticket, e = s.Reply(ctx, owner.ID, ticket.ID, "reply-key", false, reply)
	if e != nil || ticket.Version != 2 {
		t.Fatal(e)
	}
	if _, e = s.Reply(ctx, owner.ID, ticket.ID, "stale-key", false, reply); !errors.Is(e, identity.ErrConflict) {
		t.Fatal("stale mutation", e)
	}
	if _, e = s.Attach(ctx, owner.ID, ticket.ID, lifecycle.AttachInput{Name: "test.txt", Text: "fixture", ConsentVersion: ""}); !errors.Is(e, identity.ErrValidation) {
		t.Fatal("no consent", e)
	}
	a, e := s.Attach(ctx, owner.ID, ticket.ID, lifecycle.AttachInput{Name: "test.txt", Text: "fixture", ConsentVersion: "support-text-v1"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Attachment(ctx, other.ID, a.ID, false); !errors.Is(e, identity.ErrNotFound) {
		t.Fatal("cross-user attachment", e)
	}
	text, e := s.Attachment(ctx, admin.ID, a.ID, true)
	if e != nil || text != "fixture" {
		t.Fatal("admin consented read", e)
	}
	if _, e = s.Attach(ctx, owner.ID, ticket.ID, lifecycle.AttachInput{Name: "key.txt", Text: "api_key=synthetic-sensitive-content", ConsentVersion: "support-text-v1"}); !errors.Is(e, identity.ErrValidation) {
		t.Fatal("credential should be refused", e)
	}
	ticket, e = s.Reply(ctx, admin.ID, ticket.ID, "ops-reply", true, lifecycle.Reply{Body: "Investigated", State: "resolved", ExpectedVersion: 2})
	if e != nil {
		t.Fatal(e)
	}
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox`).Scan(&n)
	if n != 1 {
		t.Fatal("notification not transactional", n)
	}
	h := identity.NewHTTP(id, "http://localhost", false)
	g := Mount(h, &Store{Pool: pool})
	g.ConfigureLifecycle(s.Key, "")
	r := httptest.NewRequest(http.MethodGet, "http://localhost/v1/support/tickets", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal("support API", w.Code, w.Body.String())
	}
	r = httptest.NewRequest(http.MethodGet, "http://localhost/ops/api/support", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("ops cookie/MFA bypass", w.Code)
	}
}
func TestUnusedFullRefundPolicyRejectsPartialUsedAndHeld(t *testing.T) {
	s, p, _ := paymentFixture(t)
	ctx := context.Background()
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	product := payments.Product{ID: "unused-full-pack", Name: "Unused-only fixture", Kind: "pack", Currency: "CNY", PriceFen: "100", Credits: "1000", ValidDays: 30, RefundPolicyVersion: "unused-full-v1", RefundRule: "unused-full-v1", TestOnly: true, DailyLimit: "1000", MonthlyLimit: "1000", RequestLimit: 100}
	if e = payments.PutProduct(ctx, tx, product); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	makeOrder := func() payments.Order {
		o, e := s.Create(ctx, p.ID, newID(), product.ID)
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
	o := makeOrder()
	if _, e = s.RequestRefund(ctx, p.ID, "partial", o.ID, "50", "request"); !errors.Is(e, payments.ErrRefund) {
		t.Fatal("partial allowed", e)
	}
	_, e = s.Pool.Exec(ctx, `UPDATE credit_grants SET consumed=1 WHERE id=(SELECT grant_id FROM payment_orders WHERE id=$1)`, o.ID)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.RequestRefund(ctx, p.ID, "used", o.ID, "100", "request"); !errors.Is(e, payments.ErrRefund) {
		t.Fatal("used full allowed", e)
	}
	o = makeOrder()
	s.Pool.Exec(ctx, `UPDATE credit_grants SET held=1 WHERE id=(SELECT grant_id FROM payment_orders WHERE id=$1)`, o.ID)
	if _, e = s.RequestRefund(ctx, p.ID, "held", o.ID, "100", "request"); !errors.Is(e, payments.ErrRefund) {
		t.Fatal("held full allowed", e)
	}
	o = makeOrder()
	r, e := s.RequestRefund(ctx, p.ID, "unused", o.ID, "100", "request")
	if e != nil {
		t.Fatal(e)
	}
	v, e := s.Preview(ctx, r.ID)
	if e != nil || !v.Eligible || v.RecoverCredits != "1000" {
		t.Fatal("unused refund rejected", e, v)
	}
	// Consumed after request, before approval: recheck under the account/order lock.
	s.Pool.Exec(ctx, `UPDATE credit_grants SET consumed=1 WHERE id=(SELECT grant_id FROM payment_orders WHERE id=$1)`, o.ID)
	if e = s.Decide(ctx, p.ID, r.ID, "approve", "approve", r.Version, v.OrderVersion); !errors.Is(e, payments.ErrRefund) {
		t.Fatal("TOCTOU refund", e)
	}
}
func TestLifecycleReadinessAndDurableAlerts(t *testing.T) {
	ctx := context.Background()
	pool := poolFixture(t)
	s := lifecycle.Store{Pool: pool, Key: []byte(strings.Repeat("K", 32))}
	v, e := s.Readiness(ctx, "", RouteVersion)
	if e != nil || v.Ready || v.WorkerHealthy || len(v.Missing) != len(lifecycle.RequiredGates) {
		t.Fatal(v, e)
	}
	if e = s.Tick(ctx, "", 0); e != nil {
		t.Fatal(e)
	}
	v, e = s.Readiness(ctx, "", RouteVersion)
	if e != nil || v.Ready || !v.WorkerHealthy {
		t.Fatal(v, e)
	}
	pool.Exec(ctx, `UPDATE worker_heartbeats SET touched_at=clock_timestamp()-interval '61 seconds'`)
	v, e = s.Readiness(ctx, "", RouteVersion)
	if e != nil || v.WorkerHealthy {
		t.Fatal("stale worker", v, e)
	}
	if (lifecycle.Approvals{}).Missing(time.Now()) == nil {
		t.Fatal("empty approvals passed")
	}
}

// New runtime permissions cannot change credentials/admin roles or manufacture statement revisions.
func TestLifecycleRestrictedRole(t *testing.T) {
	ctx := context.Background()
	pool := poolFixture(t)
	role := "mx_life_" + strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(newID()[:8], "-", "a"), "_", "b"))
	if _, e := pool.Exec(ctx, "CREATE ROLE "+pgx.Identifier{role}.Sanitize()); e != nil {
		t.Fatal(e)
	}
	defer func() {
		pool.Exec(ctx, "DROP OWNED BY "+pgx.Identifier{role}.Sanitize())
		pool.Exec(ctx, "DROP ROLE "+pgx.Identifier{role}.Sanitize())
	}()
	if e := identity.GrantRuntime(ctx, pool, role); e != nil {
		t.Fatal(e)
	}
	conn, e := pool.Acquire(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer conn.Release()
	if _, e = conn.Exec(ctx, "SET ROLE "+pgx.Identifier{role}.Sanitize()); e != nil {
		t.Fatal(e)
	}
	defer conn.Exec(ctx, "RESET ROLE")
	for _, q := range []string{`INSERT INTO accounts(id,email,display_name,password_hash,role) VALUES('bad','bad@example.test','bad','bad','user')`, `UPDATE accounts SET password_hash='bad'`, `UPDATE accounts SET role='admin'`, `UPDATE procurement_statement_lines SET cost_microfen=0`} {
		if _, e = conn.Exec(ctx, q); e == nil {
			t.Fatal("runtime authority", q)
		}
	}
	if _, e = conn.Exec(ctx, `SELECT consume_email_challenge('not-a-token',NULL,'not-an-id')`); e != nil {
		t.Fatal("bounded recovery function inaccessible", e)
	}
}

var _ = delivery.ID

func TestProcurementStatementIsExactImmutableAndDoesNotDebitUser(t *testing.T) {
	ctx := context.Background()
	g, p, m := metered(t)
	grantCredits(t, m, p, "fixture", "10000", time.Now().Add(time.Hour))
	task := meteredTask(t, g, p, "1000")
	payload := map[string]any{"input": "fixture", "max_output_tokens": float64(8)}
	r, _, e := g.Claim(ctx, p, task.ID, newID(), newID(), payload)
	if e != nil {
		t.Fatal(e)
	}
	s := lifecycle.Store{Pool: g.Pool, Key: make([]byte, 32)}
	line := lifecycle.StatementLine{RequestID: r.ID, RouteVersionID: RouteVersion, SourceRef: "synthetic-statement", SourceSHA: strings.Repeat("a", 64), CostMicrofen: "1234567", Reason: "synthetic cost fixture"}
	if e = s.ImportStatement(ctx, p.ID, []lifecycle.StatementLine{line}); !errors.Is(e, identity.ErrValidation) {
		t.Fatal("undispatched import", e)
	}
	if e = g.Dispatched(ctx, r.ID); e != nil {
		t.Fatal(e)
	}
	var before string
	if e = g.Pool.QueryRow(ctx, `SELECT COALESCE(sum(consumed_delta),0)::text FROM credit_ledger`).Scan(&before); e != nil {
		t.Fatal(e)
	}
	if e = s.ImportStatement(ctx, p.ID, []lifecycle.StatementLine{line}); e != nil {
		t.Fatal(e)
	}
	if e = s.ImportStatement(ctx, p.ID, []lifecycle.StatementLine{line}); e != nil {
		t.Fatal("replay", e)
	}
	v, e := s.Costs(ctx)
	if e != nil || v.ActualMicrofen != "1234567" || v.StatementRequests != 1 || v.UnknownRequests != 0 {
		t.Fatal("exact cost", v, e)
	}
	line.CostMicrofen = "0"
	if e = s.ImportStatement(ctx, p.ID, []lifecycle.StatementLine{line}); !errors.Is(e, identity.ErrConflict) {
		t.Fatal("immutable actual cost", e)
	}
	var after string
	g.Pool.QueryRow(ctx, `SELECT COALESCE(sum(consumed_delta),0)::text FROM credit_ledger`).Scan(&after)
	if before != after {
		t.Fatal("cost import debited user")
	}
}
func TestFullRefundRejectsFractionalConsumptionAndReservation(t *testing.T) {
	for _, field := range []string{"paid_consumed_subunits", "paid_held_subunits"} {
		t.Run(field, func(t *testing.T) {
			g, p, _, pay, _ := paidFixture(t)
			ctx := context.Background()
			product := payments.Product{ID: "unused-full-month", Name: "Formal synthetic subscription", Kind: "subscription", Currency: "CNY", PriceFen: "100", Credits: "1000", ValidDays: 30, RefundPolicyVersion: "unused-full-v1", RefundRule: "unused-full-v1", DailyLimit: "1000", MonthlyLimit: "1000", RequestLimit: 100}
			tx, e := g.Pool.Begin(ctx)
			if e != nil {
				t.Fatal(e)
			}
			if e = payments.PutProduct(ctx, tx, product); e != nil {
				t.Fatal(e)
			}
			tx.Commit(ctx)
			oid := newID()
			raw, _ := json.Marshal(product)
			g.Pool.Exec(ctx, `INSERT INTO payment_orders(id,account_id,idempotency_key,fingerprint,product_id,snapshot,amount_fen,currency,test_only,channel,expires_at) VALUES($1,$2,$1,'fixture',$3,$4,100,'CNY',false,'wechat',clock_timestamp()+interval '20 minutes')`, oid, p.ID, product.ID, raw)
			o, e := pay.Order(ctx, p.ID, oid)
			if e != nil {
				t.Fatal(e)
			}
			provider := pay.Provider.(*payments.TestProvider)
			provider.Simulate(o.ID)
			v, e := provider.Query(ctx, o)
			if e != nil {
				t.Fatal(e)
			}
			v.Source = "query"
			if e = pay.ApplyPayment(ctx, v); e != nil {
				t.Fatal("formal paid activation", e)
			}
			if _, e = g.Pool.Exec(ctx, `UPDATE credit_grants SET `+field+`=1 WHERE id=(SELECT grant_id FROM payment_orders WHERE id=$1)`, oid); e != nil {
				t.Fatal(e)
			}
			if _, e = pay.RequestRefund(ctx, p.ID, newID(), oid, "100", "unused"); !errors.Is(e, payments.ErrRefund) {
				t.Fatal("fractional full refund allowed", e)
			}
		})
	}
}

type uncertainMail struct{ calls int }

func (m *uncertainMail) Send(context.Context, string, delivery.Message) error {
	m.calls++
	return errors.New("synthetic uncertainty")
}
func TestNotificationUncertaintyNeverBlindlyRetries(t *testing.T) {
	ctx := context.Background()
	pool := poolFixture(t)
	key := []byte(strings.Repeat("K", 32))
	store := delivery.Store{Pool: pool, Key: key}
	tx, e := pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = store.Enqueue(ctx, tx, "support:fixture", delivery.Message{To: "fixture@example.test", Subject: "Fixture", Text: "Fixture"}); e != nil {
		t.Fatal(e)
	}
	tx.Commit(ctx)
	sender := &uncertainMail{}
	if _, e = store.Tick(ctx, sender); e != nil {
		t.Fatal(e)
	}
	if _, e = store.Tick(ctx, sender); e != nil {
		t.Fatal(e)
	}
	if sender.calls != 1 {
		t.Fatal("ambiguous redelivery", sender.calls)
	}
	s := lifecycle.Store{Pool: pool, Key: key}
	if e = s.Tick(ctx, "", 0); e != nil {
		t.Fatal(e)
	}
	if e = s.Tick(ctx, "", 0); e != nil {
		t.Fatal(e)
	}
	alerts, e := s.Alerts(ctx)
	if e != nil || len(alerts) != 1 {
		t.Fatal("idempotent alert", alerts, e)
	}
}

func TestBetaEnrollmentIsVersionedIdempotentAndDoesNotGrantMoney(t *testing.T) {
	ctx := context.Background()
	pool := poolFixture(t)
	id, _ := identity.New(pool, make([]byte, 32))
	p, _ := principal(t, id)
	s := lifecycle.Store{Pool: pool, Key: make([]byte, 32)}
	if e := s.Enroll(ctx, p.ID, p.ID, "active", "synthetic enrollment", 0, "enroll-key"); e != nil {
		t.Fatal(e)
	}
	if e := s.Enroll(ctx, p.ID, p.ID, "active", "synthetic enrollment", 0, "enroll-key"); e != nil {
		t.Fatal("replay", e)
	}
	items, e := s.Enrollments(ctx)
	if e != nil || len(items) != 1 || items[0].Version != 1 {
		t.Fatal(items, e)
	}
	if e = s.Enroll(ctx, p.ID, p.ID, "revoked", "synthetic change", 0, "other-key"); !errors.Is(e, identity.ErrConflict) {
		t.Fatal("stale enrollment", e)
	}
	if e = s.Enroll(ctx, p.ID, p.ID, "revoked", "synthetic change", 1, "other-key"); e != nil {
		t.Fatal(e)
	}
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM credit_grants`).Scan(&n)
	if n != 0 {
		t.Fatal("enrollment granted money")
	}
}

type syntheticCounter struct{}

func (syntheticCounter) Count(context.Context, map[string]any) (int64, string, error) {
	return 123, "synthetic-count-fixture", nil
}
func TestBetaUsesPersistedCountForSmallBudgetAndRetailCharge(t *testing.T) {
	ctx := context.Background()
	g, p, _, _, _ := paidFixture(t)
	g.Config.PaidAccount = "*"
	g.Config.Counter = syntheticCounter{}
	g.Config.SalesPriceVersion = metering.CountedPaidPriceID
	a := lifecycle.Approvals{Version: "m5-beta-approval-v1", RouteVersion: RouteVersion, RefundRule: "unused-full-v1"}
	now := time.Now().UTC()
	for _, id := range lifecycle.RequiredGates {
		a.Gates = append(a.Gates, lifecycle.Gate{ID: id, EvidenceRef: "synthetic-fixture", SHA256: strings.Repeat("a", 64), ApprovedBy: "fixture", ApprovedAt: now.Add(-time.Minute), ExpiresAt: now.Add(time.Hour)})
	}
	raw, _ := json.Marshal(a)
	file := filepath.Join(t.TempDir(), "approvals.json")
	os.WriteFile(file, raw, 0600)
	g.Config.ApprovalsPath = file
	tx, e := g.Pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = metering.PutPrice(ctx, tx, metering.CountedPaidPrice("synthetic-fixture")); e != nil {
		t.Fatal(e)
	}
	if _, e = tx.Exec(ctx, `INSERT INTO beta_enrollments(account_id,state,actor_id,reason) VALUES($1,'active',$1,'synthetic-fixture')`, p.ID); e != nil {
		t.Fatal(e)
	}
	tx.Commit(ctx)
	task := paidTask(t, g, p, "1")
	payload := map[string]any{"input": "fixture", "max_output_tokens": float64(8)}
	r, _, e := g.Claim(ctx, p, task.ID, newID(), newID(), payload)
	if e != nil || r.Reserved != "0.203" {
		t.Fatal("small verified count reserve", r.Reserved, e)
	}
	var count int64
	g.Pool.QueryRow(ctx, `SELECT counted_input_tokens FROM gateway_requests WHERE id=$1`, r.ID).Scan(&count)
	if count != 123 {
		t.Fatal("count not persisted")
	}
	g.Dispatched(ctx, r.ID)
	u := rootflow.Usage{Source: "responses", Input: i64(10), Output: i64(4), Cached: i64(2), Uncached: i64(8), Reasoning: i64(1)}
	if e = g.Finish(ctx, r.ID, "completed", "", 200, true, &u); e != nil {
		t.Fatal(e)
	}
	r, e = g.Request(ctx, p.ID, r.ID)
	if e != nil || r.Charged == nil || *r.Charged != "0.0482" {
		t.Fatal("retail charge", r, e)
	}
}
