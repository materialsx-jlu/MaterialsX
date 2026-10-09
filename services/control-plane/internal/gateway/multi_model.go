package gateway

import (
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/mxrelease"
	"github.com/jamip/materialsx/control-plane/internal/providers/litellm"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"os"
	"strings"
	"time"
)

// Route is an immutable process-local deployment snapshot. It is never built
// from a caller-supplied URL or a model name outside this catalog.
type Route struct {
	ModelID       string
	SupplierModel string
	UpstreamAlias string
	Version       string
	Protocol      string
	ProviderID    string
	Provider      Provider
	Enabled       bool
	// Responses GPT routes do not report a separate cache-write usage class.
	// Their non-cached input is ordinary input; Claude routes must report it.
	NoCacheWriteUsage bool
	PurchaseVersionID string
	FXVersionID       string
	RetailVersionID   string
	CanaryAccount     string
	Dynamic           bool
}

var mx03Routes = []Route{
	{ModelID: "gpt-5.6-sol", SupplierModel: "gpt-5.6-sol", UpstreamAlias: "mx-gpt-5-6-sol", Version: mxrelease.StaticRouteVersions["gpt-5.6-sol"], Protocol: "responses", ProviderID: "rootflowai-via-litellm", NoCacheWriteUsage: true},
	{ModelID: "claude-opus-5-5", SupplierModel: "claude-opus-5-5", UpstreamAlias: "mx-claude-opus-5-5", Version: mxrelease.StaticRouteVersions["claude-opus-5-5"], Protocol: "chat-completions", ProviderID: "rootflowai-via-litellm"},
	{ModelID: "claude-fable-5-1", SupplierModel: "claude-fable-5-1", UpstreamAlias: "mx-claude-fable-5-1", Version: mxrelease.StaticRouteVersions["claude-fable-5-1"], Protocol: "chat-completions", ProviderID: "rootflowai-via-litellm"},
}

func (c Config) route(model string) (Route, bool) {
	if model == ModelAlias {
		return Route{ModelID: ModelAlias, SupplierModel: rootflow.Model, UpstreamAlias: rootflow.Model,
			Version: RouteVersion, Protocol: "responses", ProviderID: "rootflowai", Provider: c.Provider, Enabled: c.Enabled && c.MXReleaseID == ""}, true
	}
	r, ok := c.Routes[model]
	return r, ok
}

func configureMX03(c *Config, cloudMode string) error {
	mode := os.Getenv("MATERIALSX_MX03_GATEWAY_MODE")
	if mode == "" {
		return nil
	}
	production := mode == "wallet-production" && cloudMode == "mx-production"
	var approval mxrelease.Approval
	if !production && ((mode != "diagnostic" && mode != "wallet") || cloudMode != "alpha") || c.SalesPriceVersion != "" || c.PurchasePriceVersion != "" || c.PaidAccount != "" {
		return errors.New("mx03_requires_unbilled_alpha_diagnostic_mode")
	}
	if mode == "wallet" || production {
		c.MX03PriceVersion = os.Getenv("MATERIALSX_MX03_PRICE_VERSION")
		if c.MX03PriceVersion == "" || !identifier.MatchString(c.MX03PriceVersion) {
			return errors.New("mx03_wallet_requires_pinned_price")
		}
		c.MX03Wallet = true
	}
	if production {
		path := os.Getenv("MATERIALSX_MX_PRODUCTION_APPROVAL_FILE")
		a, err := mxrelease.Read(path, time.Now().UTC())
		if c.MX03PriceVersion != mxrelease.PriceVersion || os.Getenv("MATERIALSX_PAYMENT_MODE") != "wechat-native" ||
			os.Getenv("MATERIALSX_MX03_PAYMENT_MODE") != "wechat-production" || os.Getenv("MATERIALSX_IDENTITY_PUBLIC_URL") == "" || path == "" {
			return errors.New("mx_production_release_not_approved")
		}
		c.MXReleaseID, c.MXReleasePath, c.MXAPIOrigin = c.MX03PriceVersion, path, os.Getenv("MATERIALSX_IDENTITY_PUBLIC_URL")
		if err == nil && a.APIOrigin == c.MXAPIOrigin {
			approval = a
		}
		c.Enabled = true
		if os.Getenv("MATERIALSX_MX03_DIAGNOSTIC_MODELS") != "" {
			return errors.New("mx_production_models_must_use_release_approval")
		}
	}
	client, err := litellm.NewClient(os.Getenv("MATERIALSX_LITELLM_URL"), os.Getenv("MATERIALSX_LITELLM_GATEWAY_KEY"))
	if err != nil {
		return errors.New("mx03_litellm_configuration_rejected")
	}
	allowed := map[string]bool{}
	if raw := os.Getenv("MATERIALSX_MX03_DIAGNOSTIC_MODELS"); raw != "" {
		for _, model := range strings.Split(raw, ",") {
			if allowed[model] {
				return errors.New("mx03_unverified_or_duplicate_route")
			}
			known := false
			for _, route := range mx03Routes {
				known = known || route.ModelID == model
			}
			if !known {
				return errors.New("mx03_unknown_route")
			}
			allowed[model] = true
		}
	}
	c.MX03Diagnostic = true
	c.Routes = make(map[string]Route, len(mx03Routes))
	for _, template := range mx03Routes {
		route := template
		if route.Protocol == "chat-completions" {
			route.Provider = chatAdapter{client: client}
		} else {
			route.Provider = client
		}
		route.Enabled = allowed[route.ModelID]
		if production {
			route.Enabled = approval.Allows(route.ModelID, route.Version)
		}
		c.Routes[route.ModelID] = route
	}
	return nil
}
