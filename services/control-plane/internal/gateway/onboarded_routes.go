package gateway

import (
	"context"
	"os"

	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/providers/litellm"
)

// resolveRoute checks the published registry at admission and dispatch time.
// Disabling a model therefore blocks new work without rewriting old ledgers.
func (s *Store) resolveRoute(ctx context.Context, model, account string) (Route, bool) {
	if route, ok := s.Config.route(model); ok {
		return route, true
	}
	if !s.Config.MX03Wallet || s.Pool == nil {
		return Route{}, false
	}
	var route Route
	var status, canary string
	err := s.Pool.QueryRow(ctx, `SELECT id,supplier_model,proxy_alias,route_version,protocol,purchase_version_id,fx_version_id,retail_version_id,status,COALESCE(canary_account,'') FROM mx_cloud_models WHERE id=$1 AND status IN ('canary','active')`, model).Scan(&route.ModelID, &route.SupplierModel, &route.UpstreamAlias, &route.Version, &route.Protocol, &route.PurchaseVersionID, &route.FXVersionID, &route.RetailVersionID, &status, &canary)
	if err != nil || status == "canary" && account != canary {
		return Route{}, false
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Route{}, false
	}
	defer tx.Rollback(ctx)
	bundle, err := mxpricing.LoadBundle(ctx, tx, route.PurchaseVersionID, route.FXVersionID, route.RetailVersionID)
	if err != nil || bundle.Purchase.Status != "approved" || bundle.FX.Status != "approved" || bundle.Retail.Status != "approved" {
		return Route{}, false
	}
	client, err := litellm.NewClient(os.Getenv("MATERIALSX_LITELLM_URL"), os.Getenv("MATERIALSX_LITELLM_GATEWAY_KEY"))
	if err != nil {
		return Route{}, false
	}
	route.ProviderID = "litellm-onboarded"
	route.Dynamic = true
	route.Enabled = true
	route.CanaryAccount = canary
	if route.Protocol == "chat-completions" {
		route.Provider = chatAdapter{client: client}
	} else if route.Protocol == "responses" {
		route.Provider = client
		route.NoCacheWriteUsage = true
	} else {
		return Route{}, false
	}
	return route, true
}
