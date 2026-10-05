CREATE TABLE accounts (
 id text PRIMARY KEY, email text NOT NULL UNIQUE, display_name text NOT NULL,
 password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('user','admin')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
 version bigint NOT NULL DEFAULT 1 CHECK (version>0),
 mfa_cipher bytea, last_totp_step bigint NOT NULL DEFAULT -1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (role <> 'admin' OR mfa_cipher IS NOT NULL)
);
CREATE TABLE auth_flows (
 id text PRIMARY KEY, state text NOT NULL, challenge text NOT NULL, redirect_uri text NOT NULL,
 device_name text NOT NULL, nonce_hash text, code_hash text UNIQUE, account_id text REFERENCES accounts,
 mfa_verified boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL, approved_at timestamptz, consumed_at timestamptz
);
CREATE TABLE devices (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts, name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz
);
CREATE INDEX devices_account ON devices(account_id);
CREATE TABLE sessions (
 id text PRIMARY KEY, device_id text NOT NULL REFERENCES devices, account_id text NOT NULL REFERENCES accounts,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, mfa_verified_at timestamptz
);
CREATE TABLE access_tokens (
 token_hash text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions, expires_at timestamptz NOT NULL
);
CREATE TABLE refresh_tokens (
 token_hash text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions, expires_at timestamptz NOT NULL,
 used_at timestamptz
);
CREATE INDEX access_session ON access_tokens(session_id);
CREATE INDEX refresh_session ON refresh_tokens(session_id);
CREATE TABLE rate_limits (
 key_hash text PRIMARY KEY, window_start timestamptz NOT NULL, attempts integer NOT NULL
);
CREATE TABLE admin_operations (
 actor_id text NOT NULL REFERENCES accounts, operation_key text NOT NULL,
 fingerprint text NOT NULL, result_status text NOT NULL, result_version bigint NOT NULL, PRIMARY KEY (actor_id, operation_key)
);
CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id text REFERENCES accounts,
 action text NOT NULL, target_id text, result text NOT NULL, reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_created ON audit_events(id DESC);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit events are append only'; END; $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
