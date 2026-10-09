package mxpoints

import (
	"context"
	"os"

	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/mxrelease"
	"time"
)

type RetailTier struct {
	ID             string    `json:"id"`
	MinInputTokens int64     `json:"minInputTokens"`
	MXPointsPer1M  [4]string `json:"mxPointsPer1m"`
}
type RetailModel struct {
	ID                            string       `json:"id"`
	PriceVersionID                string       `json:"priceVersionId"`
	RetailVsOfficialPercentApprox *string      `json:"retailVsOfficialPercentApprox"`
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
	if s.Mode == "wechat-live" || s.Mode == "wechat-production" {
		id = mxpricing.ApprovedVersion
	}
	bundle, err := mxpricing.LoadBundle(ctx, tx, id+"-purchase", id+"-fx", id+"-retail")
	if err != nil {
		return RetailCatalog{}, ErrDisabled
	}
	out := RetailCatalog{VersionID: bundle.Retail.ID, Status: bundle.Retail.Status, SalesEnabled: bundle.Retail.Status == "approved" && (s.Mode == "wechat-live" || s.Mode == "wechat-production" && s.productionReadyTx(ctx, tx) == nil), MXPointsPerCNY: "10", FieldOrder: [4]string{"input", "output", "cacheRead", "cacheCreate"}}
	var approval mxrelease.Approval
	if s.Mode == "wechat-production" {
		approval, err = mxrelease.Read(s.ReleasePath, time.Now().UTC())
		if err != nil || approval.ReleaseID != s.ReleaseID {
			out.SalesEnabled = false
		}
	}
	for _, m := range bundle.Retail.Models {
		if s.Mode == "wechat-production" && !approval.Allows(m.ID, mxrelease.StaticRouteVersions[m.ID]) {
			continue
		}
		comparison := m.RetailVsOfficialPercentApprox
		item := RetailModel{ID: m.ID, PriceVersionID: bundle.Retail.ID, RetailVsOfficialPercentApprox: &comparison}
		for _, tier := range m.Tiers {
			item.Tiers = append(item.Tiers, RetailTier{ID: tier.ID, MinInputTokens: tier.MinInput, MXPointsPer1M: tier.Retail})
		}
		out.Models = append(out.Models, item)
	}
	rows, err := tx.Query(ctx, `SELECT id,purchase_version_id,fx_version_id,retail_version_id FROM mx_cloud_models WHERE status='active' AND ($1::boolean=false OR deployed_version=version) ORDER BY id`, os.Getenv("MATERIALSX_ENV") == "production")
	if err != nil {
		return RetailCatalog{}, err
	}
	type activePrice struct{ modelID, purchaseID, fxID, retailID string }
	active := []activePrice{}
	for rows.Next() {
		var entry activePrice
		if err = rows.Scan(&entry.modelID, &entry.purchaseID, &entry.fxID, &entry.retailID); err != nil {
			break
		}
		active = append(active, entry)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return RetailCatalog{}, err
	}
	for _, entry := range active {
		if s.Mode == "wechat-production" {
			var version string
			if err = tx.QueryRow(ctx, `SELECT route_version FROM mx_cloud_models WHERE id=$1`, entry.modelID).Scan(&version); err != nil {
				return RetailCatalog{}, err
			}
			if !approval.Allows(entry.modelID, version) {
				continue
			}
		}
		modelBundle, loadErr := mxpricing.LoadBundle(ctx, tx, entry.purchaseID, entry.fxID, entry.retailID)
		if loadErr != nil || modelBundle.Retail.Status != "approved" || len(modelBundle.Retail.Models) != 1 || modelBundle.Retail.Models[0].ID != entry.modelID {
			return RetailCatalog{}, ErrDisabled
		}
		model := modelBundle.Retail.Models[0]
		item := RetailModel{ID: model.ID, PriceVersionID: modelBundle.Retail.ID}
		for _, tier := range model.Tiers {
			item.Tiers = append(item.Tiers, RetailTier{ID: tier.ID, MinInputTokens: tier.MinInput, MXPointsPer1M: tier.Retail})
		}
		out.Models = append(out.Models, item)
	}
	return out, nil
}
