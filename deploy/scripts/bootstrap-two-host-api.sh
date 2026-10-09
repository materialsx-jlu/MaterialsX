#!/usr/bin/env bash
set -euo pipefail

# Run on the Ubuntu 24.04 edge host after placing the release archive and
# root-only db.env (MX_API_DB_PASSWORD and MX_RUNTIME_DB_PASSWORD).
release_id='v0.3.0-preview.1'
archive="/tmp/materialsx-control-plane-${release_id}-linux-amd64.tar.gz"
expected_sha='f70a9334fb7982846de6789e99dd429b17fa1c06d87cc1307e056d4eef32bbff'
release_dir="/opt/materialsx/control-plane/releases/${release_id}"

test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$expected_sha"
test -f /etc/materialsx/secrets/db.env
if ! id mxapi >/dev/null 2>&1; then
  useradd --system --home /var/lib/materialsx-api --shell /usr/sbin/nologin mxapi
fi
install -d -m 0755 /opt/materialsx/control-plane/releases
install -d -m 0755 "$release_dir"
tar -xzf "$archive" -C "$release_dir" --no-same-owner
ln -sfn "$release_dir" /opt/materialsx/control-plane/current
chown -R root:root "$release_dir"
chmod 0755 "$release_dir/bin/identity" "$release_dir/bin/identityctl" "$release_dir/bin/worker"
install -d -o mxapi -g mxapi -m 0750 /var/lib/materialsx-api
chown root:mxapi /etc/materialsx/secrets
chmod 0750 /etc/materialsx/secrets

# shellcheck disable=SC1091
source /etc/materialsx/secrets/db.env
[[ "$MX_API_DB_PASSWORD" =~ ^[a-f0-9]{64}$ ]]
[[ "$MX_RUNTIME_DB_PASSWORD" =~ ^[a-f0-9]{64}$ ]]
key_file=/etc/materialsx/secrets/identity-master-key
token_file=/etc/materialsx/secrets/billing-proxy-token
if [[ ! -f "$key_file" ]]; then
  umask 077
  openssl rand -base64 32 > "$key_file"
fi
if [[ ! -f "$token_file" ]]; then
  umask 077
  openssl rand -hex 32 > "$token_file"
fi
master_key=$(cat "$key_file")
proxy_token=$(cat "$token_file")
db_query='sslmode=verify-full&sslrootcert=/etc/materialsx-pg/ca.crt'
owner_url="postgresql://mx_api:${MX_API_DB_PASSWORD}@127.0.0.1:15432/mx_control_plane?${db_query}"
runtime_url="postgresql://mx_runtime:${MX_RUNTIME_DB_PASSWORD}@127.0.0.1:15432/mx_control_plane?${db_query}"
umask 077
cat > /etc/materialsx/secrets/api-migrate.env <<EOF
MATERIALSX_ENV=production
MATERIALSX_IDENTITY_ADDR=127.0.0.1:8788
MATERIALSX_IDENTITY_PUBLIC_URL=https://api.mx.jouhu.com
MATERIALSX_DATABASE_URL='${owner_url}'
MATERIALSX_IDENTITY_MASTER_KEY=${master_key}
EOF
cat > /etc/materialsx/secrets/api-runtime.env <<EOF
MATERIALSX_ENV=production
MATERIALSX_IDENTITY_ADDR=127.0.0.1:8788
MATERIALSX_IDENTITY_PUBLIC_URL=https://api.mx.jouhu.com
MATERIALSX_DATABASE_URL='${runtime_url}'
MATERIALSX_IDENTITY_MASTER_KEY=${master_key}
MATERIALSX_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
MATERIALSX_CLOUD_MODE=disabled
MATERIALSX_PAYMENT_MODE=disabled
MATERIALSX_BILLING_ADMIN_PUBLIC_URL=https://admin.mx.jouhu.com
MATERIALSX_BILLING_PROXY_TOKEN=${proxy_token}
MATERIALSX_LITELLM_URL=http://127.0.0.1:4001
MATERIALSX_EMAIL_ENABLED=0
MATERIALSX_SIGNUP_ENABLED=0
EOF
chown root:mxapi /etc/materialsx/secrets/api-runtime.env
chmod 0640 /etc/materialsx/secrets/api-runtime.env
chmod 0600 /etc/materialsx/secrets/api-migrate.env "$key_file" "$token_file" /etc/materialsx/secrets/db.env
echo 'api-artifacts-and-environment-ready'
