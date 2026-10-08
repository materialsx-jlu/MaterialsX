-- Three independently immutable pricing layers; existing M5 price tables are untouched.
CREATE TABLE mx_purchase_price_versions (
 id text PRIMARY KEY, status text NOT NULL CHECK(status IN ('draft','approved')),
 body jsonb NOT NULL, fingerprint text NOT NULL, source_ref text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE mx_fx_versions (
 id text PRIMARY KEY, status text NOT NULL CHECK(status IN ('draft','approved')),
 body jsonb NOT NULL, fingerprint text NOT NULL, source_ref text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE mx_retail_price_versions (
 id text PRIMARY KEY, status text NOT NULL CHECK(status IN ('draft','approved')),
 body jsonb NOT NULL, fingerprint text NOT NULL, source_ref text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER mx_purchase_prices_immutable BEFORE UPDATE OR DELETE ON mx_purchase_price_versions
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER mx_fx_prices_immutable BEFORE UPDATE OR DELETE ON mx_fx_versions
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER mx_retail_prices_immutable BEFORE UPDATE OR DELETE ON mx_retail_price_versions
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- A reservation records the exact price/route snapshot that will later be used
-- for settlement. Procurement is an estimate until an independent supplier bill.
ALTER TABLE mx_point_reservations ADD CONSTRAINT mx_point_reservation_owner UNIQUE(id,account_id);
ALTER TABLE research_tasks ADD CONSTRAINT mx_priced_task_owner UNIQUE(id,account_id);
CREATE TABLE mx_priced_reservations (
 request_id text PRIMARY KEY,
 account_id text NOT NULL,
 task_id text,
 model_id text NOT NULL CHECK(model_id IN ('gpt-5.6-sol','gpt-6-sol','claude-opus-5-5','claude-fable-5-1')),
 route_version text NOT NULL,
 retail_version_id text NOT NULL REFERENCES mx_retail_price_versions,
 purchase_version_id text NOT NULL REFERENCES mx_purchase_price_versions,
 fx_version_id text NOT NULL REFERENCES mx_fx_versions,
 input_bound bigint NOT NULL CHECK(input_bound>0),
 output_bound bigint NOT NULL CHECK(output_bound>0),
 usage jsonb, usage_evidence_ref text,
 tier_id text,
 purchase_estimate_microfen bigint CHECK(purchase_estimate_microfen>=0),
 supplier_bill_microfen bigint CHECK(supplier_bill_microfen>=0),
 supplier_bill_ref text,
 cost_state text NOT NULL DEFAULT 'unknown' CHECK(cost_state IN ('unknown','estimated','verified','disputed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(request_id,account_id) REFERENCES mx_point_reservations(id,account_id),
 FOREIGN KEY(task_id,account_id) REFERENCES research_tasks(id,account_id),
 CHECK((usage IS NULL AND usage_evidence_ref IS NULL AND tier_id IS NULL)
    OR (usage IS NOT NULL AND usage_evidence_ref IS NOT NULL AND tier_id IS NOT NULL)),
 CHECK((supplier_bill_microfen IS NULL AND supplier_bill_ref IS NULL)
    OR (supplier_bill_microfen IS NOT NULL AND supplier_bill_ref IS NOT NULL)),
 CHECK((cost_state='unknown' AND purchase_estimate_microfen IS NULL)
    OR (cost_state<>'unknown' AND purchase_estimate_microfen IS NOT NULL)),
 CHECK(cost_state NOT IN ('verified','disputed') OR supplier_bill_microfen IS NOT NULL)
);
CREATE INDEX mx_priced_account ON mx_priced_reservations(account_id,created_at DESC,request_id);
CREATE VIEW mx_cost_discrepancies AS
 SELECT request_id,account_id,model_id,route_version,purchase_version_id,fx_version_id,
        purchase_estimate_microfen,supplier_bill_microfen,
        supplier_bill_microfen-purchase_estimate_microfen AS difference_microfen,
        supplier_bill_ref,created_at
 FROM mx_priced_reservations WHERE cost_state='disputed';
CREATE VIEW mx_pricing_anomalies AS
 SELECT p.request_id,p.account_id,p.model_id,p.route_version,p.retail_version_id,
        p.purchase_version_id,p.fx_version_id,r.state AS reservation_state,
        p.cost_state,p.usage_evidence_ref,p.supplier_bill_ref,
        CASE WHEN r.state='reconciliation_pending' THEN 'usage_pending'
             WHEN p.cost_state='disputed' THEN 'supplier_difference'
             ELSE 'cost_unknown' END AS reason,
        p.created_at
 FROM mx_priced_reservations p JOIN mx_point_reservations r ON r.id=p.request_id
 WHERE r.state='reconciliation_pending' OR p.cost_state='disputed'
    OR (r.state='settled' AND p.cost_state='unknown');
CREATE VIEW mx_pricing_financials AS
 SELECT p.request_id,p.account_id,p.model_id,p.retail_version_id,p.purchase_version_id,p.fx_version_id,
        r.charged AS charged_subunits,p.cost_state,
        r.charged::numeric*10 AS retail_revenue_microfen,
        p.purchase_estimate_microfen,p.supplier_bill_microfen,
        r.charged::numeric*10-p.purchase_estimate_microfen AS estimated_gross_profit_microfen,
        CASE WHEN p.supplier_bill_microfen IS NOT NULL
             THEN r.charged::numeric*10-p.supplier_bill_microfen END AS billed_gross_profit_microfen
 FROM mx_priced_reservations p JOIN mx_point_reservations r ON r.id=p.request_id
 WHERE r.state='settled';
