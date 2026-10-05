-- Serialize all verification/reset tokens for one email before locking a token.
-- This avoids deadlocks and guarantees that only one of competing links wins.
CREATE OR REPLACE FUNCTION consume_email_challenge(token text, new_password text, new_id text) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=mx_identity,pg_temp AS $$
DECLARE c email_challenges; uid text; address text;
BEGIN
 SELECT email INTO address FROM email_challenges WHERE token_hash=token;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('email-challenge:'||address,0));
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
