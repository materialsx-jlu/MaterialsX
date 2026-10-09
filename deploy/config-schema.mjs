import { isIP } from 'node:net';
import { parseDocument } from 'yaml';
import { z } from 'zod';

const address = z.string().trim().min(1);
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  environment: z.enum(['development', 'staging', 'production']),
  releaseChannel: z.enum(['development', 'preview', 'stable']),
  public: z.strictObject({
    apiOrigin: address,
    siteOrigin: address,
    adminOrigin: address,
  }),
  internal: z.strictObject({
    identity: address,
    team: address,
    billingWeb: address,
    litellmProxy: address,
    litellmConsole: address,
    moosApi: address,
  }),
  researchData: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('colocated') }),
    z.strictObject({
      mode: z.literal('private-mtls'),
      linkAddress: address,
      serverName: address,
      moosHostApi: address,
    }),
  ]).optional(),
  cloud: z.strictObject({ mode: z.enum(['disabled', 'alpha', 'mx-production']) }).optional(),
  payment: z.strictObject({
    mode: z.enum(['disabled', 'wechat-native']),
    notifyOrigin: address.optional(),
    releaseId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/).optional(),
  }),
  development: z.strictObject({
    enableDevRoutes: z.boolean(),
    disableAdminTotp: z.boolean(),
    enablePaymentPilot: z.boolean(),
  }),
});

const placeholderSuffixes = ['.invalid', '.example', '.test', '.localhost', '.local', '.example.com', '.example.org', '.example.net'];
const od5ReleaseId = 'mx-v0.3-rootflow-svip-20261007-3model-approved-v1';
const loopback = (host) => host === '127.0.0.1' || host === '[::1]';

export function parseManifest(source) {
  if (Buffer.byteLength(source, 'utf8') > 64 * 1024) throw Error('MANIFEST_TOO_LARGE');
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw Error('MANIFEST_YAML_INVALID');
  let value;
  try { value = document.toJS({ maxAliasCount: 0 }); }
  catch { throw Error('MANIFEST_ALIAS_INVALID'); }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    const paths = parsed.error.issues.map(issue => issue.path.join('.') || 'root');
    throw Error('MANIFEST_SCHEMA_INVALID: ' + [...new Set(paths)].join(', '));
  }
  validateManifest(parsed.data);
  return parsed.data;
}

function publicOrigin(raw, environment, field) {
  let u;
  try { u = new URL(raw); } catch { throw Error(`PUBLIC_ORIGIN_INVALID: ${field}`); }
  if (raw !== u.origin || u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
      !['http:', 'https:'].includes(u.protocol)) throw Error(`PUBLIC_ORIGIN_INVALID: ${field}`);
  if (environment === 'development') {
    if (u.protocol !== 'http:' || !loopback(u.hostname)) throw Error(`DEVELOPMENT_ORIGIN_NOT_LOOPBACK: ${field}`);
  } else {
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.port || isIP(host) || !host.includes('.') ||
        placeholderSuffixes.some(suffix => host.endsWith(suffix))) throw Error(`PUBLIC_HTTPS_DOMAIN_REQUIRED: ${field}`);
  }
  return u;
}

export function internalAddress(raw, field) {
  const match = /^(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})$/.exec(raw);
  if (!match || Number(match[2]) > 65535) throw Error(`INTERNAL_LOOPBACK_REQUIRED: ${field}`);
  return { host: match[1], port: Number(match[2]) };
}

export function privateAddress(raw) {
  let u;
  try { u = new URL(`https://${raw}`); } catch { throw Error('MOOS_PRIVATE_ADDRESS_REQUIRED'); }
  if (u.host !== raw || !u.port || u.pathname !== '/' || u.search || u.hash || u.username || u.password) throw Error('MOOS_PRIVATE_ADDRESS_REQUIRED');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127) return;
  } else if (isIP(host) === 6 && /^(fc|fd)/i.test(host)) return;
  throw Error('MOOS_PRIVATE_ADDRESS_REQUIRED');
}

export function validateManifest(manifest) {
  const publicUrls = Object.entries(manifest.public).map(([key, raw]) => [key, publicOrigin(raw, manifest.environment, key)]);
  if (new Set(publicUrls.map(([, url]) => url.origin)).size !== publicUrls.length) throw Error('PUBLIC_ORIGIN_CONFLICT');
  const listeners = Object.entries(manifest.internal).map(([key, raw]) => [key, internalAddress(raw, key)]);
  if (new Set(listeners.map(([, value]) => `${value.host}:${value.port}`)).size !== listeners.length) throw Error('INTERNAL_PORT_CONFLICT');
  if (manifest.researchData?.mode === 'private-mtls') {
    if (manifest.environment === 'development') throw Error('MOOS_PRIVATE_LINK_REQUIRES_NONDEVELOPMENT');
    privateAddress(manifest.researchData.linkAddress);
    internalAddress(manifest.researchData.moosHostApi, 'researchData.moosHostApi');
    if (!/^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])?$/.test(manifest.researchData.serverName) ||
      !manifest.researchData.serverName.includes('.') || isIP(manifest.researchData.serverName)) throw Error('MOOS_SERVER_NAME_INVALID');
  }
  if (manifest.releaseChannel === 'stable' && manifest.environment !== 'production') throw Error('STABLE_REQUIRES_PRODUCTION');
  if (manifest.environment === 'production' && manifest.releaseChannel !== 'stable') throw Error('PRODUCTION_REQUIRES_STABLE');
  if (manifest.environment !== 'development' && Object.values(manifest.development).some(Boolean)) throw Error('DEVELOPMENT_FLAGS_FORBIDDEN');
  if (manifest.development.enablePaymentPilot) throw Error('PAYMENT_PILOT_NOT_CONFIGURABLE');
  if (manifest.environment === 'development' && manifest.payment.mode !== 'disabled') throw Error('DEVELOPMENT_PAYMENT_MODE_UNSUPPORTED');
  if (manifest.payment.notifyOrigin && manifest.payment.notifyOrigin !== manifest.public.apiOrigin) throw Error('PAYMENT_CALLBACK_ORIGIN_MISMATCH');
  if (manifest.payment.mode === 'wechat-native' && manifest.environment !== 'production') throw Error('PRODUCTION_PAYMENT_ONLY');
  if (manifest.payment.mode === 'wechat-native' && (!manifest.payment.releaseId || manifest.payment.notifyOrigin !== manifest.public.apiOrigin)) throw Error('MX_PRODUCTION_RELEASE_REQUIRED');
  if (manifest.payment.mode === 'wechat-native' && manifest.payment.releaseId !== od5ReleaseId) throw Error('MX_PRODUCTION_RELEASE_UNAPPROVED');
  if (manifest.payment.mode === 'disabled' && manifest.payment.releaseId) throw Error('MX_RELEASE_WITHOUT_PAYMENT');
  const cloudMode = manifest.cloud?.mode ?? (manifest.payment.mode === 'wechat-native' ? 'mx-production' : 'disabled');
  if (manifest.environment === 'staging' && cloudMode === 'mx-production') throw Error('STAGING_PRODUCTION_CLOUD_FORBIDDEN');
  if (manifest.environment === 'production' && cloudMode === 'alpha') throw Error('PRODUCTION_ALPHA_CLOUD_FORBIDDEN');
  if (cloudMode === 'mx-production' && manifest.payment.mode !== 'wechat-native') throw Error('MX_CLOUD_REQUIRES_PAYMENT');
  if (manifest.payment.mode === 'wechat-native' && cloudMode !== 'mx-production') throw Error('PAYMENT_REQUIRES_MX_CLOUD');
  return manifest;
}
