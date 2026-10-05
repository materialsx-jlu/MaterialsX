ALTER TABLE gateway_requests ADD COLUMN counted_input_tokens bigint CHECK(counted_input_tokens>=0);
ALTER TABLE gateway_requests ADD COLUMN input_count_evidence text;
-- Payment-backed limits only; the runtime cannot manufacture policy/credits.
CREATE FUNCTION activate_paid_limits(oid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=mx_identity,pg_temp AS $$
DECLARE o payment_orders; daily bigint; monthly bigint;
BEGIN
 SELECT * INTO o FROM payment_orders WHERE id=oid FOR UPDATE;
 IF NOT FOUND OR o.channel<>'wechat' OR o.state<>'paid' OR o.snapshot->>'refundRule'<>'unused-full-v1'
  OR NOT EXISTS(SELECT 1 FROM credit_grants WHERE id=o.grant_id AND unit='paid-credit' AND account_id=o.account_id)
  OR NOT EXISTS(SELECT 1 FROM payment_evidence WHERE order_id=oid AND refund_id IS NULL AND source IN ('query','notification') AND body->>'state'='SUCCESS' AND body->>'transactionId'=o.transaction_id AND (body->>'total')::bigint=o.amount_fen)
  OR NOT EXISTS(SELECT 1 FROM payment_products WHERE id=o.product_id AND body=o.snapshot) THEN
  RAISE EXCEPTION 'verified paid activation required';
 END IF;
 daily:=(o.snapshot->>'dailyLimit')::bigint;monthly:=(o.snapshot->>'monthlyLimit')::bigint;
 IF daily<1 OR monthly<daily OR monthly>1000000000 THEN RAISE EXCEPTION 'invalid paid limits'; END IF;
 INSERT INTO paid_credit_limits(account_id,daily_subunits,monthly_subunits) VALUES(o.account_id,daily*10000,monthly*10000)
 ON CONFLICT(account_id) DO UPDATE SET daily_subunits=GREATEST(paid_credit_limits.daily_subunits,EXCLUDED.daily_subunits),monthly_subunits=GREATEST(paid_credit_limits.monthly_subunits,EXCLUDED.monthly_subunits);
END $$;
REVOKE ALL ON FUNCTION activate_paid_limits(text) FROM PUBLIC;
