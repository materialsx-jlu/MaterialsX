-- Additive lifecycle features; never rewrite pilot order or ledger snapshots.
CREATE TABLE email_challenges (
 token_hash text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('register','reset')),
 email text NOT NULL, display_name text NOT NULL DEFAULT '', password_hash text,
 terms_version text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX email_challenges_expiry ON email_challenges(expires_at);
CREATE FUNCTION consume_email_challenge(token text, new_password text, new_id text) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=mx_identity,pg_temp AS $$
DECLARE c email_challenges; uid text;
BEGIN
 SELECT * INTO c FROM email_challenges WHERE token_hash=token FOR UPDATE;
 IF NOT FOUND OR c.consumed_at IS NOT NULL OR c.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 IF c.kind='register' THEN
  IF c.password_hash IS NULL OR c.password_hash NOT LIKE '$argon2id$%' THEN RETURN NULL; END IF;
  INSERT INTO accounts(id,email,display_name,password_hash,role) VALUES(new_id,c.email,c.display_name,c.password_hash,'user') ON CONFLICT(email) DO NOTHING RETURNING id INTO uid;
 ELSE
  IF new_password IS NULL OR new_password NOT LIKE '$argon2id$%' THEN RETURN NULL; END IF;
  UPDATE accounts SET password_hash=new_password,version=version+1 WHERE email=c.email AND role='user' AND status='active' RETURNING id INTO uid;
  IF uid IS NOT NULL THEN
   UPDATE sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE account_id=uid;
   UPDATE devices SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE account_id=uid;
  END IF;
 END IF;
 UPDATE email_challenges SET consumed_at=clock_timestamp(),password_hash=NULL WHERE email=c.email AND consumed_at IS NULL;
 IF uid IS NOT NULL THEN INSERT INTO audit_events(actor_id,action,target_id,result,reason) VALUES(uid,'account.email_'||c.kind,uid,'succeeded',c.terms_version); END IF;
 RETURN uid;
END $$;
REVOKE ALL ON FUNCTION consume_email_challenge(text,text,text) FROM PUBLIC;

CREATE TABLE notification_outbox (
 id text PRIMARY KEY, event_key text NOT NULL UNIQUE, payload bytea NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','manual','expired')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz
);
CREATE TABLE support_tickets (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts,
 idempotency_key text NOT NULL, fingerprint text NOT NULL,
 subject text NOT NULL, category text NOT NULL CHECK(category IN ('account','payment','usage','research','other')),
 reference_id text NOT NULL DEFAULT '', state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','waiting_user','resolved','closed')),
 version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,idempotency_key)
);
CREATE TABLE support_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ticket_id text NOT NULL REFERENCES support_tickets,
 actor_id text NOT NULL REFERENCES accounts, operation_key text NOT NULL, fingerprint text NOT NULL,
 body text NOT NULL, state text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(ticket_id,operation_key)
);
CREATE TRIGGER support_events_immutable BEFORE UPDATE OR DELETE ON support_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
-- Attachments are explicitly opted in, bounded plain text, encrypted at rest. No automatic log or PDF upload.
CREATE TABLE support_attachments (
 id text PRIMARY KEY, ticket_id text NOT NULL REFERENCES support_tickets,
 actor_id text NOT NULL REFERENCES accounts, name text NOT NULL, payload bytea NOT NULL,
 sha256 text NOT NULL, consent_version text NOT NULL CHECK(consent_version='support-text-v1'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(ticket_id,sha256)
);
CREATE TABLE procurement_statement_lines (
 request_id text PRIMARY KEY REFERENCES credit_reservations, route_version_id text NOT NULL,
 source_ref text NOT NULL, source_sha256 text NOT NULL, cost_microfen bigint NOT NULL CHECK(cost_microfen>=0),
 fingerprint text NOT NULL, actor_id text NOT NULL REFERENCES accounts,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER procurement_lines_immutable BEFORE UPDATE OR DELETE ON procurement_statement_lines FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE lifecycle_alerts (
 id text PRIMARY KEY, kind text NOT NULL, target_id text NOT NULL, state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','acknowledged')),
 actor_id text REFERENCES accounts, reason text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), acknowledged_at timestamptz
);
CREATE TABLE worker_heartbeats (name text PRIMARY KEY, touched_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE beta_enrollments (
 account_id text PRIMARY KEY REFERENCES accounts, state text NOT NULL CHECK(state IN ('active','revoked')),
 actor_id text NOT NULL REFERENCES accounts, reason text NOT NULL, version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
