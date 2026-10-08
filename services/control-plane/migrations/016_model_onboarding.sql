-- A model is not billable merely because it appears in LiteLLM. The registry
-- holds the approved deployment and immutable price IDs used by the gateway.
CREATE TABLE mx_cloud_models (
 id text PRIMARY KEY,
 display_name text NOT NULL,
 provider text NOT NULL,
 supplier_model text NOT NULL,
 proxy_alias text NOT NULL UNIQUE,
 api_base text NOT NULL,
 protocol text NOT NULL CHECK(protocol IN ('responses','chat-completions')),
 credential_env text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','proxy_ready','probe_unconfirmed','capability_verified','pricing_review','canary','active','disabled','adapter_required')),
 capability_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
 pricing_source text NOT NULL DEFAULT '',
 purchase_version_id text,
 fx_version_id text,
 retail_version_id text,
 route_version text,
 canary_account text REFERENCES accounts(id),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_by text NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((status IN ('canary','active') AND purchase_version_id IS NOT NULL AND fx_version_id IS NOT NULL AND retail_version_id IS NOT NULL AND route_version IS NOT NULL) OR status NOT IN ('canary','active')),
 CHECK (status <> 'canary' OR canary_account IS NOT NULL)
);
CREATE INDEX mx_cloud_models_status ON mx_cloud_models(status,id);
-- Existing reservations and signed price snapshots stay untouched.
ALTER TABLE mx_priced_reservations DROP CONSTRAINT mx_priced_reservations_model_id_check;
