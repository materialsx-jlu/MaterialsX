-- MX wallet billing is independent of legacy credits and subscriptions.
ALTER TABLE research_tasks ADD COLUMN mx_points_billing boolean NOT NULL DEFAULT false;
ALTER TABLE research_tasks ADD CONSTRAINT mx_task_billing_isolated CHECK (
 NOT mx_points_billing OR (sales_price_version_id IS NULL AND purchase_price_version_id IS NULL AND credit_precision=1 AND max_credits IS NULL)
);
CREATE INDEX mx_gateway_tasks ON research_tasks(account_id,created_at DESC) WHERE mx_points_billing;
