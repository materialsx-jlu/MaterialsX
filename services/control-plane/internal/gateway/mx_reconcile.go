package gateway

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
)

// MXSupplierEvidence is transcribed from an independent supplier consumption
// log by a trusted operator. Input is the supplier's total input token count.
type MXSupplierEvidence struct {
	RequestID            string `json:"requestId"`
	SupplierRequestID    string `json:"supplierRequestId"`
	InputTokens          int64  `json:"inputTokens"`
	OutputTokens         int64  `json:"outputTokens"`
	CacheReadTokens      int64  `json:"cacheReadTokens"`
	CacheCreateTokens    int64  `json:"cacheCreateTokens"`
	SupplierCostMicrofen int64  `json:"supplierCostMicrofen"`
}

// ReconcileMXBill settles a previously held MX request only when the supplier
// log agrees with every token count already returned by the provider. The
// supplier bill, wallet debit and gateway receipt commit in one transaction.
func (s *Store) ReconcileMXBill(ctx context.Context, in MXSupplierEvidence) (mxpricing.Quote, error) {
	if s.MXPoints == nil || !identifier.MatchString(in.RequestID) || !identifier.MatchString(in.SupplierRequestID) ||
		in.InputTokens < 0 || in.OutputTokens < 0 || in.CacheReadTokens < 0 || in.CacheCreateTokens < 0 ||
		in.SupplierCostMicrofen < 0 || in.CacheReadTokens > in.InputTokens || in.CacheCreateTokens > in.InputTokens-in.CacheReadTokens {
		return mxpricing.Quote{}, ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return mxpricing.Quote{}, err
	}
	defer tx.Rollback(ctx)
	var owner, execution, settlement string
	var terminal, dispatched, mxWallet bool
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT r.account_id,r.execution,r.settlement,r.terminal_received,r.dispatched,t.mx_points_billing,r.usage
 FROM gateway_requests r JOIN research_tasks t ON t.id=r.task_id WHERE r.id=$1`, in.RequestID).
		Scan(&owner, &execution, &settlement, &terminal, &dispatched, &mxWallet, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return mxpricing.Quote{}, ErrNotFound
	}
	if err != nil {
		return mxpricing.Quote{}, err
	}
	if execution != "completed" || !terminal || !dispatched || !mxWallet ||
		(settlement != "reconciliation_pending" && settlement != "settled") {
		return mxpricing.Quote{}, ErrConflict
	}
	var provider rootflow.Usage
	if json.Unmarshal(raw, &provider) != nil || provider.Input == nil || provider.Output == nil || provider.Cached == nil ||
		*provider.Input != in.InputTokens || *provider.Output != in.OutputTokens || *provider.Cached != in.CacheReadTokens ||
		(provider.CacheCreate != nil && *provider.CacheCreate != in.CacheCreateTokens) {
		return mxpricing.Quote{}, ErrConflict
	}
	_, err = tx.Exec(ctx, `INSERT INTO mx_supplier_reconciliations(request_id,supplier_request_id,input_tokens,output_tokens,cache_read_tokens,cache_create_tokens,supplier_cost_microfen)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(request_id) DO NOTHING`, in.RequestID, in.SupplierRequestID, in.InputTokens, in.OutputTokens, in.CacheReadTokens, in.CacheCreateTokens, in.SupplierCostMicrofen)
	if err != nil {
		return mxpricing.Quote{}, err
	}
	var prior MXSupplierEvidence
	err = tx.QueryRow(ctx, `SELECT supplier_request_id,input_tokens,output_tokens,cache_read_tokens,cache_create_tokens,supplier_cost_microfen
 FROM mx_supplier_reconciliations WHERE request_id=$1 FOR UPDATE`, in.RequestID).
		Scan(&prior.SupplierRequestID, &prior.InputTokens, &prior.OutputTokens, &prior.CacheReadTokens, &prior.CacheCreateTokens, &prior.SupplierCostMicrofen)
	if err != nil || prior.SupplierRequestID != in.SupplierRequestID || prior.InputTokens != in.InputTokens || prior.OutputTokens != in.OutputTokens ||
		prior.CacheReadTokens != in.CacheReadTokens || prior.CacheCreateTokens != in.CacheCreateTokens || prior.SupplierCostMicrofen != in.SupplierCostMicrofen {
		return mxpricing.Quote{}, ErrConflict
	}
	ordinary := in.InputTokens - in.CacheReadTokens - in.CacheCreateTokens
	usage := mxpricing.Usage{Input: &ordinary, Output: &in.OutputTokens, CacheRead: &in.CacheReadTokens, CacheCreate: &in.CacheCreateTokens}
	quote, pending, err := s.MXPoints.SettlePricedTx(ctx, tx, owner, in.RequestID, usage, in.SupplierRequestID)
	if err != nil {
		return mxpricing.Quote{}, err
	}
	if pending {
		return mxpricing.Quote{}, ErrConflict
	}
	if err = s.MXPoints.RecordSupplierBillTx(ctx, tx, owner, in.RequestID, in.SupplierRequestID, in.SupplierCostMicrofen); err != nil {
		return mxpricing.Quote{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE gateway_requests SET settlement='settled' WHERE id=$1 AND settlement IN ('reconciliation_pending','settled')`, in.RequestID)
	if err != nil {
		return mxpricing.Quote{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_events(action,target_id,result,reason) VALUES('mx.supplier_reconcile',$1,'succeeded',$2)`, in.RequestID, in.SupplierRequestID)
	if err != nil {
		return mxpricing.Quote{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return mxpricing.Quote{}, err
	}
	return quote, nil
}
