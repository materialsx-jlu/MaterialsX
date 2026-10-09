#!/usr/bin/env bash
set -euo pipefail

archive=/tmp/materialsx-billing-admin-v0.3.0-preview.1.tgz
expected_sha=3f2b433dadb8e3ad0641cb508a9351990ff55521ffacedee63bf3c222318b041
release_dir=/opt/materialsx/billing-web/releases/v0.3.0-preview.1
test "$(sha256sum "$archive" | cut -d' ' -f1)" = "$expected_sha"
test -x /opt/materialsx-node/v24.7.0/bin/node
test -f /etc/materialsx/secrets/billing-proxy-token
if ! id mxweb >/dev/null 2>&1; then
  useradd --system --home /var/lib/materialsx-billing-web --shell /usr/sbin/nologin mxweb
fi
install -d -m 0755 "$release_dir"
tar -xzf "$archive" -C "$release_dir" --strip-components=1 --no-same-owner
chown -R root:root "$release_dir"
ln -sfn "$release_dir" /opt/materialsx/billing-web/current
proxy_token=$(cat /etc/materialsx/secrets/billing-proxy-token)
[[ "$proxy_token" =~ ^[a-f0-9]{64}$ ]]
umask 077
cat > /etc/materialsx/secrets/billing-web.env <<EOF
NODE_ENV=production
MATERIALSX_BILLING_ADMIN_PUBLIC_URL=https://admin.mx.jouhu.com
MATERIALSX_BILLING_GO_ORIGIN=http://127.0.0.1:8788
MATERIALSX_BILLING_WEB_ADDRESS=127.0.0.1:8790
MATERIALSX_BILLING_PROXY_TOKEN=${proxy_token}
EOF
chmod 0600 /etc/materialsx/secrets/billing-web.env
echo 'billing-web-artifacts-and-environment-ready'
