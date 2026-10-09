package mxpoints

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/mxrelease"
)

func (s *Store) ProductionReady(ctx context.Context) bool {
	if s.Mode != "wechat-production" || s.Pool == nil {
		return false
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return false
	}
	defer tx.Rollback(ctx)
	return s.productionReadyTx(ctx, tx) == nil
}

// Only new admissions depend on the live approval. Settlement, callbacks,
// refunds and historical reconciliation remain available after revocation.
func (s *Store) productionReadyTx(ctx context.Context, tx pgx.Tx) error {
	if s.Mode != "wechat-production" {
		return nil
	}
	a, err := mxrelease.Read(s.ReleasePath, time.Now().UTC())
	if err != nil || a.ReleaseID != s.ReleaseID || a.MerchantID != s.Merchant || a.APIOrigin != s.APIOrigin {
		return ErrDisabled
	}
	var salesPaused, cloudPaused bool
	if err := tx.QueryRow(ctx, `SELECT sales_paused,cloud_paused FROM operations_controls WHERE id FOR SHARE`).Scan(&salesPaused, &cloudPaused); err != nil || salesPaused || cloudPaused {
		return ErrDisabled
	}
	var workerHealthy bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM worker_heartbeats WHERE name='billing' AND touched_at>clock_timestamp()-interval '60 seconds')`).Scan(&workerHealthy); err != nil || !workerHealthy {
		return ErrDisabled
	}
	bundle, err := mxpricing.LoadBundle(ctx, tx, a.PriceVersion+"-purchase", a.PriceVersion+"-fx", a.PriceVersion+"-retail")
	if err != nil || bundle.Purchase.Status != "approved" || bundle.FX.Status != "approved" || bundle.Retail.Status != "approved" {
		return ErrDisabled
	}
	return nil
}
