CREATE TABLE mx_supplier_reconciliations (
 request_id text PRIMARY KEY REFERENCES gateway_requests(id),
 supplier_request_id text NOT NULL UNIQUE,
 input_tokens bigint NOT NULL CHECK(input_tokens>=0),
 output_tokens bigint NOT NULL CHECK(output_tokens>=0),
 cache_read_tokens bigint NOT NULL CHECK(cache_read_tokens>=0),
 cache_create_tokens bigint NOT NULL CHECK(cache_create_tokens>=0),
 supplier_cost_microfen bigint NOT NULL CHECK(supplier_cost_microfen>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(cache_read_tokens<=input_tokens AND cache_create_tokens<=input_tokens-cache_read_tokens)
);
CREATE TRIGGER mx_supplier_evidence_immutable BEFORE UPDATE OR DELETE ON mx_supplier_reconciliations
 FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
