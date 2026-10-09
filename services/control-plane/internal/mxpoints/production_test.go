package mxpoints

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/mxrelease"
	"github.com/jamip/materialsx/control-plane/internal/payments"
)

func TestProductionWalletCannotBeEnabledByOneSwitch(t *testing.T) {
	t.Setenv("MATERIALSX_MX03_PAYMENT_MODE", "wechat-production")
	t.Setenv("MATERIALSX_CLOUD_MODE", "mx-production")
	t.Setenv("MATERIALSX_MX03_GATEWAY_MODE", "wallet-production")
	t.Setenv("MATERIALSX_MX03_PRICE_VERSION", mxpricing.ApprovedVersion)
	pay := &payments.Store{Mode: "wechat-native", Provider: &payments.Wechat{}, Merchant: "fixture-merchant",
		MXOnly: true, MXReleaseID: mxpricing.ApprovedVersion, MXReleasePath: "/private/approval.json", MXAPIOrigin: "https://api.fixture-materialsx.org"}
	s, err := FromPayments(nil, pay, "production")
	if err != nil || s.Mode != "wechat-production" || s.ProductionReady(nil) {
		t.Fatalf("production recovery state invalid: %v", err)
	}
	for name, mutate := range map[string]func(){
		"development": func() { t.Setenv("MATERIALSX_MX03_PAYMENT_MODE", "wechat-live") },
		"wallet off":  func() { t.Setenv("MATERIALSX_MX03_GATEWAY_MODE", "") },
		"wrong price": func() { t.Setenv("MATERIALSX_MX03_PRICE_VERSION", "draft") },
	} {
		t.Run(name, func(t *testing.T) {
			mutate()
			if _, err := FromPayments(nil, pay, "production"); !errors.Is(err, ErrDisabled) {
				t.Fatalf("one-sided sale accepted: %v", err)
			}
		})
	}
}

func TestProductionSalesCloseOnReleaseRevocation(t *testing.T) {
	s, user, _, _ := fixture(t)
	ctx := context.Background()
	raw, err := os.ReadFile("../../../../docs/V0_3_ROOTFLOWAI_PRICING.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mxpricing.ApproveSnapshot(ctx, s.Pool, raw); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	dir := t.TempDir()
	a := mxrelease.Approval{SchemaVersion: "mx-production-release-v1", ReleaseID: mxrelease.PriceVersion,
		PriceVersion: mxrelease.PriceVersion, APIOrigin: "https://api.fixture-materialsx.org", MerchantID: s.Merchant,
		RefundRule: "unused-full-v1", ExpiresAt: now.Add(time.Hour),
		Routes: []mxrelease.Route{{ModelID: "gpt-5.6-sol", Version: "mx03-gpt56-litellm-responses-20261007-v1"}}}
	for _, kind := range []string{"price-and-fx", "supplier-usage", "merchant-and-callback", "unused-full-refund", "wallet-reconciliation", "release-approval"} {
		body := []byte("fixture: " + kind)
		path := filepath.Join(dir, kind)
		if err := os.WriteFile(path, body, 0600); err != nil {
			t.Fatal(err)
		}
		h := sha256.Sum256(body)
		a.Evidence = append(a.Evidence, mxrelease.Evidence{Kind: kind, Path: path, SHA256: hex.EncodeToString(h[:]), ApprovedBy: "fixture-reviewer", ApprovedAt: now.Add(-time.Minute)})
	}
	approval := filepath.Join(dir, "approval.json")
	body, _ := json.Marshal(a)
	if err := os.WriteFile(approval, body, 0600); err != nil {
		t.Fatal(err)
	}
	s.Mode, s.ReleaseID, s.ReleasePath, s.APIOrigin = "wechat-production", a.ReleaseID, approval, a.APIOrigin
	if _, err := s.Pool.Exec(ctx, `INSERT INTO worker_heartbeats(name) VALUES('billing')`); err != nil {
		t.Fatal(err)
	}
	if !s.ProductionReady(ctx) {
		t.Fatal("approved sales not ready")
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE operations_controls SET sales_paused=true WHERE id`); err != nil {
		t.Fatal(err)
	}
	if s.ProductionReady(ctx) {
		t.Fatal("sales pause did not close admission")
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE operations_controls SET sales_paused=false WHERE id`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE worker_heartbeats SET touched_at=clock_timestamp()-interval '2 minutes' WHERE name='billing'`); err != nil {
		t.Fatal(err)
	}
	if s.ProductionReady(ctx) {
		t.Fatal("stopped billing worker did not close admission")
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE worker_heartbeats SET touched_at=clock_timestamp() WHERE name='billing'`); err != nil {
		t.Fatal(err)
	}
	catalog, err := s.RetailCatalog(ctx)
	if err != nil || !catalog.SalesEnabled || catalog.VersionID != a.ReleaseID+"-retail" || len(catalog.Models) != 1 || catalog.Models[0].ID != "gpt-5.6-sol" {
		t.Fatalf("catalog not on approved release: %v", err)
	}
	key := id("key")
	created, err := s.Create(ctx, user, key, "mx-cny-10-v1")
	if err != nil {
		t.Fatalf("approved order not created: %v", err)
	}
	if err := os.Remove(approval); err != nil {
		t.Fatal(err)
	}
	if s.ProductionReady(ctx) {
		t.Fatal("revoked release stayed ready")
	}
	products, err := s.Products(ctx)
	if err != nil || products[0].Enabled {
		t.Fatalf("revoked product still enabled: %v", err)
	}
	if _, err := s.Create(ctx, user, id("key"), "mx-cny-10-v1"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("revoked release accepted new order: %v", err)
	}
	if repeat, err := s.Create(ctx, user, key, "mx-cny-10-v1"); err != nil || repeat.ID != created.ID {
		t.Fatalf("historical idempotency lost after revocation: %v", err)
	}
	if _, err := s.Orders(ctx, user); err != nil {
		t.Fatalf("history unavailable after revocation: %v", err)
	}
}
