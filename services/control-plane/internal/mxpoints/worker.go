package mxpoints

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/payments"
)

// Durable submitting markers precede provider POSTs. Unknown outcomes are
// resolved by query with the same order/refund ID, never a second POST.
func (s *Store) Tick(ctx context.Context, limit int) (int, error) {
	if s.Provider == nil {
		return 0, nil
	}
	if limit < 1 || limit > 100 {
		return 0, ErrValidation
	}
	rows, err := s.Pool.Query(ctx, `SELECT id FROM mx_point_jobs WHERE state='pending' AND available_at<=clock_timestamp() ORDER BY available_at,id LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	ids := []string{}
	for rows.Next() {
		var jobID string
		if err = rows.Scan(&jobID); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, jobID)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	done := 0
	for _, jobID := range ids {
		worked, err := s.tickJob(ctx, jobID)
		if err != nil {
			return done, err
		}
		if worked {
			done++
		}
	}
	return done, nil
}
func (s *Store) tickJob(ctx context.Context, jobID string) (bool, error) {
	conn, err := pgx.ConnectConfig(ctx, s.Pool.Config().ConnConfig.Copy())
	if err != nil {
		return false, err
	}
	defer conn.Close(ctx)
	guard, err := conn.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer guard.Rollback(ctx)
	var locked bool
	if err = guard.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended('mx-point-job:'||$1,0))`, jobID).Scan(&locked); err != nil || !locked {
		return false, err
	}
	var orderID, kind, state string
	var refundID *string
	err = guard.QueryRow(ctx, `SELECT order_id,refund_id,kind,state FROM mx_point_jobs WHERE id=$1 AND available_at<=clock_timestamp()`, jobID).Scan(&orderID, &refundID, &kind, &state)
	if errors.Is(err, pgx.ErrNoRows) || state != "pending" {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	call, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	var channelErr error
	if kind == "order" {
		channelErr = s.tickOrder(call, orderID)
	} else if kind == "refund" && refundID != nil {
		channelErr = s.tickRefund(call, orderID, *refundID)
	} else {
		return false, ErrValidation
	}
	label := "awaiting_channel"
	if channelErr != nil {
		label = "channel_or_evidence_unresolved"
	}
	// No raw provider error, response, payer data or key is persisted.
	_, err = s.Pool.Exec(ctx, `UPDATE mx_point_jobs SET attempts=attempts+1,last_error=$2,
 available_at=clock_timestamp()+interval '15 seconds',
 state=CASE WHEN created_at<clock_timestamp()-interval '24 hours' THEN 'manual' ELSE state END
 WHERE id=$1 AND state='pending'`, jobID, label)
	return true, err
}
func (s *Store) tickOrder(ctx context.Context, orderID string) error {
	var state, checkout string
	var expires time.Time
	var closeRequested bool
	err := s.Pool.QueryRow(ctx, `SELECT state,checkout_state,expires_at,close_requested FROM mx_point_orders WHERE id=$1`, orderID).Scan(&state, &checkout, &expires, &closeRequested)
	if err != nil {
		return err
	}
	if state != "pending" {
		_, err = s.Pool.Exec(ctx, `UPDATE mx_point_jobs SET state='completed' WHERE id=$1`, orderID)
		return err
	}
	o, err := s.providerOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if checkout == "not_started" {
		if closeRequested {
			_, err := s.Pool.Exec(ctx, `UPDATE mx_point_orders SET state='closed',version=version+1 WHERE id=$1 AND state='pending' AND checkout_state='not_started' AND close_requested=true`, orderID)
			return err
		}
		tag, err := s.Pool.Exec(ctx, `UPDATE mx_point_orders SET checkout_state='submitting',version=version+1 WHERE id=$1 AND state='pending' AND checkout_state='not_started' AND close_requested=false`, orderID)
		if err != nil || tag.RowsAffected() != 1 {
			return ErrConflict
		}
		code, err := s.Provider.Create(ctx, o)
		if err != nil {
			_, db := s.Pool.Exec(ctx, `UPDATE mx_point_orders SET checkout_state='unknown',version=version+1 WHERE id=$1 AND state='pending'`, orderID)
			if db != nil {
				return db
			}
			return err
		}
		_, err = s.Pool.Exec(ctx, `UPDATE mx_point_orders SET code_url=$2,checkout_state='ready',version=version+1 WHERE id=$1 AND state='pending'`, orderID, code)
		return err
	}
	v, err := s.Provider.Query(ctx, o)
	if err != nil {
		return err
	}
	if err = s.ApplyPayment(ctx, v); err != nil {
		return err
	}
	if (v.State == "NOTPAY" || v.State == "USERPAYING") && (expires.Before(time.Now()) || closeRequested) {
		return s.Provider.Close(ctx, o)
	}
	return nil
}
func (s *Store) tickRefund(ctx context.Context, orderID, refundID string) error {
	var approval, execution string
	var amount int64
	err := s.Pool.QueryRow(ctx, `SELECT approval,execution,amount_fen FROM mx_point_refunds WHERE id=$1`, refundID).Scan(&approval, &execution, &amount)
	if err != nil {
		return err
	}
	if approval != "approved" || execution == "succeeded" {
		_, err = s.Pool.Exec(ctx, `UPDATE mx_point_jobs SET state='completed' WHERE id=$1`, refundID)
		return err
	}
	o, err := s.providerOrder(ctx, orderID)
	if err != nil {
		return err
	}
	r := payments.Refund{ID: refundID, OrderID: orderID, AmountFen: strconv.FormatInt(amount, 10)}
	var v payments.Evidence
	if execution == "not_started" {
		// The channel must still report the original payment as successful before
		// the first refund POST. A local paid row alone is not enough evidence.
		payment, queryErr := s.Provider.Query(ctx, o)
		if queryErr != nil || payment.State != "SUCCESS" || s.ApplyPayment(ctx, payment) != nil {
			return ErrEvidence
		}
		tag, err := s.Pool.Exec(ctx, `UPDATE mx_point_refunds SET execution='submitting',version=version+1 WHERE id=$1 AND approval='approved' AND execution='not_started'`, refundID)
		if err != nil || tag.RowsAffected() != 1 {
			return ErrConflict
		}
		v, err = s.Provider.Refund(ctx, o, r)
	} else {
		v, err = s.Provider.QueryRefund(ctx, o, r)
	}
	if err != nil {
		_, db := s.Pool.Exec(ctx, `UPDATE mx_point_refunds SET execution='pending',version=version+1 WHERE id=$1 AND execution='submitting'`, refundID)
		if db != nil {
			return db
		}
		return err
	}
	if v.State == "SUCCESS" {
		return s.ApplyRefund(ctx, v)
	}
	_, err = s.Pool.Exec(ctx, `UPDATE mx_point_refunds SET execution='pending',version=version+1 WHERE id=$1 AND execution='submitting'`, refundID)
	return err
}

// RecheckJob is reserved for a future authorized finance API. It only wakes
// durable query recovery: submitting/unknown checkout and refund states are
// never reset to not_started, so it cannot cause a duplicate channel POST.
func (s *Store) RecheckJob(ctx context.Context, actor, jobID, reason string) error {
	return s.RecheckJobWithKey(ctx, actor, jobID, reason, "")
}
func (s *Store) RecheckJobWithKey(ctx context.Context, actor, jobID, reason, key string) error {
	if !identifier.MatchString(actor) || !identifier.MatchString(jobID) || len(reason) < 1 || len(reason) > 256 {
		return ErrValidation
	}
	if key != "" && (!identifier.MatchString(key) || len(reason) < 4) {
		return ErrValidation
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var role, status string
	var allowed bool
	if err = tx.QueryRow(ctx, `SELECT a.role,a.status,EXISTS(SELECT 1 FROM billing_staff_roles b WHERE b.account_id=a.id AND b.revoked_at IS NULL AND b.role IN ('billing.operator','billing.finance','billing.admin')) FROM accounts a WHERE a.id=$1 FOR SHARE`, actor).Scan(&role, &status, &allowed); err != nil || (role != "admin" && role != "billing_staff") || status != "active" || !allowed {
		return ErrDisabled
	}
	if key != "" {
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('mx-billing-recheck:'||$1||':'||$2,0))`, actor, key); err != nil {
			return err
		}
		var prior string
		err = tx.QueryRow(ctx, `SELECT fingerprint FROM billing_admin_actions WHERE actor_id=$1 AND action='mx.order_recheck' AND idempotency_key=$2`, actor, key).Scan(&prior)
		if err == nil {
			if prior == fingerprint([]string{jobID, reason}) {
				return tx.Commit(ctx)
			}
			return ErrConflict
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	}
	var state string
	if err = tx.QueryRow(ctx, `SELECT state FROM mx_point_jobs WHERE id=$1 FOR UPDATE`, jobID).Scan(&state); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if state != "manual" {
		return ErrConflict
	}
	if _, err = tx.Exec(ctx, `UPDATE mx_point_jobs SET state='pending',available_at=clock_timestamp(),last_error='operator_recheck' WHERE id=$1`, jobID); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "mx.channel_recheck", jobID, reason); err != nil {
		return err
	}
	if key != "" {
		_, err = tx.Exec(ctx, `INSERT INTO billing_admin_actions(actor_id,action,target_id,idempotency_key,fingerprint,result,reason) VALUES($1,'mx.order_recheck',$2,$3,$4,$5,$6)`, actor, jobID, key, fingerprint([]string{jobID, reason}), map[string]any{"scheduled": true}, reason)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
