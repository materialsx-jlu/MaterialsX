package gateway

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
)

// RepairOutputOverrun settles only legacy requests that the old gateway marked
// failed after receiving a completed supplier terminal. It never calls the
// supplier and never charges above the original reservation.
func (s *Store) RepairOutputOverrun(ctx context.Context, id string) error {
	if !identifier.MatchString(id) {
		return ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var owner string
	if err = tx.QueryRow(ctx, `SELECT account_id FROM gateway_requests WHERE id=$1`, id).Scan(&owner); err != nil {
		return err
	}
	var locked string
	if err = tx.QueryRow(ctx, `SELECT id FROM accounts WHERE id=$1 FOR UPDATE`, owner).Scan(&locked); err != nil {
		return err
	}
	var execution, code, settlement string
	var terminal, dispatched bool
	var status *int
	var body []byte
	var outputBound int64
	err = tx.QueryRow(ctx, `SELECT g.execution,COALESCE(g.error_code,''),g.settlement,g.terminal_received,g.dispatched,g.upstream_status,g.usage,r.output_bound FROM gateway_requests g JOIN credit_reservations r ON r.request_id=g.id WHERE g.id=$1 AND g.account_id=$2 FOR UPDATE OF g,r`, id, owner).
		Scan(&execution, &code, &settlement, &terminal, &dispatched, &status, &body, &outputBound)
	if err != nil {
		return err
	}
	if execution == "completed" && settlement == "settled" {
		return tx.Commit(ctx)
	}
	if execution != "failed" || code != "TASK_BUDGET_EXCEEDED" || settlement != "reconciliation_pending" || !terminal || !dispatched || status == nil || *status != 200 {
		return ErrConflict
	}
	var usage rootflow.Usage
	if json.Unmarshal(body, &usage) != nil || usage.Source != "responses" || usage.Input == nil || usage.Output == nil || *usage.Output <= outputBound {
		return ErrValidation
	}
	if err = metering.SettleTx(ctx, tx, id, &usage, false, "completed_supplier_output_repair"); err != nil {
		return err
	}
	if err = tx.QueryRow(ctx, `SELECT settlement FROM gateway_requests WHERE id=$1`, id).Scan(&settlement); err != nil {
		return err
	}
	if settlement != "settled" {
		return metering.ErrBudget
	}
	result, err := tx.Exec(ctx, `UPDATE gateway_requests SET execution='completed',error_code=NULL WHERE id=$1 AND execution='failed' AND error_code='TASK_BUDGET_EXCEEDED'`, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errors.New("repair_state_changed")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_events(action,target_id,result,reason) VALUES('billing.output_overrun_repair',$1,'succeeded','completed supplier terminal; existing reservation covered actual usage')`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
