// Ordered by specificity. This is a routing contract, not a live proxy config.
export const routes = Object.freeze([
  { path: '/v1/payments/wechat/notify', match: 'exact', methods: ['POST'], owner: 'identity-go', access: 'public-signed-callback', auth: 'WeChat signature + order idempotency', body: 'backend-owned', streaming: false, timeout: 'callback receipt', retry: 'provider retries; backend idempotent' },
  { path: '/v1/research/', match: 'prefix', methods: ['GET', 'POST'], owner: 'team-research', access: 'authenticated', auth: 'desktop bearer + per-project ACL', body: '128 KiB', streaming: true, timeout: '35s idle; verify MCP lifecycle', retry: 'no automatic replay of writes' },
  { path: '/ops/', match: 'prefix', methods: ['GET', 'POST'], owner: 'identity-go', access: 'admin-edge', auth: 'edge admission + backend session/CSRF/TOTP', body: 'backend-owned', streaming: false, timeout: 'backend-owned', retry: 'idempotency key for writes' },
  { path: '/ops', match: 'exact', methods: ['GET'], owner: 'identity-go', access: 'admin-edge', auth: 'edge admission + backend session', body: 'none', streaming: false, timeout: 'backend-owned', retry: 'safe GET only' },
  { path: '/v1/admin/billing-console/', match: 'prefix', methods: ['GET', 'POST'], owner: 'identity-go', access: 'billing-web-only', auth: 'proxy token + session/CSRF/role', body: '32 KiB', streaming: false, timeout: 'backend-owned', retry: 'idempotency key for writes' },
  { path: '/v1/model-gateway/responses', match: 'exact', methods: ['POST'], owner: 'identity-go', access: 'authenticated', auth: 'desktop bearer + wallet/route permission', body: 'backend-owned', streaming: true, timeout: 'stream idle; verify at OD.2', retry: 'never replay dispatched supplier request' },
  { path: '/', match: 'prefix', methods: ['GET', 'POST'], owner: 'identity-go', access: 'public-api', auth: 'backend route-specific', body: 'backend-owned', streaming: 'route-specific', timeout: 'backend-owned', retry: 'route-specific; no implicit replay' },
]);

const covers = (first, second) => first.match === 'prefix'
  ? second.path.startsWith(first.path)
  : second.match === 'exact' && first.path === second.path;

export function validateRoutes(items = routes) {
  for (let i = 0; i < items.length; i++) {
    const route = items[i];
    if (!route.path.startsWith('/') || !['exact', 'prefix'].includes(route.match) ||
        !['identity-go', 'team-research'].includes(route.owner) || !Array.isArray(route.methods) ||
        !route.methods.length || route.methods.some(m => !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m))) throw Error('ROUTE_INVALID');
    for (let j = 0; j < i; j++) {
      if (covers(items[j], route) && route.methods.some(method => items[j].methods.includes(method))) {
        throw Error(`ROUTE_SHADOWED: ${route.path}`);
      }
    }
  }
  if (items.at(-1)?.path !== '/' || items.at(-1)?.match !== 'prefix') throw Error('ROUTE_FALLBACK_REQUIRED');
  const research = items.find(route => route.path === '/v1/research/');
  const callback = items.find(route => route.path === '/v1/payments/wechat/notify');
  const ops = items.find(route => route.path === '/ops/');
  const opsIndex = items.find(route => route.path === '/ops');
  const billing = items.find(route => route.path === '/v1/admin/billing-console/');
  const model = items.find(route => route.path === '/v1/model-gateway/responses');
  if (research?.owner !== 'team-research' || callback?.owner !== 'identity-go' ||
      callback.access !== 'public-signed-callback' || callback.methods.join() !== 'POST' ||
      ops?.access !== 'admin-edge' || opsIndex?.access !== 'admin-edge' ||
      billing?.access !== 'billing-web-only' || billing?.owner !== 'identity-go' ||
      model?.streaming !== true || model?.owner !== 'identity-go') throw Error('ROUTE_POLICY_INVALID');
  return items;
}
