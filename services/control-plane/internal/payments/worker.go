package payments

import (
	"context"
	"github.com/jackc/pgx/v5"
	"time"
)

// Advisory job locks span provider I/O without holding account row locks. Durable dispatch
// markers are committed BEFORE POST. After ambiguity/restart we query only, never blindly POST.
func (s *Store) Tick(ctx context.Context, limit int) (int, error) {
	if s.Provider == nil {
		return 0, nil
	}
	if limit < 1 || limit > 100 {
		return 0, ErrValidation
	}
	rows, e := s.Pool.Query(ctx, `SELECT id FROM payment_jobs WHERE state='pending' AND available_at<=clock_timestamp() ORDER BY available_at,id LIMIT $1`, limit)
	if e != nil {
		return 0, e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return 0, e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return 0, e
	}
	done := 0
	for _, id := range ids {
		ok, e := s.job(ctx, id)
		if e != nil {
			return done, e
		}
		if ok {
			done++
		}
	}
	return done, nil
}
func (s *Store) job(ctx context.Context, id string) (bool, error) {
	conn, e := pgx.ConnectConfig(ctx, s.Pool.Config().ConnConfig.Copy())
	if e != nil {
		return false, e
	}
	defer conn.Close(ctx)
	guard, e := conn.Begin(ctx)
	if e != nil {
		return false, e
	}
	defer guard.Rollback(ctx)
	var locked bool
	if e = guard.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended('payment-job:'||$1,0))`, id).Scan(&locked); e != nil || !locked {
		return false, e
	}
	var oid, kind, state, owner string
	var rid *string
	var created time.Time
	e = guard.QueryRow(ctx, `SELECT j.order_id,j.refund_id,j.kind,j.state,j.created_at,o.account_id FROM payment_jobs j JOIN payment_orders o ON o.id=j.order_id WHERE j.id=$1 AND j.available_at<=clock_timestamp()`, id).Scan(&oid, &rid, &kind, &state, &created, &owner)
	if e == pgx.ErrNoRows {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if state != "pending" {
		return false, nil
	}
	o, e := s.Order(ctx, owner, oid)
	if e != nil {
		return false, e
	}
	call, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if kind == "order" {
		if o.State != "pending" {
			_, e = s.Pool.Exec(ctx, `UPDATE payment_jobs SET state='completed' WHERE id=$1`, id)
			return true, e
		}
		if o.Checkout == "not_started" {
			e = s.transaction(ctx, oid, func(tx pgx.Tx, _ string, cur Order) error {
				if cur.Checkout != "not_started" || cur.State != "pending" {
					return ErrConflict
				}
				_, e := tx.Exec(ctx, `UPDATE payment_orders SET checkout_state='submitting',version=version+1 WHERE id=$1`, oid)
				return e
			})
			if e == nil {
				var code string
				code, e = s.Provider.Create(call, o)
				if e == nil {
					_, e = s.Pool.Exec(ctx, `UPDATE payment_orders SET code_url=$2,checkout_state='ready',version=version+1 WHERE id=$1 AND state='pending'`, oid, code)
				} else {
					_, db := s.Pool.Exec(ctx, `UPDATE payment_orders SET checkout_state='unknown',version=version+1 WHERE id=$1 AND state='pending'`, oid)
					if db != nil {
						return false, db
					}
				}
			}
		} else {
			var v Evidence
			v, e = s.Provider.Query(call, o)
			if e == nil {
				e = s.ApplyPayment(call, v)
				if e == nil && (v.State == "NOTPAY" || v.State == "USERPAYING") && (o.Expires.Before(time.Now()) || o.CloseRequested) {
					e = s.Provider.Close(call, o)
				}
			}
		}
	} else {
		r, db := scanRefund(s.Pool.QueryRow(ctx, `SELECT `+refundColumns+` FROM payment_refunds WHERE id=$1`, *rid))
		if db != nil {
			return false, db
		}
		if r.Execution == "succeeded" || r.Execution == "failed" {
			_, e = s.Pool.Exec(ctx, `UPDATE payment_jobs SET state='completed' WHERE id=$1`, id)
			return true, e
		}
		var v Evidence
		if r.Execution == "not_started" {
			e = s.transaction(ctx, oid, func(tx pgx.Tx, _ string, _ Order) error {
				tag, e := tx.Exec(ctx, `UPDATE payment_refunds SET execution='submitting',version=version+1 WHERE id=$1 AND execution='not_started' AND approval='approved'`, r.ID)
				if e == nil && tag.RowsAffected() != 1 {
					return ErrConflict
				}
				return e
			})
			if e == nil {
				v, e = s.Provider.Refund(call, o, r)
			}
		} else {
			v, e = s.Provider.QueryRefund(call, o, r)
		}
		if e == nil {
			e = s.ApplyRefund(call, v)
		} else {
			_, db = s.Pool.Exec(ctx, `UPDATE payment_refunds SET execution='pending',version=version+1 WHERE id=$1 AND execution='submitting'`, r.ID)
			if db != nil {
				return false, db
			}
		}
	}
	reason := "awaiting_channel"
	if e != nil {
		reason = "channel_or_evidence_unresolved"
	} // Never persist raw upstream errors/bodies/PII/credentials.
	_, db := s.Pool.Exec(ctx, `UPDATE payment_jobs SET attempts=attempts+1,last_error=$2,alerted_at=CASE WHEN created_at<clock_timestamp()-interval '24 hours' THEN COALESCE(alerted_at,clock_timestamp()) ELSE alerted_at END,manual_at=CASE WHEN created_at<clock_timestamp()-interval '72 hours' THEN COALESCE(manual_at,clock_timestamp()) ELSE manual_at END,state=CASE WHEN created_at<clock_timestamp()-interval '72 hours' THEN 'manual' ELSE state END,available_at=clock_timestamp()+make_interval(secs=>LEAST(3600,10*power(2,LEAST(attempts,8)))) WHERE id=$1 AND state='pending'`, id, reason)
	return true, db
}
func (s *Store) Wake(ctx context.Context, owner, id string) error {
	o, e := s.Order(ctx, owner, id)
	if e != nil {
		return e
	}
	if o.State != "pending" && o.State != "refund_pending" {
		return nil
	}
	_, e = s.Pool.Exec(ctx, `UPDATE payment_jobs SET available_at=clock_timestamp() WHERE order_id=$1 AND state='pending'`, id)
	return e
}
