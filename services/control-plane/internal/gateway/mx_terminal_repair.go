package gateway

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
)

// RepairMXTerminal settles a completed request from persisted terminal usage.
// It never calls the supplier again. Missing cache-write usage is normalized
// only for the pinned legacy GPT route, not for registry models.
func (s *Store) RepairMXTerminal(ctx context.Context, requestID string) (mxpricing.Quote, error) {
	if s.MXPoints == nil || !identifier.MatchString(requestID) {
		return mxpricing.Quote{}, ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return mxpricing.Quote{}, err
	}
	defer tx.Rollback(ctx)
	var owner string
	if err = tx.QueryRow(ctx, `SELECT account_id FROM gateway_requests WHERE id=$1`, requestID).Scan(&owner); err != nil {
		return mxpricing.Quote{}, err
	}
	var active bool
	if err = tx.QueryRow(ctx, `SELECT status='active' FROM accounts WHERE id=$1 FOR UPDATE`, owner).Scan(&active); err != nil {
		return mxpricing.Quote{}, err
	}
	if !active {
		return mxpricing.Quote{}, ErrForbidden
	}
	var model, route, execution, settlement string
	var terminal, dispatched, mxWallet bool
	var upstreamStatus *int
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT t.model_id,r.route_version,r.execution,r.settlement,r.terminal_received,r.dispatched,t.mx_points_billing,r.upstream_status,r.usage
 FROM gateway_requests r JOIN research_tasks t ON t.id=r.task_id WHERE r.id=$1 FOR UPDATE OF r`, requestID).
		Scan(&model, &route, &execution, &settlement, &terminal, &dispatched, &mxWallet, &upstreamStatus, &raw)
	if err != nil {
		return mxpricing.Quote{}, err
	}
	legacy := model == "gpt-5.6-sol" && route == mx03Routes[0].Version
	dynamic := false
	if strings.HasPrefix(route, "mx-model-") {
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mx_cloud_models WHERE id=$1 AND route_version=$2)`, model, route).Scan(&dynamic); err != nil {
			return mxpricing.Quote{}, err
		}
	}
	if (!legacy && !dynamic) || execution != "completed" || settlement != "reconciliation_pending" || !terminal || !dispatched || !mxWallet || upstreamStatus == nil || *upstreamStatus != 200 {
		return mxpricing.Quote{}, ErrConflict
	}
	var provider rootflow.Usage
	if json.Unmarshal(raw, &provider) != nil || provider.Source != "responses" || provider.Input == nil || provider.Output == nil || provider.Cached == nil || *provider.Cached > *provider.Input || (legacy && provider.CacheCreate != nil) || (dynamic && provider.CacheCreate == nil) {
		return mxpricing.Quote{}, ErrConflict
	}
	if legacy {
		provider = *routeUsage(mx03Routes[0], &provider)
	}
	ordinary := *provider.Input - *provider.Cached - *provider.CacheCreate
	if ordinary < 0 {
		return mxpricing.Quote{}, ErrConflict
	}
	usage := mxpricing.Usage{Input: &ordinary, Output: provider.Output, CacheRead: provider.Cached, CacheCreate: provider.CacheCreate}
	quote, pending, err := s.MXPoints.SettlePricedTx(ctx, tx, owner, requestID, usage, "provider_terminal_usage_repair_v1")
	if err != nil {
		return mxpricing.Quote{}, err
	}
	if pending {
		return mxpricing.Quote{}, ErrConflict
	}
	encoded, _ := json.Marshal(provider)
	if _, err = tx.Exec(ctx, `UPDATE gateway_requests SET settlement='settled',usage=$2 WHERE id=$1`, requestID, encoded); err != nil {
		return mxpricing.Quote{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return mxpricing.Quote{}, err
	}
	return quote, nil
}

func (s *Store) RepairMXGPTTerminal(ctx context.Context, requestID string) (mxpricing.Quote, error) {
	return s.RepairMXTerminal(ctx, requestID)
}
