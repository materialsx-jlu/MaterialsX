-- Commercial domain stays distinct from M3 JSON and from procurement accounting.
CREATE TABLE payment_products (
 id text PRIMARY KEY, body jsonb NOT NULL, fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER payment_products_immutable BEFORE UPDATE OR DELETE ON payment_products FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
ALTER TABLE credit_grants ADD COLUMN available_at timestamptz NOT NULL DEFAULT '-infinity';
ALTER TABLE credit_grants ADD COLUMN refund_frozen bigint NOT NULL DEFAULT 0 CHECK(refund_frozen>=0);
ALTER TABLE credit_grants ADD COLUMN returned bigint NOT NULL DEFAULT 0 CHECK(returned>=0);
ALTER TABLE credit_grants ADD CONSTRAINT credit_grants_refund_balance CHECK(consumed+held+refund_frozen+returned<=credits);
ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_kind_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check CHECK(kind IN ('grant','reserve','settle','release','pending','waiver','refund_freeze','refund_release','refund'));
ALTER TABLE credit_ledger ADD COLUMN frozen_delta bigint NOT NULL DEFAULT 0;
ALTER TABLE credit_ledger ADD COLUMN returned_delta bigint NOT NULL DEFAULT 0;
CREATE TABLE payment_orders (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts,
 idempotency_key text NOT NULL, fingerprint text NOT NULL, product_id text NOT NULL REFERENCES payment_products,
 snapshot jsonb NOT NULL, amount_fen bigint NOT NULL CHECK(amount_fen>0), currency text NOT NULL CHECK(currency='CNY'),
 test_only boolean NOT NULL, channel text NOT NULL CHECK(channel IN ('test','wechat')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','paid','closed','refund_pending','partially_refunded','refunded')),
 checkout_state text NOT NULL DEFAULT 'not_started' CHECK(checkout_state IN ('not_started','submitting','ready','unknown')),
 close_requested boolean NOT NULL DEFAULT false, code_url text, transaction_id text UNIQUE, paid_at timestamptz, grant_id text UNIQUE REFERENCES credit_grants,
 refunded_fen bigint NOT NULL DEFAULT 0 CHECK(refunded_fen>=0 AND refunded_fen<=amount_fen),
 version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 UNIQUE(account_id,idempotency_key)
);
CREATE TABLE subscription_periods (
 order_id text PRIMARY KEY REFERENCES payment_orders, account_id text NOT NULL REFERENCES accounts,
 product_id text NOT NULL REFERENCES payment_products, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 anchor_day integer NOT NULL CHECK(anchor_day BETWEEN 1 AND 31), state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','canceled')),
 CHECK(ends_at>starts_at)
);
CREATE TABLE payment_refunds (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES payment_orders, account_id text NOT NULL REFERENCES accounts,
 idempotency_key text NOT NULL, fingerprint text NOT NULL, amount_fen bigint NOT NULL CHECK(amount_fen>0),
 reason text NOT NULL, approval text NOT NULL DEFAULT 'requested' CHECK(approval IN ('requested','reviewing','approved','rejected','canceled')),
 execution text NOT NULL DEFAULT 'not_started' CHECK(execution IN ('not_started','submitting','pending','succeeded','failed')),
 frozen_credits bigint NOT NULL DEFAULT 0 CHECK(frozen_credits>=0), provider_refund_id text UNIQUE,
 version bigint NOT NULL DEFAULT 1, decision_reason text, actor_id text REFERENCES accounts,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(account_id,idempotency_key)
);
CREATE UNIQUE INDEX one_inflight_refund ON payment_refunds(order_id) WHERE approval='approved' AND execution IN ('not_started','submitting','pending');
CREATE TABLE payment_evidence (
 id text PRIMARY KEY, fingerprint text NOT NULL, order_id text NOT NULL REFERENCES payment_orders,
 refund_id text REFERENCES payment_refunds, source text NOT NULL CHECK(source IN ('query','notification','test')),
 body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER payment_evidence_immutable BEFORE UPDATE OR DELETE ON payment_evidence FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE payment_jobs (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES payment_orders, refund_id text REFERENCES payment_refunds,
 kind text NOT NULL CHECK(kind IN ('order','refund')), state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','manual','completed')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), alerted_at timestamptz,manual_at timestamptz,last_error text NOT NULL DEFAULT ''
);
CREATE INDEX payment_order_owner ON payment_orders(account_id,created_at,id);
CREATE INDEX payment_jobs_due ON payment_jobs(available_at) WHERE state='pending';
CREATE INDEX subscription_owner ON subscription_periods(account_id,ends_at);
-- Runtime may activate an already verified paid order, but cannot directly expand alpha
-- grants or daily/monthly policy. Restricted SECURITY DEFINER has an immutable one-shot receipt.
CREATE TABLE payment_activations(order_id text PRIMARY KEY REFERENCES payment_orders,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER payment_activations_immutable BEFORE UPDATE OR DELETE ON payment_activations FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE FUNCTION activate_test_payment(order_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=mx_identity,pg_catalog AS $$
DECLARE o payment_orders; g credit_grants; d bigint; m bigint; cap integer;
BEGIN
 SELECT * INTO STRICT o FROM payment_orders WHERE id=order_key AND state='paid' AND test_only AND channel='test' AND paid_at IS NOT NULL;
 SELECT * INTO STRICT g FROM credit_grants WHERE id=o.grant_id AND account_id=o.account_id AND event_id='paid:'||o.id;
 IF NOT EXISTS(SELECT 1 FROM payment_evidence WHERE order_id=o.id AND refund_id IS NULL AND source='test' AND body->>'state'='SUCCESS' AND body->>'transactionId'=o.transaction_id AND (body->>'total')::bigint=o.amount_fen) THEN RAISE EXCEPTION 'verified evidence required'; END IF;
 INSERT INTO payment_activations(order_id) VALUES(o.id) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN; END IF;
 d:=(o.snapshot->>'dailyLimit')::bigint;m:=(o.snapshot->>'monthlyLimit')::bigint;cap:=(o.snapshot->>'requestLimit')::integer;
 IF d<1 OR m<d OR m>1000000000 OR cap<1 OR cap>10000 THEN RAISE EXCEPTION 'invalid test limits'; END IF;
 INSERT INTO credit_limits(account_id,daily_limit,monthly_limit) VALUES(o.account_id,d,m) ON CONFLICT(account_id) DO UPDATE SET daily_limit=GREATEST(credit_limits.daily_limit,EXCLUDED.daily_limit),monthly_limit=GREATEST(credit_limits.monthly_limit,EXCLUDED.monthly_limit);
 INSERT INTO cloud_access(account_id,expires_at,request_limit) VALUES(o.account_id,g.expires_at,cap) ON CONFLICT(account_id) DO UPDATE SET expires_at=GREATEST(cloud_access.expires_at,EXCLUDED.expires_at),request_limit=LEAST(10000,GREATEST(cloud_access.request_count,cloud_access.request_limit)+EXCLUDED.request_limit),version=cloud_access.version+1;
END; $$;
REVOKE ALL ON FUNCTION activate_test_payment(text) FROM PUBLIC;
