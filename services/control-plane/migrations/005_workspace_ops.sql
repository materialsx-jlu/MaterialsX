-- M5.5: persisted admission controls and immutable release manifests.
CREATE TABLE operations_controls (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 cloud_paused boolean NOT NULL DEFAULT false,
 sales_paused boolean NOT NULL DEFAULT false,
 announcement_zh text NOT NULL DEFAULT '' CHECK(length(announcement_zh)<=1000),
 announcement_en text NOT NULL DEFAULT '' CHECK(length(announcement_en)<=1000),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0)
);
INSERT INTO operations_controls(id) VALUES(true);
CREATE TABLE workspace_operations (
 actor_id text NOT NULL REFERENCES accounts, operation_key text NOT NULL,
 fingerprint text NOT NULL, response jsonb NOT NULL,
 PRIMARY KEY(actor_id,operation_key)
);
CREATE TRIGGER workspace_operations_immutable BEFORE UPDATE OR DELETE ON workspace_operations FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE release_registry (
 id text PRIMARY KEY, manifest jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('draft','published','withdrawn')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), verified_at timestamptz
);
CREATE FUNCTION require_release_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state<>'draft' OR NEW.version<>1 OR NEW.verified_at IS NOT NULL THEN
 RAISE EXCEPTION 'initial_release_must_be_draft'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER initial_release_draft BEFORE INSERT ON release_registry FOR EACH ROW EXECUTE FUNCTION require_release_draft();
CREATE FUNCTION protect_release_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.id<>NEW.id OR OLD.manifest<>NEW.manifest OR OLD.created_at<>NEW.created_at OR
 NOT ((OLD.state='draft' AND NEW.state='published') OR (OLD.state='published' AND NEW.state='withdrawn')) OR NEW.version<>OLD.version+1 OR NEW.verified_at IS NULL THEN
 RAISE EXCEPTION 'immutable_release'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER release_manifest_immutable BEFORE UPDATE ON release_registry FOR EACH ROW EXECUTE FUNCTION protect_release_manifest();
CREATE TRIGGER release_no_delete BEFORE DELETE ON release_registry FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE INDEX research_tasks_history ON research_tasks(account_id,created_at DESC,id DESC);
