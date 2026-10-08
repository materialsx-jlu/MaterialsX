package identity

import (
	"context"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"regexp"
	"strings"
)

// Deployment operations use a migration-owner connection, never the runtime role.
func GrantRuntime(ctx context.Context, pool *pgxpool.Pool, role string) error {
	if !regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`).MatchString(role) {
		return ErrValidation
	}
	tx, e := pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	r := pgx.Identifier{role}.Sanitize()
	var database string
	if e = tx.QueryRow(ctx, `SELECT current_database()`).Scan(&database); e != nil {
		return e
	}
	for _, sql := range []string{
		`GRANT CONNECT ON DATABASE ` + pgx.Identifier{database}.Sanitize() + ` TO ` + r,
		`GRANT USAGE ON SCHEMA mx_identity TO ` + r,
		`GRANT SELECT ON ALL TABLES IN SCHEMA mx_identity TO ` + r,
		`GRANT INSERT ON auth_flows,devices,sessions,access_tokens,refresh_tokens,rate_limits,admin_operations,audit_events TO ` + r,
		`GRANT UPDATE ON auth_flows,devices,sessions,refresh_tokens,rate_limits TO ` + r,
		`REVOKE UPDATE ON research_tasks,gateway_requests,credit_reservations,reservation_allocations,billing_jobs,procurement_costs FROM ` + r,
		`GRANT INSERT ON research_tasks,gateway_requests,credit_reservations,reservation_allocations,billing_jobs,procurement_costs TO ` + r,
		`GRANT UPDATE(state,request_count) ON research_tasks TO ` + r,
		`GRANT UPDATE(execution,settlement,error_code,upstream_status,terminal_received,usage,finished_at,dispatched,counted_input_tokens,input_count_evidence) ON gateway_requests TO ` + r,
		`GRANT UPDATE(status,charged,usage_fingerprint,version) ON credit_reservations TO ` + r,
		`GRANT UPDATE(charged) ON reservation_allocations TO ` + r,
		`GRANT UPDATE(status,reason,attempts,available_at,alerted_at,manual_at) ON billing_jobs TO ` + r,
		`GRANT INSERT ON credit_ledger,reconciliation_evidence TO ` + r,
		`GRANT INSERT ON credit_grants,payment_orders,payment_refunds,payment_evidence,payment_jobs,subscription_periods TO ` + r,
		`GRANT UPDATE(consumed,held,refund_frozen,returned,paid_held_subunits,paid_consumed_subunits) ON credit_grants TO ` + r,
		`GRANT UPDATE(close_requested,state,checkout_state,code_url,transaction_id,paid_at,grant_id,refunded_fen,version) ON payment_orders TO ` + r,
		`GRANT UPDATE(approval,execution,frozen_credits,provider_refund_id,version,decision_reason,actor_id) ON payment_refunds TO ` + r,
		`GRANT UPDATE(state) ON subscription_periods TO ` + r,
		`GRANT UPDATE(state,attempts,available_at,last_error,alerted_at,manual_at) ON payment_jobs TO ` + r,
		`GRANT UPDATE(request_count) ON cloud_access TO ` + r,
		`REVOKE INSERT,UPDATE ON credit_limits FROM ` + r,
		`REVOKE INSERT ON cloud_access FROM ` + r,
		`REVOKE UPDATE(request_limit,expires_at,version) ON cloud_access FROM ` + r,
		`GRANT EXECUTE ON FUNCTION activate_paid_limits(text) TO ` + r,
		`GRANT EXECUTE ON FUNCTION activate_test_payment(text) TO ` + r,
		`GRANT UPDATE(status,version,last_totp_step) ON accounts TO ` + r,
		`GRANT INSERT ON workspace_operations TO ` + r,
		`GRANT DELETE ON email_challenges,notification_outbox TO ` + r,
		`GRANT INSERT ON email_challenges,notification_outbox,support_tickets,support_events,support_attachments,procurement_statement_lines,lifecycle_alerts,worker_heartbeats,beta_enrollments TO ` + r,
		`GRANT UPDATE(state,version) ON support_tickets TO ` + r,
		`GRANT UPDATE(state,attempts,available_at,completed_at) ON notification_outbox TO ` + r,
		`GRANT UPDATE(state,actor_id,reason,acknowledged_at) ON lifecycle_alerts TO ` + r,
		`GRANT UPDATE(touched_at) ON worker_heartbeats TO ` + r,
		`GRANT UPDATE(state,actor_id,reason,version) ON beta_enrollments TO ` + r,
		`GRANT INSERT ON mx_point_orders,mx_point_batches,mx_point_reservations,mx_point_allocations,mx_point_refunds,mx_point_evidence,mx_point_ledger,mx_point_jobs,mx_priced_reservations TO ` + r,
		`GRANT UPDATE(state,checkout_state,code_url,close_requested,transaction_id,paid_at,version) ON mx_point_orders TO ` + r,
		`GRANT UPDATE(held,consumed,frozen,returned) ON mx_point_batches TO ` + r,
		`GRANT UPDATE(state,charged,settled_at) ON mx_point_reservations TO ` + r,
		`GRANT UPDATE(approval,execution,provider_refund_id,executed_at,version) ON mx_point_refunds TO ` + r,
		`GRANT UPDATE(state,attempts,available_at,last_error) ON mx_point_jobs TO ` + r,
		`GRANT UPDATE(usage,usage_evidence_ref,tier_id,purchase_estimate_microfen,supplier_bill_microfen,supplier_bill_ref,cost_state) ON mx_priced_reservations TO ` + r,
		`GRANT INSERT ON billing_admin_actions TO ` + r,
		`GRANT INSERT ON mx_cloud_models TO ` + r,
		`GRANT UPDATE(display_name,provider,supplier_model,proxy_alias,api_base,protocol,credential_env,status,capability_evidence,pricing,pricing_source,purchase_version_id,fx_version_id,retail_version_id,route_version,canary_account,version,updated_at) ON mx_cloud_models TO ` + r,
		`GRANT INSERT ON mx_purchase_price_versions,mx_fx_versions,mx_retail_price_versions TO ` + r,
		`GRANT INSERT ON billing_staff_roles TO ` + r,
		`GRANT UPDATE(revoked_at,granted_by,granted_at,version) ON billing_staff_roles TO ` + r,
		`GRANT EXECUTE ON FUNCTION consume_email_challenge(text,text,text) TO ` + r,
		`GRANT INSERT(id,manifest,state) ON release_registry TO ` + r,
		`GRANT UPDATE(cloud_paused,sales_paused,announcement_zh,announcement_en,version) ON operations_controls TO ` + r,
		`GRANT UPDATE(state,version,verified_at) ON release_registry TO ` + r,
		`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA mx_identity TO ` + r,
	} {
		if _, e = tx.Exec(ctx, sql); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}

// Restore can roll back revocations; invalidate all restored sessions before reopening.
func InvalidateSessions(ctx context.Context, pool *pgxpool.Pool) error {
	tx, e := pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `UPDATE sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp())`); e != nil {
		return e
	}
	if e = audit(ctx, tx, nil, "recovery.invalidate_sessions", "all", "succeeded", "deployment recovery"); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

// Admin MFA/password recovery is a host-side operation; it revokes all old sessions.
func (s *Service) ResetAdmin(ctx context.Context, email, password, secret string) error {
	hash, e := passwordHash(password)
	if e != nil {
		return e
	}
	if _, e = TOTP(secret, s.now().Unix()/30); e != nil {
		return ErrValidation
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var id string
	if e = tx.QueryRow(ctx, `SELECT id FROM accounts WHERE email=$1 AND role='admin' FOR UPDATE`, strings.ToLower(strings.TrimSpace(email))).Scan(&id); e != nil {
		return ErrNotFound
	}
	encrypted, e := encryptSecret(s.key, id, secret)
	if e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `UPDATE accounts SET password_hash=$2,mfa_cipher=$3,last_totp_step=-1,version=version+1 WHERE id=$1`, id, hash, encrypted); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `UPDATE sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE account_id=$1`, id, s.now()); e != nil {
		return e
	}
	if e = audit(ctx, tx, nil, "recovery.admin_credentials", id, "succeeded", "deployment recovery"); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
