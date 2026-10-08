package lifecycle

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jamip/materialsx/control-plane/internal/delivery"
	"github.com/jamip/materialsx/control-plane/internal/identity"
	"time"
)

type Alert struct {
	ID       string    `json:"id"`
	Kind     string    `json:"kind"`
	TargetID string    `json:"targetId"`
	State    string    `json:"state"`
	Created  time.Time `json:"createdAt"`
}

func (s Store) Alerts(ctx context.Context) ([]Alert, error) {
	rows, e := s.Pool.Query(ctx, `SELECT id,kind,target_id,state,created_at FROM lifecycle_alerts ORDER BY created_at DESC LIMIT 100`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Alert{}
	for rows.Next() {
		var v Alert
		if e = rows.Scan(&v.ID, &v.Kind, &v.TargetID, &v.State, &v.Created); e != nil {
			return nil, e
		}
		v.Created = v.Created.UTC()
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s Store) Acknowledge(ctx context.Context, actor, id, reason, key string) error {
	if !clean(reason, 256) {
		return identity.ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	fp := fingerprint([]string{"alert.ack", id, reason})
	replay, e := operationReplay(ctx, tx, actor, key, fp)
	if e != nil || replay {
		return e
	}
	tag, e := tx.Exec(ctx, `UPDATE lifecycle_alerts SET state='acknowledged',actor_id=$2,reason=$3,acknowledged_at=clock_timestamp() WHERE id=$1`, id, actor, reason)
	if e != nil {
		return e
	}
	if tag.RowsAffected() == 0 {
		return identity.ErrNotFound
	}
	if e = audit(ctx, tx, actor, "alert.acknowledge", id); e != nil {
		return e
	}
	if e = operationSave(ctx, tx, actor, key, fp); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

// One durable notification per incident/day. No user documents or secret-bearing errors are included.
func (s Store) Tick(ctx context.Context, recipient string, maxDailyMicrofen int64) error {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `INSERT INTO worker_heartbeats(name) VALUES('billing') ON CONFLICT(name) DO UPDATE SET touched_at=clock_timestamp()`); e != nil {
		return e
	}
	rows, e := tx.Query(ctx, `SELECT 'usage-pending',request_id FROM billing_jobs WHERE alerted_at IS NOT NULL AND status<>'completed' UNION ALL SELECT 'payment-pending',id FROM payment_jobs WHERE alerted_at IS NOT NULL AND state<>'completed' UNION ALL SELECT 'notification-uncertain',id FROM notification_outbox WHERE state='manual' AND event_key NOT LIKE 'alert:%' UNION ALL SELECT 'procurement-unknown',r.id FROM gateway_requests r LEFT JOIN procurement_statement_lines l ON l.request_id=r.id LEFT JOIN procurement_costs c ON c.request_id=r.id WHERE r.dispatched AND r.created_at<clock_timestamp()-interval '24 hours' AND l.request_id IS NULL AND (c.state IS NULL OR c.state='unknown') LIMIT 100`)
	if e != nil {
		return e
	}
	incidents := [][2]string{}
	for rows.Next() {
		var kind, target string
		if e = rows.Scan(&kind, &target); e != nil {
			rows.Close()
			return e
		}
		incidents = append(incidents, [2]string{kind, target})
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	if maxDailyMicrofen > 0 {
		var sum int64
		e = tx.QueryRow(ctx, `SELECT COALESCE(sum(cost_microfen),0)::bigint FROM procurement_statement_lines l JOIN gateway_requests r ON r.id=l.request_id WHERE r.created_at>=date_trunc('day',clock_timestamp())`).Scan(&sum)
		if e != nil {
			return e
		}
		if sum > maxDailyMicrofen {
			incidents = append(incidents, [2]string{"procurement-cost", time.Now().UTC().Format("2006-01-02")})
		}
	}
	for _, incident := range incidents {
		id := delivery.ID(incident[0] + ":" + incident[1])
		tag, e := tx.Exec(ctx, `INSERT INTO lifecycle_alerts(id,kind,target_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`, id, incident[0], incident[1])
		if e != nil {
			return e
		}
		if recipient != "" && tag.RowsAffected() == 1 {
			if e = (delivery.Store{Pool: s.Pool, Key: s.Key}).Enqueue(ctx, tx, "alert:"+id, delivery.Message{To: recipient, Subject: "MaterialsX 运营告警", Text: "类型：" + incident[0] + "\n对象：" + incident[1] + "\n请登录运营后台核对。此通知不包含用户输入或密钥。"}); e != nil {
				return e
			}
		}
	}
	// Tokens / encrypted links expire; financial, audit and ticket records are not silently purged.
	if _, e = tx.Exec(ctx, `DELETE FROM email_challenges WHERE expires_at<clock_timestamp()-interval '1 day'`); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `DELETE FROM notification_outbox WHERE state IN ('sent','expired') AND completed_at<clock_timestamp()-interval '30 days'`); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s Store) Enroll(ctx context.Context, actor, owner, state, reason string, version int64, key string) error {
	if !validID.MatchString(owner) || (state != "active" && state != "revoked") || !clean(reason, 256) || version < 0 {
		return identity.ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	fp := fingerprint([]any{"beta.enroll", owner, state, reason, version})
	replay, e := operationReplay(ctx, tx, actor, key, fp)
	if e != nil || replay {
		return e
	}
	var status string
	if e = tx.QueryRow(ctx, `SELECT status FROM accounts WHERE id=$1 AND role='user' FOR UPDATE`, owner).Scan(&status); e != nil || status != "active" {
		return identity.ErrNotFound
	}
	var current int64
	e = tx.QueryRow(ctx, `SELECT version FROM beta_enrollments WHERE account_id=$1 FOR UPDATE`, owner).Scan(&current)
	if e != nil && e != pgx.ErrNoRows {
		return e
	}
	if version != current {
		return identity.ErrConflict
	}
	if _, e = tx.Exec(ctx, `INSERT INTO beta_enrollments(account_id,state,actor_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT(account_id) DO UPDATE SET state=$2,actor_id=$3,reason=$4,version=beta_enrollments.version+1`, owner, state, actor, reason); e != nil {
		return e
	}
	if e = audit(ctx, tx, actor, "beta."+state, owner); e != nil {
		return e
	}
	if e = operationSave(ctx, tx, actor, key, fp); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

func operationReplay(ctx context.Context, tx pgx.Tx, actor, key, fp string) (bool, error) {
	if !validID.MatchString(key) {
		return false, identity.ErrValidation
	}
	if _, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, actor+":"+key); e != nil {
		return false, e
	}
	var prior string
	e := tx.QueryRow(ctx, `SELECT fingerprint FROM workspace_operations WHERE actor_id=$1 AND operation_key=$2`, actor, key).Scan(&prior)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if prior != fp {
		return false, identity.ErrConflict
	}
	return true, nil
}
func operationSave(ctx context.Context, tx pgx.Tx, actor, key, fp string) error {
	_, e := tx.Exec(ctx, `INSERT INTO workspace_operations(actor_id,operation_key,fingerprint,response) VALUES($1,$2,$3,'{"accepted":true}')`, actor, key, fp)
	return e
}

type Enrollment struct {
	AccountID string `json:"accountId"`
	State     string `json:"state"`
	Version   int64  `json:"version,string"`
	Reason    string `json:"reason"`
}

func (s Store) Enrollments(ctx context.Context) ([]Enrollment, error) {
	rows, e := s.Pool.Query(ctx, `SELECT account_id,state,version,reason FROM beta_enrollments ORDER BY created_at DESC LIMIT 100`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Enrollment{}
	for rows.Next() {
		var v Enrollment
		if e = rows.Scan(&v.AccountID, &v.State, &v.Version, &v.Reason); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
