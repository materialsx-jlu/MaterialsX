package gateway

import (
	"context"
	"os"
	"testing"

	"github.com/jamip/materialsx/control-plane/internal/identity"
	"github.com/jamip/materialsx/control-plane/internal/mxpoints"
	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/payments"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
)

func TestMXGatewayWalletSettlesOnlyCompleteUsage(t *testing.T) {
	pool := poolFixture(t)
	ctx := context.Background()
	raw, err := os.ReadFile("../../../../docs/V0_3_ROOTFLOWAI_PRICING.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = mxpricing.ImportSnapshot(ctx, pool, raw); err != nil {
		t.Fatal(err)
	}
	provider := payments.NewTestProvider("synthetic-merchant", "synthetic-app")
	wallet := &mxpoints.Store{Pool: pool, Provider: provider, Merchant: "synthetic-merchant", AppID: "synthetic-app", Mode: "test"}
	ident, err := identity.New(pool, []byte("01234567890123456789012345678901"))
	if err != nil {
		t.Fatal(err)
	}
	user, _ := principal(t, ident)
	order, err := wallet.Create(ctx, user.ID, "mx-gateway-test-order", "mx-cny-10-v1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = wallet.Tick(ctx, 1); err != nil {
		t.Fatal(err)
	}
	provider.Simulate(order.ID)
	evidence, err := provider.Query(ctx, payments.Order{ID: order.ID, AmountFen: order.AmountFen})
	if err != nil {
		t.Fatal(err)
	}
	if err = wallet.ApplyPayment(ctx, evidence); err != nil {
		t.Fatal(err)
	}
	route := mx03Routes[0]
	route.Enabled = true
	route.Provider = &fixtureProvider{}
	store := &Store{Pool: pool, Config: Config{Enabled: true, MX03Diagnostic: true, MX03Wallet: true, MX03PriceVersion: mxpricing.SnapshotVersion,
		MaxOutputTokens: 1024, MaxDurationSeconds: 3600, MaxConcurrent: 8, Routes: map[string]Route{route.ModelID: route}}, MXPoints: wallet}
	create := func() Task {
		task, err := store.Create(ctx, user, CreateTask{ClientID: newID(), Model: route.ModelID, Mode: "mx-points", Budget: Limits{MaxRequests: 1, MaxOutput: 100, MaxDuration: 300}, Consent: Consent{Policy: ConsentVersion, Prompt: true, History: "platform-only"}}, newID())
		if err != nil {
			t.Fatal(err)
		}
		return task
	}
	complete := create()
	requestID := newID()
	claim, _, err := store.Claim(ctx, user, complete.ID, requestID, newID(), map[string]any{"model": route.ModelID, "max_output_tokens": float64(100)})
	if err != nil || claim.Mode != "mx-points" || claim.Settlement != "reserved" {
		t.Fatalf("MX claim: %+v %v", claim, err)
	}
	if err = store.Dispatched(ctx, requestID); err != nil {
		t.Fatal(err)
	}
	n := func(v int64) *int64 { return &v }
	if err = store.Finish(ctx, requestID, "completed", "", 200, true, &rootflow.Usage{Source: "responses", Input: n(100), Output: n(10), Cached: n(20), CacheCreate: n(0)}); err != nil {
		t.Fatal(err)
	}
	receipt, err := store.Request(ctx, user.ID, requestID)
	if err != nil || receipt.Settlement != "settled" || receipt.Charged == nil || *receipt.Charged == "0" {
		t.Fatalf("MX settlement: %+v %v", receipt, err)
	}
	usage, err := wallet.Usage(ctx, user.ID)
	if err != nil || len(usage) != 1 || usage[0].RetailPriceVersionID != mxpricing.SnapshotVersion+"-retail" || usage[0].UsageEvidenceRef == nil {
		t.Fatalf("MX receipt missing: %+v %v", usage, err)
	}
	pending := create()
	pendingID := newID()
	if _, _, err = store.Claim(ctx, user, pending.ID, pendingID, newID(), map[string]any{"model": route.ModelID, "max_output_tokens": float64(100)}); err != nil {
		t.Fatal(err)
	}
	if err = store.Dispatched(ctx, pendingID); err != nil {
		t.Fatal(err)
	}
	if err = store.Finish(ctx, pendingID, "completed", "", 200, true, &rootflow.Usage{Source: "responses", Input: n(100), Output: n(10), Cached: n(20)}); err != nil {
		t.Fatal(err)
	}
	later, err := store.Request(ctx, user.ID, pendingID)
	if err != nil || later.Settlement != "reconciliation_pending" || later.Charged != nil {
		t.Fatalf("missing cache-create was charged: %+v %v", later, err)
	}
	balance, err := wallet.Wallet(ctx, user.ID)
	if err != nil || balance.Held == "0" || balance.Consumed == "0" {
		t.Fatalf("MX ledger not split: %+v %v", balance, err)
	}
	evidenceRow := MXSupplierEvidence{RequestID: pendingID, SupplierRequestID: "supplier-log-100", InputTokens: 101, OutputTokens: 10, CacheReadTokens: 20, CacheCreateTokens: 0, SupplierCostMicrofen: 1}
	if _, err = store.ReconcileMXBill(ctx, evidenceRow); err != ErrConflict {
		t.Fatalf("mismatched supplier usage accepted: %v", err)
	}
	evidenceRow.InputTokens = 100
	quote, err := store.ReconcileMXBill(ctx, evidenceRow)
	if err != nil || quote.RetailSubunits <= 0 {
		t.Fatalf("supplier reconciliation failed: %+v %v", quote, err)
	}
	if _, err = store.ReconcileMXBill(ctx, evidenceRow); err != nil {
		t.Fatalf("idempotent supplier reconciliation failed: %v", err)
	}
	later, err = store.Request(ctx, user.ID, pendingID)
	if err != nil || later.Settlement != "settled" || later.Charged == nil || *later.Charged == "0" {
		t.Fatalf("reconciled wallet receipt missing: %+v %v", later, err)
	}
	var bill, state string
	if err = pool.QueryRow(ctx, `SELECT supplier_bill_microfen::text,cost_state FROM mx_priced_reservations WHERE request_id=$1`, pendingID).Scan(&bill, &state); err != nil || bill != "1" || state != "disputed" {
		t.Fatalf("independent supplier cost not stored: %q %q %v", bill, state, err)
	}
	duplicate := create()
	duplicateID := newID()
	if _, _, err = store.Claim(ctx, user, duplicate.ID, duplicateID, newID(), map[string]any{"model": route.ModelID, "max_output_tokens": float64(100)}); err != nil {
		t.Fatal(err)
	}
	if err = store.Dispatched(ctx, duplicateID); err != nil {
		t.Fatal(err)
	}
	if err = store.Finish(ctx, duplicateID, "completed", "", 200, true, &rootflow.Usage{Source: "responses", Input: n(100), Output: n(10), Cached: n(20)}); err != nil {
		t.Fatal(err)
	}
	evidenceRow.RequestID = duplicateID
	if _, err = store.ReconcileMXBill(ctx, evidenceRow); err == nil {
		t.Fatal("supplier request ID was reused for another wallet debit")
	}
	duplicateReceipt, err := store.Request(ctx, user.ID, duplicateID)
	if err != nil || duplicateReceipt.Settlement != "reconciliation_pending" || duplicateReceipt.Charged != nil {
		t.Fatalf("duplicate supplier evidence changed wallet: %+v %v", duplicateReceipt, err)
	}
	quote, err = store.RepairMXGPTTerminal(ctx, duplicateID)
	if err != nil || quote.RetailSubunits <= 0 {
		t.Fatalf("saved terminal GPT usage was not settled: %+v %v", quote, err)
	}
	duplicateReceipt, err = store.Request(ctx, user.ID, duplicateID)
	if err != nil || duplicateReceipt.Settlement != "settled" || duplicateReceipt.Charged == nil || duplicateReceipt.Usage == nil || duplicateReceipt.Usage.CacheCreate == nil || *duplicateReceipt.Usage.CacheCreate != 0 {
		t.Fatalf("terminal repair receipt incomplete: %+v %v", duplicateReceipt, err)
	}
}
