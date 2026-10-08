package mxpoints

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/payments"
)

func scanRefund(row pgx.Row) (Refund, error) {
	var r Refund
	var amount, points int64
	err := row.Scan(&r.ID, &r.OrderID, &amount, &points, &r.Approval, &r.Execution, &r.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	if err != nil {
		return r, err
	}
	r.AmountFen, r.Points, r.Policy = strconv.FormatInt(amount, 10), Points(points), "mx-unused-full-v1"
	return r, nil
}

const refundColumns = `id,order_id,amount_fen,frozen_subunits,approval,execution,version`

func (s *Store) Refund(ctx context.Context, owner, refundID string) (Refund, error) {
	return scanRefund(s.Pool.QueryRow(ctx, `SELECT `+refundColumns+` FROM mx_point_refunds WHERE account_id=$1 AND id=$2`, owner, refundID))
}
func (s *Store) Refunds(ctx context.Context, owner, orderID string) ([]Refund, error) {
	if !identifier.MatchString(orderID) {
		return nil, ErrValidation
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+refundColumns+` FROM mx_point_refunds WHERE account_id=$1 AND order_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100`, owner, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Refund, 0)
	for rows.Next() {
		item, err := scanRefund(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// Only the exact, wholly unused purchase can be refunded in 0.3.3. A frozen
// batch cannot be reserved while a human decision or channel result is pending.
func (s *Store) RequestRefund(ctx context.Context, owner, key, orderID, reason string) (Refund, error) {
	if !identifier.MatchString(key) || !identifier.MatchString(orderID) || len(reason) < 1 || len(reason) > 256 {
		return Refund{}, ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Refund{}, err
	}
	defer tx.Rollback(ctx)
	if err = lockAccount(ctx, tx, owner, false); err != nil {
		return Refund{}, err
	}
	var existing, existingOrder string
	err = tx.QueryRow(ctx, `SELECT id,order_id FROM mx_point_refunds WHERE account_id=$1 AND idempotency_key=$2`, owner, key).Scan(&existing, &existingOrder)
	if err == nil {
		if existingOrder != orderID {
			return Refund{}, ErrConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return Refund{}, err
		}
		return s.Refund(ctx, owner, existing)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Refund{}, err
	}
	var state string
	var amount, points int64
	var paidAt *time.Time
	err = tx.QueryRow(ctx, `SELECT state,amount_fen,points_subunits,paid_at FROM mx_point_orders WHERE id=$1 AND account_id=$2 FOR UPDATE`, orderID, owner).Scan(&state, &amount, &points, &paidAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Refund{}, ErrNotFound
	}
	if err != nil {
		return Refund{}, err
	}
	if state != "paid" || paidAt == nil || paidAt.Before(time.Now().Add(-365*24*time.Hour)) {
		return Refund{}, ErrRefund
	}
	var granted, held, consumed, frozen, returned int64
	err = tx.QueryRow(ctx, `SELECT granted,held,consumed,frozen,returned FROM mx_point_batches WHERE order_id=$1 FOR UPDATE`, orderID).Scan(&granted, &held, &consumed, &frozen, &returned)
	if err != nil {
		return Refund{}, err
	}
	if granted != points || held != 0 || consumed != 0 || frozen != 0 || returned != 0 {
		return Refund{}, ErrRefund
	}
	refundID := id("mxr")
	_, err = tx.Exec(ctx, `INSERT INTO mx_point_refunds(id,order_id,account_id,idempotency_key,amount_fen,frozen_subunits,reason)
 VALUES($1,$2,$3,$4,$5,$6,$7)`, refundID, orderID, owner, key, amount, points, reason)
	if err != nil {
		return Refund{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE mx_point_batches SET frozen=$2 WHERE order_id=$1`, orderID, points); err != nil {
		return Refund{}, err
	}
	if err = ledger(ctx, tx, owner, orderID, "", refundID, "mx:refund_freeze:"+refundID, "refund_freeze", 0, 0, 0, points, 0); err != nil {
		return Refund{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE mx_point_orders SET state='refund_pending',version=version+1 WHERE id=$1`, orderID); err != nil {
		return Refund{}, err
	}
	if err = audit(ctx, tx, owner, "mx.refund_requested", refundID, "unused_full_only"); err != nil {
		return Refund{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Refund{}, err
	}
	return s.Refund(ctx, owner, refundID)
}

// Decision is internal until 0.3.5 supplies an independently authorized admin API.
func (s *Store) DecideRefund(ctx context.Context, actor, refundID, decision string, version int64) error {
	return s.DecideRefundWithKey(ctx, actor, refundID, decision, version, "", "")
}

func (s *Store) DecideRefundWithKey(ctx context.Context, actor, refundID, decision string, version int64, key, reason string) error {
	if !identifier.MatchString(actor) || !identifier.MatchString(refundID) || (decision != "approve" && decision != "reject") || version < 1 {
		return ErrValidation
	}
	if key != "" && (!identifier.MatchString(key) || len(reason) < 4 || len(reason) > 256) {
		return ErrValidation
	}
	var owner string
	if err := s.Pool.QueryRow(ctx, `SELECT account_id FROM mx_point_refunds WHERE id=$1`, refundID).Scan(&owner); err != nil {
		return ErrNotFound
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var role, status string
	var allowed bool
	if err = tx.QueryRow(ctx, `SELECT a.role,a.status,EXISTS(SELECT 1 FROM billing_staff_roles b WHERE b.account_id=a.id AND b.revoked_at IS NULL AND b.role IN ('billing.finance','billing.admin')) FROM accounts a WHERE a.id=$1 FOR SHARE`, actor).Scan(&role, &status, &allowed); err != nil || (role != "admin" && role != "billing_staff") || status != "active" || !allowed {
		return ErrDisabled
	}
	if key != "" {
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('mx-billing-refund:'||$1||':'||$2,0))`, actor, key); err != nil {
			return err
		}
		var prior string
		err = tx.QueryRow(ctx, `SELECT fingerprint FROM billing_admin_actions WHERE actor_id=$1 AND action='mx.refund_decision' AND idempotency_key=$2`, actor, key).Scan(&prior)
		if err == nil {
			if prior == fingerprint([]any{refundID, decision, version, reason}) {
				return tx.Commit(ctx)
			}
			return ErrConflict
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	}
	if err = lockAccount(ctx, tx, owner, false); err != nil {
		return err
	}
	var orderID, approval string
	var amount int64
	var current int64
	err = tx.QueryRow(ctx, `SELECT order_id,approval,frozen_subunits,version FROM mx_point_refunds WHERE id=$1 FOR UPDATE`, refundID).Scan(&orderID, &approval, &amount, &current)
	if err != nil {
		return err
	}
	if current != version || approval != "requested" {
		return ErrConflict
	}
	if decision == "reject" {
		if _, err = tx.Exec(ctx, `UPDATE mx_point_batches SET frozen=frozen-$2 WHERE order_id=$1`, orderID, amount); err != nil {
			return err
		}
		if err = ledger(ctx, tx, owner, orderID, "", refundID, "mx:refund_release:"+refundID, "refund_release", 0, 0, 0, -amount, 0); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE mx_point_orders SET state='paid',version=version+1 WHERE id=$1`, orderID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE mx_point_refunds SET approval='rejected',version=version+1 WHERE id=$1`, refundID)
	} else {
		if _, err = tx.Exec(ctx, `UPDATE mx_point_refunds SET approval='approved',version=version+1 WHERE id=$1`, refundID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO mx_point_jobs(id,order_id,refund_id,kind) VALUES($1,$2,$1,'refund')`, refundID, orderID)
	}
	if err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "mx.refund_"+decision, refundID, "versioned_decision"); err != nil {
		return err
	}
	if key != "" {
		_, err = tx.Exec(ctx, `INSERT INTO billing_admin_actions(actor_id,action,target_id,idempotency_key,fingerprint,result,reason) VALUES($1,'mx.refund_decision',$2,$3,$4,$5,$6)`, actor, refundID, key, fingerprint([]any{refundID, decision, version, reason}), map[string]any{"decision": decision, "version": version + 1}, reason)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ApplyRefund(ctx context.Context, v payments.Evidence) error {
	if v.RefundID == "" || v.State != "SUCCESS" || !identifier.MatchString(v.ProviderRefundID) {
		return ErrEvidence
	}
	var owner string
	if err := s.Pool.QueryRow(ctx, `SELECT account_id FROM mx_point_refunds WHERE id=$1`, v.RefundID).Scan(&owner); err != nil {
		return ErrNotFound
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = lockAccount(ctx, tx, owner, false); err != nil {
		return err
	}
	var orderID, approval, execution string
	var amount, points int64
	var providerID *string
	err = tx.QueryRow(ctx, `SELECT order_id,approval,execution,amount_fen,frozen_subunits,provider_refund_id FROM mx_point_refunds WHERE id=$1 FOR UPDATE`, v.RefundID).Scan(&orderID, &approval, &execution, &amount, &points, &providerID)
	if err != nil {
		return err
	}
	var originalTransaction, channel string
	err = tx.QueryRow(ctx, `SELECT transaction_id,channel FROM mx_point_orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&originalTransaction, &channel)
	if err != nil {
		return err
	}
	if approval != "approved" || v.OrderID != orderID || v.Total != amount || v.Refund != amount || v.TransactionID != originalTransaction ||
		v.Currency != "CNY" || v.Merchant != s.Merchant || v.AppID != s.AppID || (channel == "test") != (v.Source == "test") {
		return ErrEvidence
	}
	if err = s.storeEvidence(ctx, tx, orderID, v); err != nil {
		return err
	}
	if execution == "succeeded" {
		if providerID == nil || *providerID != v.ProviderRefundID {
			return ErrEvidence
		}
		return tx.Commit(ctx)
	}
	if _, err = tx.Exec(ctx, `UPDATE mx_point_batches SET frozen=frozen-$2,returned=returned+$2 WHERE order_id=$1`, orderID, points); err != nil {
		return err
	}
	if err = ledger(ctx, tx, owner, orderID, "", v.RefundID, "mx:refund:"+v.RefundID, "refund", 0, 0, 0, -points, points); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE mx_point_refunds SET execution='succeeded',provider_refund_id=$2,executed_at=clock_timestamp(),version=version+1 WHERE id=$1`, v.RefundID, v.ProviderRefundID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE mx_point_orders SET state='refunded',version=version+1 WHERE id=$1`, orderID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE mx_point_jobs SET state='completed' WHERE id=$1`, v.RefundID); err != nil {
		return err
	}
	if err = audit(ctx, tx, "", "mx.refund_verified", v.RefundID, v.Source); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
