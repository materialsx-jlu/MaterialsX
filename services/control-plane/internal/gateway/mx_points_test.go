package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jamip/materialsx/control-plane/internal/mxpoints"
	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/payments"
)

func TestMXPointRoutesSeparateFromLegacyWallet(t *testing.T) {
	f := workspaceTest(t)
	provider := f.h.Payments.Provider.(*payments.TestProvider)
	mx := &mxpoints.Store{Pool: f.h.S.Pool, Provider: provider, Merchant: "synthetic", AppID: "app", Mode: "disabled"}
	MountMXPoints(f.h, mx)
	request := func(method, path, body, key string, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://ops.test"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", key)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		f.parent.ServeHTTP(w, r)
		return w
	}
	if w := request("GET", "/v1/mx-points/wallet", "", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated MX wallet HTTP %d", w.Code)
	}
	catalog := request("GET", "/v1/mx-points/products", "", "", f.token)
	if catalog.Code != 200 || !strings.Contains(catalog.Body.String(), `"salesEnabled":false`) {
		t.Fatalf("sales gate absent: %d %s", catalog.Code, catalog.Body.String())
	}
	if w := request("GET", "/v1/mx-points/prices", "", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated retail price HTTP %d", w.Code)
	}
	raw, err := os.ReadFile("../../../../docs/V0_3_ROOTFLOWAI_PRICING.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = mxpricing.ImportSnapshot(context.Background(), mx.Pool, raw); err != nil {
		t.Fatal(err)
	}
	prices := request("GET", "/v1/mx-points/prices", "", "", f.token)
	if prices.Code != 200 || !strings.Contains(prices.Body.String(), `"status":"draft"`) || !strings.Contains(prices.Body.String(), `"salesEnabled":false`) || !strings.Contains(prices.Body.String(), `"retailVsOfficialPercentApprox":"50"`) || strings.Contains(prices.Body.String(), "gpt-6-sol") || strings.Contains(prices.Body.String(), "purchaseQuotaPer1m") || strings.Contains(prices.Body.String(), "SOURCE_TO_CNY") {
		t.Fatalf("retail catalog leaked private layer or availability: %d %s", prices.Code, prices.Body.String())
	}
	payload := `{"productVersionId":"mx-cny-10-v1"}`
	if w := request("POST", "/v1/mx-points/orders", payload, "mx-create", f.token); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("closed sales created order HTTP %d", w.Code)
	}
	mx.Mode = "test"
	created := request("POST", "/v1/mx-points/orders", payload, "mx-create", f.token)
	if created.Code != 200 {
		t.Fatalf("diagnostic order HTTP %d: %s", created.Code, created.Body.String())
	}
	var order mxpoints.Order
	if json.Unmarshal(created.Body.Bytes(), &order) != nil || order.AmountFen != "1000" || order.Points != "100" || order.Channel != "test" {
		t.Fatalf("server did not fix amount/points: %+v", order)
	}
	if w := request("POST", "/v1/mx-points/orders", `{"productVersionId":"mx-cny-10-v1","amountFen":"1"}`, "mx-tamper", f.token); w.Code != http.StatusBadRequest {
		t.Fatalf("client amount override accepted: %d", w.Code)
	}
	if w := request("GET", "/v1/mx-points/orders/"+order.ID, "", "", f.token); w.Code != 200 {
		t.Fatalf("owner cannot read MX order: %d", w.Code)
	}
	if w := request("GET", "/v1/mx-points/wallet", "", "", f.token); w.Code != 200 || !strings.Contains(w.Body.String(), `"unit":"mx-point"`) {
		t.Fatalf("MX wallet unavailable: %d", w.Code)
	}
}

func TestMXRetailCatalogIncludesPublishedOnboardedModels(t *testing.T) {
	f := workspaceTest(t)
	mx := &mxpoints.Store{Pool: f.h.S.Pool, Mode: "wechat-live"}
	MountMXPoints(f.h, mx)
	raw, err := os.ReadFile("../../../../docs/V0_3_ROOTFLOWAI_PRICING.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = mxpricing.ImportSnapshot(context.Background(), mx.Pool, raw); err != nil {
		t.Fatal(err)
	}
	if _, err = mxpricing.ApproveSnapshot(context.Background(), mx.Pool, raw); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, candidate := range []struct{ id, status string }{{"published-new-model", "active"}, {"unpublished-new-model", "canary"}} {
		price := mxpricing.OnboardingPrice{Currency: "CNY", CNYPerUnit: "1", Tiers: []mxpricing.Tier{{
			ID: "standard", MinInput: 0,
			Purchase: [4]string{"1", "2", "0.1", "0.2"},
			Retail:   [4]string{"10", "20", "1", "2"},
		}}}
		bundle, err := mxpricing.NewOnboardingBundle(candidate.id, 1, price)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := mx.Pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err = mxpricing.InsertOnboardingBundle(ctx, tx, bundle); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO mx_cloud_models
		 (id,display_name,provider,supplier_model,proxy_alias,api_base,protocol,credential_env,status,purchase_version_id,fx_version_id,retail_version_id,route_version,canary_account,created_by)
		 VALUES($1,$1,'test',$1,$2,'https://example.invalid/v1','responses','TEST_KEY',$3,$4,$5,$6,$7,$8,$9)`,
			candidate.id, "mx-"+candidate.id, candidate.status, bundle.Purchase.ID, bundle.FX.ID, bundle.Retail.ID, "route-"+candidate.id, f.p.ID, f.p.ID)
		if err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err = tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	response := f.user("/v1/mx-points/prices")
	if response.Code != 200 {
		t.Fatalf("retail catalog HTTP %d: %s", response.Code, response.Body.String())
	}
	var catalog mxpoints.RetailCatalog
	if err = json.Unmarshal(response.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Models) != 4 {
		t.Fatalf("expected 3 base models and 1 published model, got %d", len(catalog.Models))
	}
	for _, model := range catalog.Models {
		if model.ID == "unpublished-new-model" {
			t.Fatal("canary price leaked into public catalog")
		}
		if model.ID == "published-new-model" {
			if model.PriceVersionID == "" || model.RetailVsOfficialPercentApprox != nil || len(model.Tiers) != 1 || model.Tiers[0].MXPointsPer1M[0] != "10" {
				t.Fatalf("published model price is incomplete: %+v", model)
			}
			t.Setenv("MATERIALSX_ENV", "production")
			before := f.user("/v1/mx-points/prices")
			if before.Code != 200 {
				t.Fatalf("production catalog: %s", before.Body.String())
			}
			var pending mxpoints.RetailCatalog
			if e := json.Unmarshal(before.Body.Bytes(), &pending); e != nil || len(pending.Models) != 3 {
				t.Fatalf("undeployed production model visible: %v %+v", e, pending)
			}
			if _, e := mx.Pool.Exec(ctx, `UPDATE mx_cloud_models SET deployed_version=version WHERE id='published-new-model'`); e != nil {
				t.Fatal(e)
			}
			after := f.user("/v1/mx-points/prices")
			var published mxpoints.RetailCatalog
			if e := json.Unmarshal(after.Body.Bytes(), &published); e != nil || len(published.Models) != 4 {
				t.Fatalf("deployed production model missing: %v %+v", e, published)
			}
			return
		}
	}
	t.Fatal("published model missing from retail catalog")
}
