-- 0.3 MX points are a separate unit. One point is 1,000,000 subunits.
-- Historic paid-credit orders, grants and prices are deliberately untouched.
CREATE TABLE mx_point_products (
 id text PRIMARY KEY, name text NOT NULL, amount_fen bigint NOT NULL,
 points_subunits bigint NOT NULL, policy_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(amount_fen IN (1000,5000,10000,50000)),
 CHECK(points_subunits=amount_fen*100000),
 CHECK(policy_version='mx-unused-full-v1')
);
CREATE TRIGGER mx_point_products_immutable BEFORE UPDATE OR DELETE ON mx_point_products
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
INSERT INTO mx_point_products(id,name,amount_fen,points_subunits,policy_version) VALUES
 ('mx-cny-10-v1','MX 点 100',1000,100000000,'mx-unused-full-v1'),
 ('mx-cny-50-v1','MX 点 500',5000,500000000,'mx-unused-full-v1'),
 ('mx-cny-100-v1','MX 点 1000',10000,1000000000,'mx-unused-full-v1'),
 ('mx-cny-500-v1','MX 点 5000',50000,5000000000,'mx-unused-full-v1');

CREATE TABLE mx_point_orders (
 id text PRIMARY KEY CHECK(id LIKE 'mx%'), account_id text NOT NULL REFERENCES accounts,
 idempotency_key text NOT NULL, fingerprint text NOT NULL,
 product_id text NOT NULL REFERENCES mx_point_products,
 amount_fen bigint NOT NULL CHECK(amount_fen IN (1000,5000,10000,50000)),
 points_subunits bigint NOT NULL CHECK(points_subunits=amount_fen*100000),
 channel text NOT NULL CHECK(channel IN ('test','wechat')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','paid','closed','refund_pending','refunded')),
 checkout_state text NOT NULL DEFAULT 'not_started' CHECK(checkout_state IN ('not_started','submitting','ready','unknown')),
 code_url text, close_requested boolean NOT NULL DEFAULT false,
 transaction_id text UNIQUE, paid_at timestamptz,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 UNIQUE(account_id,idempotency_key)
);
CREATE INDEX mx_point_orders_owner ON mx_point_orders(account_id,created_at DESC,id DESC);
CREATE TABLE mx_point_batches (
 order_id text PRIMARY KEY REFERENCES mx_point_orders, account_id text NOT NULL REFERENCES accounts,
 granted bigint NOT NULL CHECK(granted>0), held bigint NOT NULL DEFAULT 0 CHECK(held>=0),
 consumed bigint NOT NULL DEFAULT 0 CHECK(consumed>=0),
 frozen bigint NOT NULL DEFAULT 0 CHECK(frozen>=0),
 returned bigint NOT NULL DEFAULT 0 CHECK(returned>=0),
 CHECK(held+consumed+frozen+returned<=granted)
);
CREATE INDEX mx_point_batches_owner ON mx_point_batches(account_id,order_id);
CREATE TABLE mx_point_reservations (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts,
 reserved bigint NOT NULL CHECK(reserved>0), charged bigint CHECK(charged>=0 AND charged<=reserved),
 state text NOT NULL CHECK(state IN ('reserved','settled','released','reconciliation_pending')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE mx_point_allocations (
 reservation_id text NOT NULL REFERENCES mx_point_reservations,
 order_id text NOT NULL REFERENCES mx_point_batches,
 subunits bigint NOT NULL CHECK(subunits>0),
 PRIMARY KEY(reservation_id,order_id)
);
CREATE TABLE mx_point_refunds (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES mx_point_orders,
 account_id text NOT NULL REFERENCES accounts, idempotency_key text NOT NULL,
 amount_fen bigint NOT NULL CHECK(amount_fen>0), frozen_subunits bigint NOT NULL CHECK(frozen_subunits>0),
 approval text NOT NULL DEFAULT 'requested' CHECK(approval IN ('requested','approved','rejected')),
 execution text NOT NULL DEFAULT 'not_started' CHECK(execution IN ('not_started','submitting','pending','succeeded','failed')),
 provider_refund_id text UNIQUE, version bigint NOT NULL DEFAULT 1,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,idempotency_key)
);
CREATE UNIQUE INDEX mx_point_open_refund ON mx_point_refunds(order_id)
 WHERE approval IN ('requested','approved');
CREATE TABLE mx_point_evidence (
 id text PRIMARY KEY, fingerprint text NOT NULL, order_id text NOT NULL REFERENCES mx_point_orders,
 refund_id text REFERENCES mx_point_refunds,
 source text NOT NULL CHECK(source IN ('query','notification','test')),
 body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER mx_point_evidence_immutable BEFORE UPDATE OR DELETE ON mx_point_evidence
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TABLE mx_point_ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id text NOT NULL REFERENCES accounts, order_id text NOT NULL REFERENCES mx_point_orders,
 reservation_id text REFERENCES mx_point_reservations, refund_id text REFERENCES mx_point_refunds,
 event_id text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN ('grant','reserve','settle','release','refund_freeze','refund_release','refund')),
 granted_delta bigint NOT NULL DEFAULT 0, held_delta bigint NOT NULL DEFAULT 0,
 consumed_delta bigint NOT NULL DEFAULT 0, frozen_delta bigint NOT NULL DEFAULT 0,
 returned_delta bigint NOT NULL DEFAULT 0, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER mx_point_ledger_immutable BEFORE UPDATE OR DELETE ON mx_point_ledger
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE INDEX mx_point_ledger_owner ON mx_point_ledger(account_id,id DESC);
CREATE TABLE mx_point_jobs (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES mx_point_orders,
 refund_id text REFERENCES mx_point_refunds,
 kind text NOT NULL CHECK(kind IN ('order','refund')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','manual','completed')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_error text NOT NULL DEFAULT ''
);
CREATE INDEX mx_point_jobs_due ON mx_point_jobs(available_at) WHERE state='pending';
