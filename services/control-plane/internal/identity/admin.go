package identity

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"
)

type AuditEvent struct {
	ID        int64   `json:"id,string"`
	ActorID   *string `json:"actorId"`
	Action    string  `json:"action"`
	TargetID  *string `json:"targetId"`
	Result    string  `json:"result"`
	Reason    string  `json:"reason"`
	CreatedAt string  `json:"createdAt"`
}
type StatusResult struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Version int64  `json:"version,string"`
}

func (s *Service) Users(ctx context.Context, p Principal, cursor string, limit int) ([]User, error) {
	if !s.AdminAllowed(p) {
		return nil, ErrForbidden
	}
	rows, e := s.Pool.Query(ctx, `SELECT id,email,display_name,role,status,version FROM accounts WHERE id>$1 ORDER BY id LIMIT $2`, cursor, limit)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		if e = rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Role, &u.Status, &u.Version); e != nil {
			return nil, e
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
func (s *Service) Audit(ctx context.Context, p Principal, cursor int64, limit int) ([]AuditEvent, error) {
	if !s.AdminAllowed(p) {
		return nil, ErrForbidden
	}
	rows, e := s.Pool.Query(ctx, `SELECT id,actor_id,action,target_id,result,reason,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM audit_events WHERE ($1::bigint=0 OR id<$1) ORDER BY id DESC LIMIT $2`, cursor, limit)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []AuditEvent{}
	for rows.Next() {
		var a AuditEvent
		if e = rows.Scan(&a.ID, &a.ActorID, &a.Action, &a.TargetID, &a.Result, &a.Reason, &a.CreatedAt); e != nil {
			return nil, e
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func (s *Service) SetStatus(ctx context.Context, p Principal, target, status, reason, key string, expected int64) (StatusResult, error) {
	r := StatusResult{ID: target, Status: status}
	if !s.AdminAllowed(p) {
		return r, ErrForbidden
	}
	if target == p.ID {
		return r, ErrConflict
	}
	if (status != "active" && status != "suspended") || len(strings.TrimSpace(reason)) < 1 || len(reason) > 256 || len(key) < 1 || len(key) > 128 || expected < 1 {
		return r, ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return r, e
	}
	defer tx.Rollback(ctx)
	// Recheck actor and session inside the mutation transaction.
	var role, actorStatus string
	if e = tx.QueryRow(ctx, `SELECT role,status FROM accounts WHERE id=$1 FOR UPDATE`, p.ID).Scan(&role, &actorStatus); e != nil || role != "admin" || actorStatus != "active" {
		return r, ErrForbidden
	}
	var live bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions s JOIN devices d ON d.id=s.device_id WHERE s.id=$1 AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.expires_at>$2 AND ($3 OR s.mfa_verified_at>$2::timestamptz-interval '12 hours'))`, p.SessionID, s.now(), s.DisableAdminTOTP).Scan(&live)
	if e != nil || !live {
		return r, ErrForbidden
	}
	fingerprint := digest(target + "\x00" + status + "\x00" + reason + "\x00" + stringInt(expected))
	var prior string
	e = tx.QueryRow(ctx, `SELECT fingerprint,result_status,result_version FROM admin_operations WHERE actor_id=$1 AND operation_key=$2`, p.ID, key).Scan(&prior, &r.Status, &r.Version)
	if e == nil {
		if prior != fingerprint {
			return r, ErrIdempotency
		}
		return r, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return r, e
	}
	var current int64
	var targetRole string
	e = tx.QueryRow(ctx, `SELECT version,role FROM accounts WHERE id=$1 FOR UPDATE`, target).Scan(&current, &targetRole)
	if errors.Is(e, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	if e != nil {
		return r, e
	}
	if targetRole == "admin" {
		return r, ErrConflict
	}
	if current != expected {
		return r, ErrConflict
	}
	r.Status = status
	r.Version = current + 1
	if _, e = tx.Exec(ctx, `UPDATE accounts SET status=$2,version=$3 WHERE id=$1`, target, status, r.Version); e != nil {
		return r, e
	}
	if status == "suspended" {
		if _, e = tx.Exec(ctx, `UPDATE sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE account_id=$1`, target, s.now()); e != nil {
			return r, e
		}
	}
	if _, e = tx.Exec(ctx, `INSERT INTO admin_operations(actor_id,operation_key,fingerprint,result_status,result_version) VALUES($1,$2,$3,$4,$5)`, p.ID, key, fingerprint, status, r.Version); e != nil {
		return r, e
	}
	if e = audit(ctx, tx, &p.ID, "account."+status, target, "succeeded", reason); e != nil {
		return r, e
	}
	return r, tx.Commit(ctx)
}
