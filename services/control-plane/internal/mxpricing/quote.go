package mxpricing

import (
	"math"
	"math/big"
)

func tiers(bundle Bundle, modelID string, totalInput int64) (Tier, Tier, error) {
	if bundle.Purchase.SnapshotHash == "" || bundle.Purchase.SnapshotHash != bundle.FX.SnapshotHash || bundle.FX.SnapshotHash != bundle.Retail.SnapshotHash || bundle.Purchase.ID == "" || bundle.FX.ID == "" || bundle.Retail.ID == "" {
		return Tier{}, Tier{}, ErrSnapshot
	}
	var purchase, retail *Model
	for i := range bundle.Purchase.Models {
		if bundle.Purchase.Models[i].ID == modelID {
			purchase = &bundle.Purchase.Models[i]
		}
	}
	for i := range bundle.Retail.Models {
		if bundle.Retail.Models[i].ID == modelID {
			retail = &bundle.Retail.Models[i]
		}
	}
	if purchase == nil || retail == nil || len(purchase.Tiers) != len(retail.Tiers) {
		return Tier{}, Tier{}, ErrQuote
	}
	index := -1
	for i := range retail.Tiers {
		if retail.Tiers[i].ID != purchase.Tiers[i].ID || retail.Tiers[i].MinInput != purchase.Tiers[i].MinInput || (i == 0 && retail.Tiers[i].MinInput != 0) || (i > 0 && retail.Tiers[i].MinInput <= retail.Tiers[i-1].MinInput) {
			return Tier{}, Tier{}, ErrSnapshot
		}
		if totalInput >= retail.Tiers[i].MinInput {
			index = i
		}
	}
	if index < 0 {
		return Tier{}, Tier{}, ErrQuote
	}
	return purchase.Tiers[index], retail.Tiers[index], nil
}

func ceilQuotient(n *big.Int, divisor int64) (int64, error) {
	if n.Sign() < 0 {
		return 0, ErrQuote
	}
	d := big.NewInt(divisor)
	q, r := new(big.Int).QuoRem(n, d, new(big.Int))
	if r.Sign() > 0 {
		q.Add(q, big.NewInt(1))
	}
	if !q.IsInt64() {
		return 0, ErrQuote
	}
	return q.Int64(), nil
}

func sumRate(tokens [4]int64, rates [4]string) (*big.Int, error) {
	total := new(big.Int)
	for i := range tokens {
		if tokens[i] < 0 {
			return nil, ErrQuote
		}
		rate, err := parseDecimal(rates[i], 4)
		if err != nil {
			return nil, ErrSnapshot
		}
		term := new(big.Int).Mul(big.NewInt(tokens[i]), big.NewInt(rate))
		total.Add(total, term)
	}
	return total, nil
}

// Price never treats a missing usage class as zero. Upstream adapters must
// prove the four classes are mutually exclusive before calling this function.
func Price(bundle Bundle, modelID string, usage Usage) (Quote, error) {
	fields := []*int64{usage.Input, usage.Output, usage.CacheRead, usage.CacheCreate}
	var tokens [4]int64
	for i, value := range fields {
		if value == nil {
			return Quote{}, ErrPending
		}
		if *value < 0 {
			return Quote{}, ErrQuote
		}
		tokens[i] = *value
	}
	if tokens[0] > math.MaxInt64-tokens[2] || tokens[0]+tokens[2] > math.MaxInt64-tokens[3] {
		return Quote{}, ErrQuote
	}
	totalInput := tokens[0] + tokens[2] + tokens[3]
	purchase, retail, err := tiers(bundle, modelID, totalInput)
	if err != nil {
		return Quote{}, err
	}
	r, err := sumRate(tokens, retail.Retail)
	if err != nil {
		return Quote{}, err
	}
	retailSubunits, err := ceilQuotient(r, rateScale)
	if err != nil {
		return Quote{}, err
	}
	p, err := sumRate(tokens, purchase.Purchase)
	if err != nil {
		return Quote{}, err
	}
	fx, err := parseDecimal(bundle.FX.Rate, 8)
	if err != nil || fx <= 0 {
		return Quote{}, ErrSnapshot
	}
	p.Mul(p, big.NewInt(fx))
	cost, err := ceilQuotient(p, rateScale*1_000_000)
	if err != nil {
		return Quote{}, err
	}
	return Quote{Model: modelID, Tier: retail.ID, RetailVersion: bundle.Retail.ID, PurchaseVersion: bundle.Purchase.ID, FXVersion: bundle.FX.ID, RetailSubunits: retailSubunits, PurchaseEstimateMicrofen: cost}, nil
}

// ReserveBound assumes no cache discount. It uses the highest reachable tier
// and the highest input-class price, so a later full usage record cannot
// legitimately exceed the hold within the declared input/output bounds.
func ReserveBound(bundle Bundle, modelID string, inputBound, outputBound int64) (int64, error) {
	if inputBound <= 0 || outputBound <= 0 {
		return 0, ErrQuote
	}
	_, retail, err := tiers(bundle, modelID, inputBound)
	if err != nil {
		return 0, err
	}
	// The hold must cover any tier the final input may fall into, including
	// lower-context tiers when the declared bound crosses a threshold.
	for _, model := range bundle.Retail.Models {
		if model.ID != modelID {
			continue
		}
		for _, candidate := range model.Tiers {
			if candidate.MinInput > inputBound {
				continue
			}
			for i := range candidate.Retail {
				a, ea := parseDecimal(candidate.Retail[i], 4)
				b, eb := parseDecimal(retail.Retail[i], 4)
				if ea != nil || eb != nil {
					return 0, ErrSnapshot
				}
				if a > b {
					retail.Retail[i] = candidate.Retail[i]
				}
			}
		}
	}
	maxInput := int64(0)
	for _, class := range []int{0, 2, 3} {
		value, err := parseDecimal(retail.Retail[class], 4)
		if err != nil {
			return 0, ErrSnapshot
		}
		if value > maxInput {
			maxInput = value
		}
	}
	output, err := parseDecimal(retail.Retail[1], 4)
	if err != nil {
		return 0, ErrSnapshot
	}
	n := new(big.Int).Mul(big.NewInt(inputBound), big.NewInt(maxInput))
	n.Add(n, new(big.Int).Mul(big.NewInt(outputBound), big.NewInt(output)))
	return ceilQuotient(n, rateScale)
}
