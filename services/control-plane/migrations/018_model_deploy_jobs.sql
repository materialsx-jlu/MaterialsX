-- Deployment is a durable server operation; a model's catalog status is not a proxy receipt.
ALTER TABLE mx_cloud_models ADD COLUMN deployed_version bigint;

CREATE TABLE mx_model_deploy_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id text NOT NULL REFERENCES accounts(id),
 idempotency_key text NOT NULL,
 expected_revision text NOT NULL CHECK (expected_revision ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','succeeded','failed','uncertain')),
 receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz,
 finished_at timestamptz,
 UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX mx_model_deploy_jobs_queue ON mx_model_deploy_jobs(state,created_at,id);
CREATE UNIQUE INDEX mx_model_deploy_jobs_inflight ON mx_model_deploy_jobs(expected_revision) WHERE state IN ('queued','running');
