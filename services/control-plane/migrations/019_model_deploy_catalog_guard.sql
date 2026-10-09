-- Serialize edits with deployment submission. A queued or unknown deployment
-- freezes the published catalog until its proxy outcome has been checked.
CREATE FUNCTION guard_model_deploy_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(NEW)-'deployed_version'=to_jsonb(OLD)-'deployed_version' THEN
   RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(21770619088814412);
 IF EXISTS(SELECT 1 FROM mx_model_deploy_jobs WHERE state IN ('queued','running','uncertain')) THEN
   RAISE EXCEPTION 'model deployment pending reconciliation' USING ERRCODE='MX001';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mx_cloud_models_deploy_guard
 BEFORE INSERT OR UPDATE OR DELETE ON mx_cloud_models
 FOR EACH ROW EXECUTE FUNCTION guard_model_deploy_catalog();
