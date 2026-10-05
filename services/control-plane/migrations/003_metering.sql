CREATE TABLE sales_price_versions (
 id text PRIMARY KEY, body jsonb NOT NULL, fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE purchase_price_versions (
 id text PRIMARY KEY, body jsonb NOT NULL, fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER sales_prices_immutable BEFORE UPDATE OR DELETE ON sales_price_versions FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER purchase_prices_immutable BEFORE UPDATE OR DELETE ON purchase_price_versions FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE credit_limits (
 account_id text PRIMARY KEY REFERENCES accounts,
 daily_limit bigint NOT NULL CHECK(daily_limit>0), monthly_limit bigint NOT NULL CHECK(monthly_limit>=daily_limit)
);
CREATE TABLE credit_grants (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts,
 source text NOT NULL CHECK(source IN ('trial','subscription','pack')),
 event_id text NOT NULL UNIQUE, fingerprint text NOT NULL,
 credits bigint NOT NULL CHECK(credits>0), consumed bigint NOT NULL DEFAULT 0 CHECK(consumed>=0),
 held bigint NOT NULL DEFAULT 0 CHECK(held>=0), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(consumed+held<=credits)
);
ALTER TABLE research_tasks ADD COLUMN sales_price_version_id text REFERENCES sales_price_versions;
ALTER TABLE research_tasks ADD COLUMN purchase_price_version_id text REFERENCES purchase_price_versions;
ALTER TABLE research_tasks ADD COLUMN max_credits bigint CHECK(max_credits>0);
ALTER TABLE gateway_requests ADD COLUMN phase text NOT NULL DEFAULT 'conversation' CHECK(phase IN ('conversation','extraction','repair','metadata'));
ALTER TABLE gateway_requests DROP CONSTRAINT gateway_requests_settlement_check;
ALTER TABLE gateway_requests ADD CONSTRAINT gateway_requests_settlement_check CHECK(settlement IN ('not_billed','reserved','settled','released','reconciliation_pending'));
CREATE TABLE credit_reservations (
 request_id text PRIMARY KEY REFERENCES gateway_requests, account_id text NOT NULL REFERENCES accounts,
 task_id text NOT NULL REFERENCES research_tasks, sales_price_version_id text NOT NULL REFERENCES sales_price_versions,
 purchase_price_version_id text REFERENCES purchase_price_versions,
 reserved bigint NOT NULL CHECK(reserved>0), charged bigint CHECK(charged>=0 AND charged<=reserved),
 status text NOT NULL CHECK(status IN ('reserved','reconciliation_pending','settled','released')),
 input_bound bigint NOT NULL CHECK(input_bound>0), output_bound integer NOT NULL CHECK(output_bound>0),
 usage_fingerprint text, version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE reservation_allocations (
 request_id text NOT NULL REFERENCES credit_reservations, grant_id text NOT NULL REFERENCES credit_grants,
 credits bigint NOT NULL CHECK(credits>0), charged bigint NOT NULL DEFAULT 0 CHECK(charged>=0 AND charged<=credits),
 PRIMARY KEY(request_id,grant_id)
);
CREATE TABLE credit_ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id text NOT NULL REFERENCES accounts,
 grant_id text NOT NULL REFERENCES credit_grants, request_id text REFERENCES credit_reservations,
 event_id text NOT NULL UNIQUE, kind text NOT NULL CHECK(kind IN ('grant','reserve','settle','release','pending','waiver')),
 granted_delta bigint NOT NULL DEFAULT 0, held_delta bigint NOT NULL DEFAULT 0, consumed_delta bigint NOT NULL DEFAULT 0,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER credit_ledger_immutable BEFORE UPDATE OR DELETE ON credit_ledger FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE billing_jobs (
 request_id text PRIMARY KEY REFERENCES credit_reservations,
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','pending','manual','completed')),
 reason text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 alerted_at timestamptz, manual_at timestamptz
);
CREATE TABLE reconciliation_evidence (
 request_id text PRIMARY KEY REFERENCES credit_reservations, fingerprint text NOT NULL,
 resolution text NOT NULL, source_ref text NOT NULL, reason text NOT NULL,
 actor_id text REFERENCES accounts, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER reconciliation_evidence_immutable BEFORE UPDATE OR DELETE ON reconciliation_evidence FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE procurement_costs (
 request_id text PRIMARY KEY REFERENCES credit_reservations,
 purchase_price_version_id text REFERENCES purchase_price_versions,
 cost_fen bigint CHECK(cost_fen>=0), state text NOT NULL CHECK(state IN ('unknown','verified'))
);
CREATE INDEX metering_account_grants ON credit_grants(account_id,expires_at);
CREATE INDEX metering_task_reservations ON credit_reservations(task_id);
CREATE INDEX billing_due_jobs ON billing_jobs(available_at) WHERE status IN ('scheduled','pending');
