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
	PaidAccount                                                     string
	Counter                                                         InputCounter
	ApprovalsPath                                                   string
	MaxRequests, MaxOutputTokens, MaxDurationSeconds, MaxConcurrent int
	SalesPriceVersion, PurchasePriceVersion                         string
	Provider                                                        Provider
}
type Provider interface {
	Open(context.Context, map[string]any) (*http.Response, error)
}

func ConfigFromEnv() (Config, error) {
	c := Config{MaxRequests: 6, MaxOutputTokens: 1024, MaxDurationSeconds: 180, MaxConcurrent: 8}
	mode := os.Getenv("MATERIALSX_CLOUD_MODE")
	if mode == "" || mode == "disabled" {
		return c, nil
	}
	if mode != "alpha" && mode != "paid-pilot" && mode != "paid-beta" {
		return c, errors.New("invalid_cloud_mode")
	}
	for _, entry := range []struct {
		name  string
		value *int
		max   int
	}{
		{"MATERIALSX_CLOUD_MAX_REQUESTS", &c.MaxRequests, 16}, {"MATERIALSX_CLOUD_MAX_OUTPUT_TOKENS", &c.MaxOutputTokens, 4096},
		{"MATERIALSX_CLOUD_MAX_DURATION_SECONDS", &c.MaxDurationSeconds, 600}, {"MATERIALSX_CLOUD_MAX_CONCURRENT", &c.MaxConcurrent, 64},
	} {
		if raw := os.Getenv(entry.name); raw != "" {
			n, e := strconv.Atoi(raw)
			if e != nil || n < 1 || n > entry.max {
				return c, errors.New("invalid_cloud_limit")
			}
			*entry.value = n
		}
	}
	if os.Getenv("ROOTFLOWAI_MODEL") != "" && os.Getenv("ROOTFLOWAI_MODEL") != rootflow.Model {
		return c, errors.New("cloud_model_must_match_verified_route")
	}
	if os.Getenv("MATERIALSX_CLOUD_ROUTE_VERIFIED") != "1" {
		return c, errors.New("cloud_route_requires_verification")
	}
	provider, e := rootflow.NewClient(os.Getenv("ROOTFLOWAI_BASE_URL"), os.Getenv("ROOTFLOWAI_API_KEY"))
	if e != nil {
		return c, errors.New("cloud_provider_configuration_rejected")
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
	return c, nil
}
func deadlineContext(parent context.Context, deadline time.Time) (context.Context, context.CancelFunc) {
	return context.WithDeadline(parent, deadline)
}
