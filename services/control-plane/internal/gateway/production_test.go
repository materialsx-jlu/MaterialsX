package gateway

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jamip/materialsx/control-plane/internal/mxrelease"
)

func approvedReleaseFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	now := time.Now().UTC()
	a := mxrelease.Approval{SchemaVersion: "mx-production-release-v1", ReleaseID: mxrelease.PriceVersion,
		PriceVersion: mxrelease.PriceVersion, APIOrigin: "https://api.fixture-materialsx.org", MerchantID: "1900000000",
		RefundRule: "unused-full-v1", ExpiresAt: now.Add(time.Hour),
		Routes: []mxrelease.Route{{ModelID: mx03Routes[0].ModelID, Version: mx03Routes[0].Version}}}
	for _, kind := range []string{"price-and-fx", "supplier-usage", "merchant-and-callback", "unused-full-refund", "wallet-reconciliation", "release-approval"} {
		body := []byte("fixture proof: " + kind)
		path := filepath.Join(dir, kind)
		if err := os.WriteFile(path, body, 0600); err != nil {
			t.Fatal(err)
		}
		h := sha256.Sum256(body)
		a.Evidence = append(a.Evidence, mxrelease.Evidence{Kind: kind, Path: path, SHA256: hex.EncodeToString(h[:]), ApprovedBy: "fixture-reviewer", ApprovedAt: now.Add(-time.Minute)})
	}
	raw, err := json.Marshal(a)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "approval.json")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestProductionGatewayNeedsMatchingPaymentAndApproval(t *testing.T) {
	path := approvedReleaseFixture(t)
	t.Setenv("MATERIALSX_CLOUD_MODE", "mx-production")
	t.Setenv("MATERIALSX_MX03_GATEWAY_MODE", "wallet-production")
	t.Setenv("MATERIALSX_MX03_PRICE_VERSION", mxrelease.PriceVersion)
	t.Setenv("MATERIALSX_MX_PRODUCTION_APPROVAL_FILE", path)
	t.Setenv("MATERIALSX_PAYMENT_MODE", "wechat-native")
	t.Setenv("MATERIALSX_MX03_PAYMENT_MODE", "wechat-production")
	t.Setenv("MATERIALSX_IDENTITY_PUBLIC_URL", "https://api.fixture-materialsx.org")
	t.Setenv("MATERIALSX_LITELLM_URL", "http://127.0.0.1:4000")
	t.Setenv("MATERIALSX_LITELLM_GATEWAY_KEY", "sk-fixture-key")
	t.Setenv("MATERIALSX_METERING_PRICE_VERSION", "")
	t.Setenv("MATERIALSX_PROCUREMENT_PRICE_VERSION", "")
	t.Setenv("MATERIALSX_MX03_DIAGNOSTIC_MODELS", "")
	c, err := ConfigFromEnv()
	if err != nil || !c.MX03Wallet || !c.Routes[mx03Routes[0].ModelID].Enabled || c.Routes[mx03Routes[1].ModelID].Enabled {
		t.Fatalf("approved route not gated: %v", err)
	}
	if legacy, _ := c.route(ModelAlias); legacy.Enabled {
		t.Fatal("legacy route leaked into MX production")
	}
	t.Setenv("MATERIALSX_PAYMENT_MODE", "disabled")
	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("gateway enabled without formal payment")
	}
	t.Setenv("MATERIALSX_PAYMENT_MODE", "wechat-native")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	c, err = ConfigFromEnv()
	if err != nil || c.Routes[mx03Routes[0].ModelID].Enabled || (&Store{Config: c}).betaCurrent(context.Background()) {
		t.Fatalf("revoked release admitted new tasks: %v", err)
	}
}
