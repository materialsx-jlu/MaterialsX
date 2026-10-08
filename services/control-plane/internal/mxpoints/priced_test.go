package mxpoints

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
)

func num(n int64) *int64 { return &n }

func TestSupplierBillSixDecimalRounding(t *testing.T) {
	if supplierCostState(120750, 120800) != "verified" || supplierCostState(120750, 120750) != "verified" || supplierCostState(120750, 120900) != "disputed" || supplierCostState(120750, 120751) != "disputed" {
		t.Fatal("supplier bill rounding classified incorrectly")
	}
}

func TestUsageHistoryKeepsUnknownChargeAndOwnerBoundary(t *testing.T) {
	s, user, other, provider := fixture(t)
	ctx := context.Background()
	paid(t, s, user, provider, "mx-cny-10-v1")
	raw, err := os.ReadFile("../../../../docs/V0_3_ROOTFLOWAI_PRICING.json")
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := mxpricing.ImportSnapshot(ctx, s.Pool, raw)
	if err != nil {
		t.Fatal(err)
	}
	in := PricedRequest{RequestID: id("req"), ModelID: "gpt-5.6-sol", RouteVersion: "probe-v1", PurchaseVersionID: bundle.Purchase.ID, FXVersionID: bundle.FX.ID, RetailVersionID: bundle.Retail.ID, InputBound: 1000, OutputBound: 1000}
	if _, err = s.ReservePriced(ctx, user, in); err != nil {
		t.Fatal(err)
	}
	history, err := s.Usage(ctx, user)
	if err != nil || len(history) != 1 {
		t.Fatalf("usage: %+v %v", history, err)
	}
	if history[0].RequestID != in.RequestID || history[0].ChargedPoints != nil || history[0].Usage != nil || history[0].State != "reserved" {
		t.Fatalf("unknown charge fabricated: %+v", history[0])
	}
	encoded, _ := json.Marshal(history[0])
	if strings.Contains(string(encoded), "purchasePriceVersionId") || strings.Contains(string(encoded), "supplier_bill") {
		t.Fatal("customer history exposed procurement fields")
	}
	hidden, err := s.Usage(ctx, other)
	if err != nil || len(hidden) != 0 {
		t.Fatalf("cross-account usage visible: %+v %v", hidden, err)
	}
}

func TestPricedReservationPinnedSettlementAndSupplierDifference(t *testing.T) {
	s, user, _, provider := fixture(t)
	ctx := context.Background()
	paid(t, s, user, provider, "mx-cny-10-v1")
	raw, err := os.ReadFile("../../../../docs/V0_3_ROOTFLOWAI_PRICING.json")
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := mxpricing.ImportSnapshot(ctx, s.Pool, raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = mxpricing.ImportSnapshot(ctx, s.Pool, raw); err != nil {
		t.Fatal("idempotent import", err)
	}
	var original string
	if err = s.Pool.QueryRow(ctx, `SELECT body::text FROM mx_retail_price_versions WHERE id=$1`, bundle.Retail.ID).Scan(&original); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE mx_retail_price_versions SET status='approved' WHERE id=$1`, bundle.Retail.ID); err == nil {
		t.Fatal("price version mutated")
	}
	request := PricedRequest{RequestID: id("req"), ModelID: "gpt-5.6-sol", RouteVersion: "probe-v1", PurchaseVersionID: bundle.Purchase.ID, FXVersionID: bundle.FX.ID, RetailVersionID: bundle.Retail.ID, InputBound: 1000, OutputBound: 1000}
	bound, err := s.ReservePriced(ctx, user, request)
	if err != nil || bound != 1268750 {
		t.Fatalf("priced reserve: %d %v", bound, err)
	}
	if again, err := s.ReservePriced(ctx, user, request); err != nil || again != bound {
		t.Fatalf("replay reserve: %d %v", again, err)
	}
	changed := request
	changed.RouteVersion = "other-route"
	if _, err = s.ReservePriced(ctx, user, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed route accepted: %v", err)
	}
	if err = s.Settle(ctx, user, request.RequestID, 1); !errors.Is(err, ErrConflict) {
		t.Fatalf("unpriced settle bypassed receipt: %v", err)
	}
	if err = s.Release(ctx, user, request.RequestID); !errors.Is(err, ErrConflict) {
		t.Fatalf("unpriced release bypassed receipt: %v", err)
	}
	_, err = s.SettlePriced(ctx, user, request.RequestID, mxpricing.Usage{Input: num(500), Output: num(100), CacheRead: num(200)}, "usage-v1")
	if !errors.Is(err, mxpricing.ErrPending) {
		t.Fatalf("missing cache write settled: %v", err)
	}
	var state string
	if err = s.Pool.QueryRow(ctx, `SELECT state FROM mx_point_reservations WHERE id=$1`, request.RequestID).Scan(&state); err != nil || state != "reconciliation_pending" {
		t.Fatalf("missing usage did not hold: %s %v", state, err)
	}
	var anomaly string
	if err = s.Pool.QueryRow(ctx, `SELECT reason FROM mx_pricing_anomalies WHERE request_id=$1`, request.RequestID).Scan(&anomaly); err != nil || anomaly != "usage_pending" {
		t.Fatalf("missing usage anomaly: %s %v", anomaly, err)
	}
	usage := mxpricing.Usage{Input: num(500), Output: num(100), CacheRead: num(200), CacheCreate: num(300)}
	quote, err := s.SettlePriced(ctx, user, request.RequestID, usage, "usage-v1")
	if err != nil || quote.RetailSubunits != 261625 {
		t.Fatalf("settle priced: %+v %v", quote, err)
	}
	if _, err = s.SettlePriced(ctx, user, request.RequestID, usage, "usage-v1"); err != nil {
		t.Fatal("replay settlement", err)
	}
	if _, err = s.SettlePriced(ctx, user, request.RequestID, usage, "changed-usage"); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed evidence accepted: %v", err)
	}
	if err = s.RecordSupplierBill(ctx, user, request.RequestID, "invoice-1", quote.PurchaseEstimateMicrofen+1); err != nil {
		t.Fatal(err)
	}
	if err = s.RecordSupplierBill(ctx, user, request.RequestID, "invoice-1", quote.PurchaseEstimateMicrofen+1); err != nil {
		t.Fatal("bill replay", err)
	}
	if err = s.RecordSupplierBill(ctx, user, request.RequestID, "invoice-2", quote.PurchaseEstimateMicrofen); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed bill accepted: %v", err)
	}
	var delta int64
	if err = s.Pool.QueryRow(ctx, `SELECT difference_microfen FROM mx_cost_discrepancies WHERE request_id=$1`, request.RequestID).Scan(&delta); err != nil || delta != 1 {
		t.Fatalf("missing anomaly: %d %v", delta, err)
	}
	if err = s.Pool.QueryRow(ctx, `SELECT reason FROM mx_pricing_anomalies WHERE request_id=$1`, request.RequestID).Scan(&anomaly); err != nil || anomaly != "supplier_difference" {
		t.Fatalf("supplier difference anomaly: %s %v", anomaly, err)
	}
	var revenue, estimate, estimatedProfit, billedProfit int64
	if err = s.Pool.QueryRow(ctx, `SELECT retail_revenue_microfen::bigint,purchase_estimate_microfen,estimated_gross_profit_microfen::bigint,billed_gross_profit_microfen::bigint FROM mx_pricing_financials WHERE request_id=$1`, request.RequestID).Scan(&revenue, &estimate, &estimatedProfit, &billedProfit); err != nil || revenue != quote.RetailSubunits*10 || estimate != quote.PurchaseEstimateMicrofen || estimatedProfit != revenue-estimate || billedProfit != estimatedProfit-1 {
		t.Fatalf("financial report mismatch: revenue=%d estimate=%d profit=%d billed=%d err=%v", revenue, estimate, estimatedProfit, billedProfit, err)
	}
	wallet, err := s.Wallet(ctx, user)
	if err != nil || wallet.Consumed != "0.261625" || wallet.Held != "0" {
		t.Fatalf("wallet diverged: %+v %v", wallet, err)
	}
	_ = original
}

func TestPricedOverrunRemainsHeld(t *testing.T) {
	s, user, _, provider := fixture(t)
	ctx := context.Background()
	paid(t, s, user, provider, "mx-cny-10-v1")
	raw, _ := os.ReadFile("../../../../docs/V0_3_ROOTFLOWAI_PRICING.json")
	bundle, err := mxpricing.ImportSnapshot(ctx, s.Pool, raw)
	if err != nil {
		t.Fatal(err)
	}
	in := PricedRequest{RequestID: id("req"), ModelID: "claude-opus-5-5", RouteVersion: "probe-v1", PurchaseVersionID: bundle.Purchase.ID, FXVersionID: bundle.FX.ID, RetailVersionID: bundle.Retail.ID, InputBound: 1000, OutputBound: 1000}
	if _, err = s.ReservePriced(ctx, user, in); err != nil {
		t.Fatal(err)
	}
	_, err = s.SettlePriced(ctx, user, in.RequestID, mxpricing.Usage{Input: num(1001), Output: num(0), CacheRead: num(0), CacheCreate: num(0)}, "usage-overrun")
	if !errors.Is(err, mxpricing.ErrPending) {
		t.Fatalf("overrun settled: %v", err)
	}
	wallet, err := s.Wallet(ctx, user)
	if err != nil || wallet.Held == "0" || wallet.Consumed != "0" {
		t.Fatalf("overrun lost hold: %+v %v", wallet, err)
	}
}

func TestSupplierOutputOverrunCapsCustomerDebitButKeepsActualCost(t *testing.T) {
	s, user, _, provider := fixture(t)
	ctx := context.Background()
	paid(t, s, user, provider, "mx-cny-10-v1")
	raw, err := os.ReadFile("../../../../docs/V0_3_ROOTFLOWAI_PRICING.json")
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := mxpricing.ImportSnapshot(ctx, s.Pool, raw)
	if err != nil {
		t.Fatal(err)
	}
	in := PricedRequest{RequestID: id("req"), ModelID: "gpt-5.6-sol", RouteVersion: "probe-v1", PurchaseVersionID: bundle.Purchase.ID, FXVersionID: bundle.FX.ID, RetailVersionID: bundle.Retail.ID, InputBound: 1000, OutputBound: 100}
	if _, err = s.ReservePriced(ctx, user, in); err != nil {
		t.Fatal(err)
	}
	actual := mxpricing.Usage{Input: num(500), Output: num(110), CacheRead: num(0), CacheCreate: num(0)}
	charged, err := s.SettlePriced(ctx, user, in.RequestID, actual, "supplier-terminal-usage")
	if err != nil {
		t.Fatal(err)
	}
	capped := actual
	capped.Output = num(100)
	wantRetail, _ := mxpricing.Price(bundle, in.ModelID, capped)
	wantCost, _ := mxpricing.Price(bundle, in.ModelID, actual)
	if charged.RetailSubunits != wantRetail.RetailSubunits || charged.PurchaseEstimateMicrofen != wantCost.PurchaseEstimateMicrofen {
		t.Fatalf("retail cap or actual procurement lost: %+v", charged)
	}
	var state string
	var rawUsage []byte
	if err = s.Pool.QueryRow(ctx, `SELECT r.state,p.usage FROM mx_point_reservations r JOIN mx_priced_reservations p ON p.request_id=r.id WHERE r.id=$1`, in.RequestID).Scan(&state, &rawUsage); err != nil || state != "settled" || !strings.Contains(string(rawUsage), `"outputTokens": 110`) {
		t.Fatalf("raw supplier usage missing: %s %s %v", state, rawUsage, err)
	}
}
