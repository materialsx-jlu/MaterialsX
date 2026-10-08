package mxpricing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
)

// OnboardingPrice is an independently reviewed source of procurement and
// retail rates. A zero rate is never inferred for an unknown usage class.
type OnboardingPrice struct {
	Currency   string `json:"currency"`
	CNYPerUnit string `json:"cnyPerUnit"`
	SourceRef  string `json:"sourceRef"`
	Tiers      []Tier `json:"tiers"`
}

var onboardingID = regexp.MustCompile(`^[a-z][a-z0-9-]{2,63}$`)

func validDynamicBundle(bundle Bundle) bool {
	if len(bundle.Purchase.Models) != 1 || len(bundle.Retail.Models) != 1 || len(bundle.Purchase.Models[0].Tiers) == 0 || len(bundle.Purchase.Models[0].Tiers) != len(bundle.Retail.Models[0].Tiers) || bundle.Purchase.Models[0].ID != bundle.Retail.Models[0].ID || bundle.FX.Rate == "" {
		return false
	}
	if value, err := parseDecimal(bundle.FX.Rate, 8); err != nil || value <= 0 {
		return false
	}
	for i, p := range bundle.Purchase.Models[0].Tiers {
		r := bundle.Retail.Models[0].Tiers[i]
		if p.ID != r.ID || p.MinInput != r.MinInput || (i == 0 && p.MinInput != 0) || (i > 0 && p.MinInput <= bundle.Purchase.Models[0].Tiers[i-1].MinInput) {
			return false
		}
		for c := range p.Purchase {
			if a, e := parseDecimal(p.Purchase[c], 4); e != nil || a <= 0 {
				return false
			}
			if b, e := parseDecimal(r.Retail[c], 4); e != nil || b <= 0 {
				return false
			}
		}
	}
	return true
}

func NewOnboardingBundle(modelID string, revision int64, price OnboardingPrice) (Bundle, error) {
	if !onboardingID.MatchString(modelID) || revision < 1 || len(price.Tiers) == 0 || len(price.Tiers) > 8 || len(price.SourceRef) < 8 || len(price.SourceRef) > 512 || len(price.Currency) < 3 || len(price.Currency) > 24 {
		return Bundle{}, ErrSnapshot
	}
	if v, e := parseDecimal(price.CNYPerUnit, 8); e != nil || v <= 0 {
		return Bundle{}, ErrSnapshot
	}
	raw, _ := json.Marshal(price)
	digest := sha256.Sum256(raw)
	hash := "mx-model:" + hex.EncodeToString(digest[:])
	id := fmt.Sprintf("mx-model-%s-v%d-%s", modelID, revision, hex.EncodeToString(digest[:6]))
	base := Version{SnapshotHash: hash, Status: "approved", SourceRef: price.SourceRef}
	out := Bundle{Purchase: base, FX: base, Retail: base}
	out.Purchase.ID = id + "-purchase"
	out.Purchase.Unit = "SUPPLIER_UNIT_PER_1M"
	out.FX.ID = id + "-fx"
	out.FX.Unit = "SOURCE_TO_CNY"
	out.FX.SourceCurrency = price.Currency
	out.FX.TargetCurrency = "CNY"
	out.FX.Rate = price.CNYPerUnit
	out.Retail.ID = id + "-retail"
	out.Retail.Unit = "MX_POINTS_PER_1M"
	purchase := Model{ID: modelID}
	retail := Model{ID: modelID}
	for _, tier := range price.Tiers {
		if !onboardingID.MatchString(tier.ID) || strings.Contains(tier.ID, "--") {
			return Bundle{}, ErrSnapshot
		}
		purchase.Tiers = append(purchase.Tiers, Tier{ID: tier.ID, MinInput: tier.MinInput, Purchase: tier.Purchase})
		retail.Tiers = append(retail.Tiers, Tier{ID: tier.ID, MinInput: tier.MinInput, Retail: tier.Retail})
	}
	out.Purchase.Models = []Model{purchase}
	out.Retail.Models = []Model{retail}
	if !validDynamicBundle(out) {
		return Bundle{}, ErrSnapshot
	}
	return out, nil
}

// InsertOnboardingBundle adds immutable approved price rows inside the same
// transaction that promotes the model registry. Historical requests pin IDs.
func InsertOnboardingBundle(ctx context.Context, tx pgx.Tx, b Bundle) error {
	if !validDynamicBundle(b) {
		return ErrSnapshot
	}
	for _, entry := range []struct {
		table string
		v     Version
	}{
		{"mx_purchase_price_versions", b.Purchase}, {"mx_fx_versions", b.FX}, {"mx_retail_price_versions", b.Retail},
	} {
		body, _ := json.Marshal(entry.v)
		fp, e := canonicalFingerprint(body)
		if e != nil {
			return e
		}
		tag, e := tx.Exec(ctx, `INSERT INTO `+entry.table+`(id,status,body,fingerprint,source_ref) VALUES($1,'approved',$2,$3,$4) ON CONFLICT(id) DO NOTHING`, entry.v.ID, body, fp, entry.v.SourceRef)
		if e != nil {
			return e
		}
		if tag.RowsAffected() != 1 {
			return ErrConflict
		}
	}
	return nil
}
