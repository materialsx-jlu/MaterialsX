package mxpoints

import (
	"context"

	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
)

type RetailTier struct {
	ID             string    `json:"id"`
	MinInputTokens int64     `json:"minInputTokens"`
	MXPointsPer1M  [4]string `json:"mxPointsPer1m"`
}
type RetailModel struct {
	ID                            string       `json:"id"`
	RetailVsOfficialPercentApprox string       `json:"retailVsOfficialPercentApprox"`
	Tiers                         []RetailTier `json:"tiers"`
}
type RetailCatalog struct {
	VersionID      string        `json:"versionId"`
	Status         string        `json:"status"`
	SalesEnabled   bool          `json:"salesEnabled"`
	MXPointsPerCNY string        `json:"mxPointsPerCny"`
	FieldOrder     [4]string     `json:"fieldOrder"`
	Models         []RetailModel `json:"models"`
}

// RetailCatalog exposes only the user price layer, with draft prices visibly
// disabled. Procurement and exchange-rate details stay on the private side.
func (s *Store) RetailCatalog(ctx context.Context) (RetailCatalog, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return RetailCatalog{}, err
	}
	defer tx.Rollback(ctx)
	id := mxpricing.SnapshotVersion
	if s.Mode == "wechat-live" {
		id = mxpricing.ApprovedVersion
	}
	bundle, err := mxpricing.LoadBundle(ctx, tx, id+"-purchase", id+"-fx", id+"-retail")
	if err != nil {
		return RetailCatalog{}, ErrDisabled
	}
	out := RetailCatalog{VersionID: bundle.Retail.ID, Status: bundle.Retail.Status, SalesEnabled: bundle.Retail.Status == "approved" && s.Mode == "wechat-live", MXPointsPerCNY: "10", FieldOrder: [4]string{"input", "output", "cacheRead", "cacheCreate"}}
	for _, m := range bundle.Retail.Models {
		item := RetailModel{ID: m.ID, RetailVsOfficialPercentApprox: m.RetailVsOfficialPercentApprox}
		for _, tier := range m.Tiers {
			item.Tiers = append(item.Tiers, RetailTier{ID: tier.ID, MinInputTokens: tier.MinInput, MXPointsPer1M: tier.Retail})
		}
		out.Models = append(out.Models, item)
	}
	return out, nil
}
