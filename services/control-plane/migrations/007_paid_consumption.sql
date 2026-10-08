-- Preserve every historical whole-credit grant and immutable ledger entry.
-- Fractional consumption is an additive overlay; one credit = 10000 subunits.
ALTER TABLE credit_grants ADD COLUMN paid_held_subunits bigint NOT NULL DEFAULT 0 CHECK(paid_held_subunits>=0);
ALTER TABLE credit_grants ADD COLUMN paid_consumed_subunits bigint NOT NULL DEFAULT 0 CHECK(paid_consumed_subunits>=0);
ALTER TABLE credit_grants ADD CONSTRAINT paid_balance_conservation CHECK(
 (unit='paid-credit' OR (paid_held_subunits=0 AND paid_consumed_subunits=0)) AND
 (consumed::numeric+held+refund_frozen+returned)*10000+paid_held_subunits+paid_consumed_subunits<=credits::numeric*10000);
ALTER TABLE credit_ledger ADD COLUMN precision integer NOT NULL DEFAULT 1 CHECK(precision IN (1,10000));
ALTER TABLE credit_reservations ADD COLUMN precision integer NOT NULL DEFAULT 1 CHECK(precision IN (1,10000));
ALTER TABLE research_tasks ADD COLUMN credit_precision integer NOT NULL DEFAULT 1 CHECK(credit_precision IN (1,10000));
CREATE TABLE paid_credit_limits (
 account_id text PRIMARY KEY REFERENCES accounts,
 daily_subunits bigint NOT NULL CHECK(daily_subunits>0),
 monthly_subunits bigint NOT NULL CHECK(monthly_subunits>=daily_subunits)
);
-- Limits are deployment policy, not credits or proof of payment.
INSERT INTO paid_credit_limits(account_id,daily_subunits,monthly_subunits)
 SELECT DISTINCT account_id,10000000,10000000 FROM credit_grants WHERE unit='paid-credit';
CREATE FUNCTION enforce_credit_precision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.precision=10000 AND ((SELECT unit FROM credit_grants WHERE id=NEW.grant_id)<>'paid-credit' OR NEW.granted_delta<>0 OR NEW.frozen_delta<>0 OR NEW.returned_delta<>0) THEN
  RAISE EXCEPTION 'invalid fractional ledger denomination';
 END IF;
 IF NEW.request_id IS NOT NULL AND NEW.precision<>(SELECT precision FROM credit_reservations WHERE request_id=NEW.request_id) THEN
  RAISE EXCEPTION 'reservation ledger denomination mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_precision_guard BEFORE INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION enforce_credit_precision();
