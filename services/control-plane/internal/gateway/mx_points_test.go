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
