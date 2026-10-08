package gateway

import (
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/providers/litellm"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"os"
	"strings"
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
	{ModelID: "gpt-5.6-sol", SupplierModel: "gpt-5.6-sol", UpstreamAlias: "mx-gpt-5-6-sol", Version: "mx03-gpt56-litellm-responses-20261007-v1", Protocol: "responses", ProviderID: "rootflowai-via-litellm", NoCacheWriteUsage: true},
	{ModelID: "claude-opus-5-5", SupplierModel: "claude-opus-5-5", UpstreamAlias: "mx-claude-opus-5-5", Version: "mx03-opus55-litellm-chat-adapter-20261007-v1", Protocol: "chat-completions", ProviderID: "rootflowai-via-litellm"},
	{ModelID: "claude-fable-5-1", SupplierModel: "claude-fable-5-1", UpstreamAlias: "mx-claude-fable-5-1", Version: "mx03-fable51-litellm-chat-adapter-20261007-v1", Protocol: "chat-completions", ProviderID: "rootflowai-via-litellm"},
}

func (c Config) route(model string) (Route, bool) {
	if model == ModelAlias {
		return Route{ModelID: ModelAlias, SupplierModel: rootflow.Model, UpstreamAlias: rootflow.Model,
			Version: RouteVersion, Protocol: "responses", ProviderID: "rootflowai", Provider: c.Provider, Enabled: c.Enabled}, true
	}
	r, ok := c.Routes[model]
	return r, ok
}

func configureMX03(c *Config, cloudMode string) error {
	mode := os.Getenv("MATERIALSX_MX03_GATEWAY_MODE")
	if mode == "" {
		return nil
	}
	if (mode != "diagnostic" && mode != "wallet") || cloudMode != "alpha" || c.SalesPriceVersion != "" || c.PurchasePriceVersion != "" || c.PaidAccount != "" {
		return errors.New("mx03_requires_unbilled_alpha_diagnostic_mode")
	}
	if mode == "wallet" {
		c.MX03PriceVersion = os.Getenv("MATERIALSX_MX03_PRICE_VERSION")
		if c.MX03PriceVersion == "" || !identifier.MatchString(c.MX03PriceVersion) {
			return errors.New("mx03_wallet_requires_pinned_price")
		}
		c.MX03Wallet = true
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
		c.Routes[route.ModelID] = route
	}
	return nil
}
