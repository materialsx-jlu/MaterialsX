import { createHash } from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');
const probes = manifest => [
  { name: 'api-client-config', url: manifest.public.apiOrigin + '/v1/client-config', allowed: [200] },
  { name: 'site-home', url: manifest.public.siteOrigin + '/', allowed: [200] },
  { name: 'api-admin-denied', url: manifest.public.apiOrigin + '/ops', allowed: [403, 404] },
  { name: 'api-private-metrics-denied', url: manifest.public.apiOrigin + '/internal/metrics', allowed: [403, 404] },
  { name: 'api-billing-proxy-denied', url: manifest.public.apiOrigin + '/v1/admin/billing-console/health', allowed: [403, 404] },
  { name: 'research-auth-required', url: manifest.public.apiOrigin + '/v1/research/projects', allowed: [401, 403] },
  { name: 'admin-anonymous-denied', url: manifest.public.adminOrigin + '/ops', allowed: [401, 403, 404] },
];

export async function probeTopology(manifest, transport = fetch, now = new Date()) {
  if (!['staging', 'production'].includes(manifest.environment)) throw Error('OD7_PROBE_ENVIRONMENT_INVALID');
  const items = await Promise.all(probes(manifest).map(async entry => {
    try {
      const response = await transport(entry.url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(6000) });
      let passed = entry.allowed.includes(response.status);
      if (passed && entry.name === 'api-client-config') {
        const config = await response.json();
        passed = config?.schemaVersion === 1 && /^[0-9a-f]{64}$/.test(config.catalogRevision) &&
          ['account', 'models', 'research', 'payments'].every(key => typeof config.features?.[key] === 'boolean');
      }
      return { name: entry.name, status: response.status, passed };
    } catch { return { name: entry.name, status: null, passed: entry.name === 'admin-anonymous-denied' }; }
  }));
  return { schemaVersion: 1, environment: manifest.environment, checkedAt: now.toISOString(),
    publicOriginDigest: sha(JSON.stringify(manifest.public)), passed: items.every(item => item.passed), items };
}
