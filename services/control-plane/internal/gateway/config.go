package gateway

import (
	"context"
	"errors"
	"github.com/jamip/materialsx/control-plane/internal/lifecycle"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
	"net/http"
	"os"
	"strconv"
	"time"
)

const ModelAlias = "materials-research"
const RouteVersion = "rootflow-sol-responses-2026-10-01-v1"
const ConsentVersion = "cloud-alpha-v1"

type Config struct {
	Enabled                                                         bool
	DisableRequestRateLimit                                         bool
	PaidAccount                                                     string
	Counter                                                         InputCounter
	ApprovalsPath                                                   string
	MaxRequests, MaxOutputTokens, MaxDurationSeconds, MaxConcurrent int
	SalesPriceVersion, PurchasePriceVersion                         string
	Provider                                                        Provider
	MX03Diagnostic                                                  bool
	MX03Wallet                                                      bool
	MX03PriceVersion                                                string
	Routes                                                          map[string]Route
}
type Provider interface {
	Open(context.Context, map[string]any) (*http.Response, error)
}

func ConfigFromEnv() (Config, error) {
	c := Config{MaxRequests: 0, MaxOutputTokens: 8192, MaxDurationSeconds: 3600, MaxConcurrent: 8}
	mode := os.Getenv("MATERIALSX_CLOUD_MODE")
	if mode == "" || mode == "disabled" {
		if os.Getenv("MATERIALSX_MX03_GATEWAY_MODE") != "" {
			return c, errors.New("mx03_requires_alpha_cloud_mode")
		}
		return c, nil
	}
	if mode != "alpha" && mode != "paid-pilot" && mode != "paid-beta" {
		return c, errors.New("invalid_cloud_mode")
	}
	for _, entry := range []struct {
		name  string
		value *int
		min   int
		max   int
	}{
		{"MATERIALSX_CLOUD_MAX_REQUESTS", &c.MaxRequests, 0, 2147483647}, {"MATERIALSX_CLOUD_MAX_OUTPUT_TOKENS", &c.MaxOutputTokens, 1, 131072},
		{"MATERIALSX_CLOUD_MAX_DURATION_SECONDS", &c.MaxDurationSeconds, 1, 86400}, {"MATERIALSX_CLOUD_MAX_CONCURRENT", &c.MaxConcurrent, 0, 64},
	} {
		if raw := os.Getenv(entry.name); raw != "" {
			n, e := strconv.Atoi(raw)
			if e != nil || n < entry.min || n > entry.max {
				return c, errors.New("invalid_cloud_limit")
			}
			*entry.value = n
		}
	}
	if v := os.Getenv("MATERIALSX_CLOUD_DISABLE_RATE_LIMIT"); v != "" && v != "0" && v != "1" {
		return c, errors.New("invalid_cloud_rate_setting")
	}
	c.DisableRequestRateLimit = os.Getenv("MATERIALSX_CLOUD_DISABLE_RATE_LIMIT") == "1"
	mxWallet := os.Getenv("MATERIALSX_MX03_GATEWAY_MODE") == "wallet"
	var provider Provider
	if !mxWallet {
		if os.Getenv("ROOTFLOWAI_MODEL") != "" && os.Getenv("ROOTFLOWAI_MODEL") != rootflow.Model {
			return c, errors.New("cloud_model_must_match_verified_route")
		}
		if os.Getenv("MATERIALSX_CLOUD_ROUTE_VERIFIED") != "1" {
			return c, errors.New("cloud_route_requires_verification")
		}
		var e error
		provider, e = rootflow.NewClient(os.Getenv("ROOTFLOWAI_BASE_URL"), os.Getenv("ROOTFLOWAI_API_KEY"))
		if e != nil {
			return c, errors.New("cloud_provider_configuration_rejected")
		}
	}
	c.SalesPriceVersion = os.Getenv("MATERIALSX_METERING_PRICE_VERSION")
	c.PurchasePriceVersion = os.Getenv("MATERIALSX_PROCUREMENT_PRICE_VERSION")
	if (c.SalesPriceVersion != "" && !identifier.MatchString(c.SalesPriceVersion)) || (c.PurchasePriceVersion != "" && !identifier.MatchString(c.PurchasePriceVersion)) {
		return c, errors.New("invalid_price_version")
	}
	if mode == "paid-pilot" {
		c.PaidAccount = os.Getenv("MATERIALSX_PAID_PILOT_ACCOUNT")
		if !identifier.MatchString(c.PaidAccount) || c.SalesPriceVersion != "paid-sol-20261001-v1" {
			return c, errors.New("paid_pilot_requires_account_and_approved_price")
		}
	}
	if mode == "paid-beta" {
		a, e := lifecycle.ReadApprovals(os.Getenv("MATERIALSX_BETA_APPROVALS_FILE"), RouteVersion)
		if e != nil || len(a.Missing(time.Now().UTC())) > 0 || c.SalesPriceVersion != metering.CountedPaidPriceID {
			return c, errors.New("beta_approvals_required")
		}
		program, hash := os.Getenv("MATERIALSX_INPUT_COUNTER_EXECUTABLE"), os.Getenv("MATERIALSX_INPUT_COUNTER_SHA256")
		if program == "" || len(hash) != 64 {
			return c, errors.New("verified_input_counter_required")
		}
		c.ApprovalsPath = os.Getenv("MATERIALSX_BETA_APPROVALS_FILE")
		c.PaidAccount = "*"
		c.Counter = CommandCounter{Program: program, SHA256: hash}
	}
	c.Provider = provider
	c.Enabled = true
	if e := configureMX03(&c, mode); e != nil {
		return c, e
	}
	return c, nil
}
func deadlineContext(parent context.Context, deadline time.Time) (context.Context, context.CancelFunc) {
	return context.WithDeadline(parent, deadline)
}
