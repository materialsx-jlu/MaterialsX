-- Existing synthetic grants keep their original unit. Real payments are never spent
-- by the technical test metering route. Runtime cannot rewrite the denomination.
ALTER TABLE credit_grants ADD COLUMN unit text NOT NULL DEFAULT 'test-credit' CHECK(unit IN ('test-credit','paid-credit'));
CREATE INDEX credit_grants_owner_unit ON credit_grants(account_id,unit,expires_at);
