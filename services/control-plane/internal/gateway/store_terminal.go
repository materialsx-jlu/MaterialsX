package gateway

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/metering"
	"github.com/jamip/materialsx/control-plane/internal/mxpricing"
	"github.com/jamip/materialsx/control-plane/internal/providers/rootflow"
)

func (s *Store) Finish(ctx context.Context, id, state, code string, upstream int, terminal bool, usage *rootflow.Usage) error {
	var body any
	if usage != nil {
		b, _ := json.Marshal(usage)
		body = b
	}
	settlement := "reconciliation_pending"
	if terminal && usage != nil && usage.Input != nil && usage.Output != nil {
		settlement = "not_billed"
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var owner string
	if e = tx.QueryRow(ctx, `SELECT account_id FROM gateway_requests WHERE id=$1`, id).Scan(&owner); e != nil {
		return e
	}
	var active bool
	if e = tx.QueryRow(ctx, `SELECT status='active' FROM accounts WHERE id=$1 FOR UPDATE`, owner).Scan(&active); e != nil {
		return e
	}
	var current string
	if e = tx.QueryRow(ctx, `SELECT execution FROM gateway_requests WHERE id=$1 FOR UPDATE`, id).Scan(&current); e != nil {
		return e
	}
	if current != "running" && current != "cancel_requested" && current != "unknown" {
		return tx.Commit(ctx)
	}
	_, e = tx.Exec(ctx, `UPDATE gateway_requests SET execution=$2,settlement=$3,error_code=NULLIF($4,''),upstream_status=NULLIF($5,0),terminal_received=$6,usage=$7,finished_at=clock_timestamp() WHERE id=$1`, id, state, settlement, code, upstream, terminal, body)
	if e != nil {
		return e
	}
	var dispatched bool
	if e = tx.QueryRow(ctx, `SELECT dispatched FROM gateway_requests WHERE id=$1`, id).Scan(&dispatched); e != nil {
		return e
	}
	reliable := usage
	if !terminal {
		reliable = nil
	}
	if e = metering.SettleTx(ctx, tx, id, reliable, !dispatched, "provider_terminal_usage"); e != nil {
		return e
	}
	var mxWallet bool
	if e = tx.QueryRow(ctx, `SELECT t.mx_points_billing FROM gateway_requests r JOIN research_tasks t ON t.id=r.task_id WHERE r.id=$1`, id).Scan(&mxWallet); e != nil {
		return e
	}
	if mxWallet {
		if s.MXPoints == nil {
			return ErrUnavailable
		}
		settlement = "reconciliation_pending"
		if !dispatched {
			if e = s.MXPoints.ReleasePricedTx(ctx, tx, owner, id); e != nil {
				return e
			}
			settlement = "released"
		} else {
			var pricedUsage mxpricing.Usage
			if reliable != nil {
				pricedUsage.Output, pricedUsage.CacheRead, pricedUsage.CacheCreate = reliable.Output, reliable.Cached, reliable.CacheCreate
				if reliable.Input != nil && reliable.Cached != nil && reliable.CacheCreate != nil && *reliable.Cached <= *reliable.Input && *reliable.CacheCreate <= *reliable.Input-*reliable.Cached {
					ordinary := *reliable.Input - *reliable.Cached - *reliable.CacheCreate
					pricedUsage.Input = &ordinary
				}
			}
			_, pending, settleError := s.MXPoints.SettlePricedTx(ctx, tx, owner, id, pricedUsage, "provider_terminal_usage")
			if settleError != nil {
				return settleError
			}
			if !pending {
				settlement = "settled"
			}
		}
		if _, e = tx.Exec(ctx, `UPDATE gateway_requests SET settlement=$2 WHERE id=$1`, id, settlement); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) EndTask(ctx context.Context, owner, id, state string) (Task, error) {
	if e := s.expire(ctx); e != nil {
		return Task{}, e
	}
	if state != "completed" && state != "cancelled" && state != "failed" && state != "interrupted" {
		return Task{}, ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Task{}, e
	}
	defer tx.Rollback(ctx)
	var current string
	e = tx.QueryRow(ctx, `SELECT state FROM research_tasks WHERE id=$1 AND account_id=$2 FOR UPDATE`, id, owner).Scan(&current)
	if errors.Is(e, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	if e != nil {
		return Task{}, e
	}
	if current != "created" && current != "running" {
		if current != state {
			return Task{}, ErrConflict
		}
		if e = tx.Commit(ctx); e != nil {
			return Task{}, e
		}
		return s.Task(ctx, owner, id)
	}
	var active bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM gateway_requests WHERE task_id=$1 AND execution IN ('running','cancel_requested'))`, id).Scan(&active)
	if e != nil {
		return Task{}, e
	}
	if active {
		return Task{}, ErrConflict
	}
	if state == "completed" {
		var valid bool
		e = tx.QueryRow(ctx, `SELECT count(*)>0 AND bool_and(execution='completed' AND terminal_received) FROM gateway_requests WHERE task_id=$1`, id).Scan(&valid)
		if e != nil {
			return Task{}, e
		}
		if !valid {
			return Task{}, ErrConflict
		}
	}
	_, e = tx.Exec(ctx, `UPDATE research_tasks SET state=$2 WHERE id=$1`, id, state)
	if e != nil {
		return Task{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Task{}, e
	}
	return s.Task(ctx, owner, id)
}

// Cancel the task even between rounds; later requests cannot be admitted.
func (s *Store) CancelTask(ctx context.Context, owner, id string) (Task, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return Task{}, e
	}
	defer tx.Rollback(ctx)
	tag, e := tx.Exec(ctx, `UPDATE research_tasks SET state='cancelled' WHERE id=$1 AND account_id=$2 AND state IN ('created','running')`, id, owner)
	if e != nil {
		return Task{}, e
	}
	_ = tag
	_, e = tx.Exec(ctx, `UPDATE gateway_requests SET execution='cancel_requested' WHERE task_id=$1 AND account_id=$2 AND execution='running'`, id, owner)
	if e != nil {
		return Task{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return Task{}, e
	}
	return s.Task(ctx, owner, id)
}
