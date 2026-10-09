import { validateManifest } from './config-schema.mjs';
import { validateRoutes } from './routes.mjs';

const upstream = address => `http://${address}`;

function proxy(address, host, { streaming = false, research = false, body = '16m' } = {}) {
  return `    client_max_body_size ${body};
    proxy_pass ${upstream(address)};
    proxy_http_version 1.1;
    proxy_set_header Host ${host};
    proxy_set_header Origin $http_origin;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Port 443;
    proxy_set_header Forwarded "";
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header X-Original-URL "";
    proxy_set_header X-Rewrite-URL "";
    proxy_set_header X-User-ID "";
    proxy_set_header X-Reviewer-ID "";
    proxy_set_header X-Research-Role "";
    proxy_set_header X-MX-Billing-Proxy-Key "";
    proxy_set_header Connection "";
    ${research ? 'proxy_set_header Cookie "";' : ''}
    proxy_connect_timeout 3s;
    proxy_send_timeout 60s;
    proxy_read_timeout ${research ? '40s' : streaming ? '180s' : '60s'};
    proxy_next_upstream off;
    ${streaming ? 'proxy_buffering off;\n    proxy_cache off;\n    gzip off;' : ''}`;
}

function tls(kind) {
  return `  ssl_certificate /etc/materialsx/tls/${kind}/fullchain.pem;
  ssl_certificate_key /etc/materialsx/tls/${kind}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;`;
}

export function renderEdgeNginx(manifest, { includeDefaultServer = true } = {}) {
  validateManifest(manifest);
  validateRoutes();
  if (manifest.environment === 'development') throw Error('EDGE_HTTPS_ENVIRONMENT_REQUIRED');
  const api = new URL(manifest.public.apiOrigin).host;
  const admin = new URL(manifest.public.adminOrigin).host;
  const go = manifest.internal.identity;
  const team = manifest.internal.team;
  const billing = manifest.internal.billingWeb;
  const config = `# MaterialsX OD.2. Place inside nginx http {}. Never add public upstream ports.
# Certificate paths and the administrator allow-list must be installed separately.
log_format mx_edge '$remote_addr $request_method $status $body_bytes_sent $request_time';
map $http_origin $mx_api_origin_ok { default 0; "" 1; "${manifest.public.apiOrigin}" 1; }
map $http_origin $mx_admin_origin_ok { default 0; "" 1; "${manifest.public.adminOrigin}" 1; }

${includeDefaultServer ? `server {
  listen 443 ssl default_server;
  ssl_reject_handshake on;
}
` : ''}

server {
  listen 443 ssl;
  server_name ${api};
${tls('api')}
  server_tokens off;
  add_header Strict-Transport-Security "max-age=31536000" always;
  access_log /var/log/nginx/materialsx-access.log mx_edge;
  if ($host != ${api}) { return 421; }
  if ($mx_api_origin_ok = 0) { return 403; }
  location = /health/live { return 404; }
  location = /health/ready { return 404; }
  location = /ops { return 404; }
  location ^~ /ops/ { return 404; }
  location ^~ /v1/admin/ { return 404; }
  location = /v1/research { return 404; }
  location ^~ /v1/research/ {
    limit_except GET POST { deny all; }
${proxy(team, api, { streaming: true, research: true, body: '128k' })}
  }
  location = /v1/model-gateway/responses {
    limit_except POST { deny all; }
${proxy(go, api, { streaming: true })}
  }
  location = /v1/payments/wechat/notify {
    limit_except POST { deny all; }
${proxy(go, api, { body: '128k' })}
  }
  location / {
${proxy(go, api)}
  }
}

server {
  listen 443 ssl;
  server_name ${admin};
${tls('admin')}
  server_tokens off;
  add_header Strict-Transport-Security "max-age=31536000" always;
  access_log /var/log/nginx/materialsx-admin-access.log mx_edge;
  include /etc/materialsx/edge/admin-allow.conf;
  if ($host != ${admin}) { return 421; }
  if ($mx_admin_origin_ok = 0) { return 403; }
  location = /ops {
    limit_except GET { deny all; }
${proxy(go, admin)}
  }
  location ^~ /ops/ {
    limit_except GET POST { deny all; }
${proxy(go, admin)}
  }
  location ^~ /v1/ { return 404; }
  location / {
${proxy(billing, admin)}
  }
}
`;
  return { config, adminAllow: '# Replace only after VPN/identity-gateway admission is active.\ndeny all;\n' };
}
