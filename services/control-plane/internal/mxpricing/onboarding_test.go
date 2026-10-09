package mxpricing

import (
	"errors"
	"strings"
	"testing"
)

func TestOnboardingPriceAllowsOptionalSource(t *testing.T) {
	price := OnboardingPrice{Currency: "CNY", CNYPerUnit: "1", Tiers: []Tier{{ID: "standard", MinInput: 0, Purchase: [4]string{"1.25", "7.5", "0.125", "1.5625"}, Retail: [4]string{"175", "1050", "17.5", "218.75"}}}}
	bundle, err := NewOnboardingBundle("gpt-56-sol-onboarding-test", 14, price)
	if err != nil || bundle.Purchase.SourceRef != "" {
		t.Fatalf("empty source must be accepted as entered: %v", err)
	}
	price.SourceRef = "memo"
	if _, err = NewOnboardingBundle("gpt-56-sol-onboarding-test", 14, price); err != nil {
		t.Fatalf("short optional note must be accepted: %v", err)
	}
	price.SourceRef = strings.Repeat("x", 513)
	_, err = NewOnboardingBundle("gpt-56-sol-onboarding-test", 14, price)
	var issue *OnboardingValidationError
	if !errors.As(err, &issue) || issue.Field != "sourceRef" || issue.Reason != "SOURCE_TOO_LONG" {
		t.Fatalf("oversized source should identify field, got %v", err)
	}
}
