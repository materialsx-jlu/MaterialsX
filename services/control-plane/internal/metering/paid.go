package metering

import (
	"strconv"
	"strings"
)

const PaidPrecision int64 = 10000
const PaidPriceID = "paid-sol-20261001-v1"

// Decimal credits cross the public API as strings, never floats.
func DecimalAmount(s string) (int64, error) {
	parts := strings.Split(s, ".")
	if len(parts) > 2 {
		return 0, ErrValidation
	}
	whole, e := Amount(parts[0])
	if e != nil || whole > 922337203685477 {
		return 0, ErrValidation
	}
	fraction := int64(0)
	if len(parts) == 2 {
		if len(parts[1]) < 1 || len(parts[1]) > 4 {
			return 0, ErrValidation
		}
		for _, r := range parts[1] {
			if r < '0' || r > '9' {
				return 0, ErrValidation
			}
		}
		fraction, _ = strconv.ParseInt(parts[1]+strings.Repeat("0", 4-len(parts[1])), 10, 64)
	}
	if whole*PaidPrecision > 9223372036854775807-fraction {
		return 0, ErrValidation
	}
	return whole*PaidPrecision + fraction, nil
}
func Display(n int64, precision int64) string {
	if precision != PaidPrecision {
		return strconv.FormatInt(n, 10)
	}
	// The quotient/remainder form also handles MinInt64 without negation overflow.
	whole, frac := n/PaidPrecision, n%PaidPrecision
	if frac == 0 {
		return strconv.FormatInt(whole, 10)
	}
	sign := ""
	if n < 0 {
		sign = "-"
		whole = -whole
		frac = -frac
	}
	return sign + strconv.FormatInt(whole, 10) + "." + strings.TrimRight(strconv.FormatInt(frac+PaidPrecision, 10)[1:], "0")
}
func displayText(s string, precision int64) (string, error) {
	n, e := strconv.ParseInt(s, 10, 64)
	if e != nil {
		return "", ErrValidation
	}
	return Display(n, precision), nil
}
func (p Price) Precision() int64 {
	if p.Unit == "paid-credit" {
		return PaidPrecision
	}
	return 1
}

// Retail rates are in integer subunits per million tokens. These are not procurement prices.
func PaidPrice() Price {
	return Price{ID: PaidPriceID, Model: "materials-research", Route: "rootflow-sol-responses-2026-10-01-v1", Unit: "paid-credit", Tiers: []Tier{{Input: "10000000", Cached: "1000000", Output: "100000000"}}, MaxInput: 131072, InputPolicy: "paid-pilot-ceiling-v1", Evidence: "user-approved-retail-20261001"}
}

const CountedPaidPriceID = "paid-sol-counted-20261001-v1"
const CountedInputPolicy = "verified-route-counter-v1"

// Same approved retail rates; a separate immutable snapshot binds trusted counting.
func CountedPaidPrice(evidence string) Price {
	p := PaidPrice()
	p.ID = CountedPaidPriceID
	p.InputPolicy = CountedInputPolicy
	p.Evidence = evidence
	return p
}
