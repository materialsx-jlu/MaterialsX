-- Browser-pasted supplier keys are encrypted with the identity service key.
-- The existing credential_env column remains an internal LiteLLM slot name.
ALTER TABLE mx_cloud_models ADD COLUMN credential_cipher bytea;
