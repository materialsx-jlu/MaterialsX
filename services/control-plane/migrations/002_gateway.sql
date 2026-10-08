CREATE TABLE cloud_access (
 account_id text PRIMARY KEY REFERENCES accounts, expires_at timestamptz NOT NULL,
 request_limit integer NOT NULL CHECK(request_limit BETWEEN 1 AND 10000),
 request_count integer NOT NULL DEFAULT 0 CHECK(request_count>=0),
 version bigint NOT NULL DEFAULT 1
);
CREATE TABLE research_tasks (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts, client_task_id text NOT NULL,
 model_id text NOT NULL, operation_key text NOT NULL, fingerprint text NOT NULL,
 max_requests integer NOT NULL CHECK(max_requests BETWEEN 1 AND 16),
 max_output_tokens integer NOT NULL CHECK(max_output_tokens BETWEEN 1 AND 4096),
 max_duration_seconds integer NOT NULL CHECK(max_duration_seconds BETWEEN 1 AND 600),
 consent jsonb NOT NULL, request_count integer NOT NULL DEFAULT 0,
 state text NOT NULL CHECK(state IN ('created','running','completed','cancelled','interrupted','failed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), deadline timestamptz NOT NULL,
 UNIQUE(account_id,operation_key), UNIQUE(account_id,client_task_id)
);
CREATE TABLE gateway_requests (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES research_tasks, account_id text NOT NULL REFERENCES accounts,
 session_id text NOT NULL REFERENCES sessions, operation_key text NOT NULL, fingerprint text NOT NULL,
 route_version text NOT NULL, execution text NOT NULL CHECK(execution IN ('running','completed','failed','cancel_requested','cancelled','unknown')),
 settlement text NOT NULL CHECK(settlement IN ('not_billed','reconciliation_pending')),
 dispatched boolean NOT NULL DEFAULT false, terminal_received boolean NOT NULL DEFAULT false,
 usage jsonb, error_code text, upstream_status integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), deadline timestamptz NOT NULL, finished_at timestamptz,
 UNIQUE(account_id,operation_key)
);
CREATE UNIQUE INDEX gateway_one_active_per_account ON gateway_requests(account_id) WHERE execution IN ('running','cancel_requested');
CREATE INDEX gateway_task_requests ON gateway_requests(task_id,created_at);
