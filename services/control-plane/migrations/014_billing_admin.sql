-- Separate named billing staff from the singleton operations administrator.
ALTER TABLE mx_point_refunds ADD COLUMN executed_at timestamptz;
UPDATE mx_point_refunds SET executed_at=created_at WHERE execution='succeeded';
ALTER TABLE mx_point_reservations ADD COLUMN settled_at timestamptz;
UPDATE mx_point_reservations SET settled_at=created_at WHERE state IN ('settled','released');
CREATE OR REPLACE VIEW mx_pricing_anomalies AS
 SELECT p.request_id,p.account_id,p.model_id,p.route_version,p.retail_version_id,
        p.purchase_version_id,p.fx_version_id,r.state AS reservation_state,
        p.cost_state,p.usage_evidence_ref,p.supplier_bill_ref,
        CASE WHEN r.state='reconciliation_pending' THEN 'usage_pending'
             WHEN p.cost_state='disputed' THEN 'supplier_difference'
             ELSE 'cost_unknown' END AS reason,
        p.created_at
 FROM mx_priced_reservations p JOIN mx_point_reservations r ON r.id=p.request_id
 WHERE r.state='reconciliation_pending' OR p.cost_state='disputed'
    OR (r.state='settled' AND p.cost_state IN ('unknown','estimated'));
ALTER TABLE accounts DROP CONSTRAINT accounts_role_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_role_check CHECK(role IN ('user','admin','billing_staff'));
ALTER TABLE accounts DROP CONSTRAINT accounts_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_check CHECK(role NOT IN ('admin','billing_staff') OR mfa_cipher IS NOT NULL);

CREATE TABLE billing_staff_roles (
 account_id text NOT NULL REFERENCES accounts,
 role text NOT NULL CHECK(role IN ('billing.viewer','billing.operator','billing.finance','billing.pricing','billing.admin')),
 granted_by text REFERENCES accounts,
 granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(account_id,role)
);
CREATE INDEX billing_staff_roles_active ON billing_staff_roles(account_id) WHERE revoked_at IS NULL;
INSERT INTO billing_staff_roles(account_id,role)
 SELECT id,'billing.admin' FROM accounts WHERE role='admin';

CREATE TABLE billing_admin_actions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id text NOT NULL REFERENCES accounts,
 action text NOT NULL,
 target_id text NOT NULL,
 idempotency_key text NOT NULL,
 fingerprint text NOT NULL,
 result jsonb NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,action,idempotency_key)
);
CREATE TRIGGER billing_admin_actions_immutable BEFORE UPDATE OR DELETE ON billing_admin_actions
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
