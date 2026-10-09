import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { parseManifest } from './config-schema.mjs';

export const stages = ['staging', 'read-only', 'research', 'canary-model', 'wallet', 'orders', 'direct-read-only'];
const common = ['dns-tls', 'same-origin-routing', 'admin-isolation', 'restricted-database', 'model-streaming', 'moos-authorization', 'callback-idempotency', 'fault-injection', 'operations-control-snapshot'];
const formal = ['production-domain-certificate', 'payment-callback-refund', 'supplier-billing', 'macos-install', 'windows-install', 'linux-install', 'backup-restore', 'key-rotation', 'alerts', 'rollback', 'model-price-consistency'];
const additions = {
  staging: common,
  'read-only': ['production-read-only-login', 'new-sales-disabled', 'operations-control-snapshot'],
  research: ['research-data-approval', 'moos-authorization', 'operations-control-snapshot'],
  'canary-model': ['canary-model-approval', 'model-streaming', 'supplier-billing', 'operations-control-snapshot'],
  wallet: ['wallet-approval', 'wallet-reconciliation', 'operations-control-snapshot'],
  orders: ['orders-approval', 'payment-callback-refund', 'wallet-reconciliation', 'operations-control-snapshot', ...formal],
};
const sha = value => createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value);
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const own = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));

export async function loadManifest(path) { return parseManifest(await readFile(path, 'utf8')); }

export function requiredReceipts(stage) {
  if (stage === 'direct-read-only') return [...new Set([...additions.staging, ...additions['read-only']])];
  const index = stages.indexOf(stage);
  if (index < 0) throw Error('OD7_STAGE_INVALID');
  return [...new Set(stages.slice(0, index + 1).flatMap(name => additions[name]))];
}

export function checkIsolation(staging, production, stagingBindings, productionBindings) {
  if (staging.environment !== 'staging' || production.environment !== 'production') throw Error('OD7_ENVIRONMENT_MISMATCH');
  for (const key of Object.keys(staging.public)) if (staging.public[key] === production.public[key]) throw Error('OD7_PUBLIC_ORIGIN_SHARED');
  for (const key of ['databaseId', 'credentialSetId', 'ledgerId', 'accountNamespace']) {
    if (!id(stagingBindings?.[key]) || !id(productionBindings?.[key]) || stagingBindings[key] === productionBindings[key]) throw Error(`OD7_ISOLATION_FAILED:${key}`);
  }
  if (staging.payment.mode !== 'disabled') throw Error('OD7_STAGING_PAYMENT_MUST_BE_DISABLED');
}

async function verifyReceipt(row, now) {
  if (!own(row, ['kind', 'path', 'sha256', 'reviewer', 'reviewedAt']) || !id(row.kind) ||
    typeof row.path !== 'string' || !row.path.startsWith('/') || !hex(row.sha256) ||
    !id(row.reviewer) || !date(row.reviewedAt) || Date.parse(row.reviewedAt) > now) throw Error('OD7_RECEIPT_INVALID');
  const info = await stat(row.path);
  if (!info.isFile() || info.size > 1024 * 1024 || info.mode & 0o077) throw Error(`OD7_RECEIPT_NOT_PRIVATE:${row.kind}`);
  if (sha(await readFile(row.path)) !== row.sha256) throw Error(`OD7_RECEIPT_HASH_MISMATCH:${row.kind}`);
}

export async function evaluateGate({ stage, manifest, productionManifest, evidence, previous, now = Date.now() }) {
  const direct = stage === 'direct-read-only';
  const index = direct ? 1 : stages.indexOf(stage);
  if (index < 0 || manifest.environment !== (index === 0 ? 'staging' : 'production')) throw Error('OD7_STAGE_ENVIRONMENT_MISMATCH');
  if (!own(evidence, ['schemaVersion', 'stage', 'operator', 'approvedAt', 'expiresAt', 'bindings', 'productionBindings', 'operations', 'receipts']) ||
    evidence.schemaVersion !== 1 || evidence.stage !== stage || !id(evidence.operator) || !date(evidence.approvedAt) ||
    !date(evidence.expiresAt) || Date.parse(evidence.approvedAt) > now || Date.parse(evidence.expiresAt) <= now ||
    !Array.isArray(evidence.receipts)) throw Error('OD7_EVIDENCE_INVALID');
  if (direct) {
    if (previous || productionManifest) throw Error('OD7_DIRECT_STAGE_INPUT_INVALID');
    for (const key of ['databaseId', 'credentialSetId', 'ledgerId', 'accountNamespace']) {
      if (!id(evidence.bindings?.[key])) throw Error(`OD7_BINDING_INVALID:${key}`);
    }
  } else if (index === 0) {
    if (!productionManifest) throw Error('OD7_PRODUCTION_MANIFEST_REQUIRED');
    checkIsolation(manifest, productionManifest, evidence.bindings, evidence.productionBindings);
  } else {
    if (!previous || previous.schemaVersion !== 1 ||
      (previous.stage !== stages[index - 1] && !(stage === 'research' && previous.stage === 'direct-read-only')) ||
      previous.status !== 'passed' ||
      !date(previous.expiresAt) || Date.parse(previous.expiresAt) <= now) throw Error('OD7_PREVIOUS_STAGE_REQUIRED');
    if (index > 1 && previous.manifestSha256 !== sha(JSON.stringify(manifest))) throw Error('OD7_PRODUCTION_MANIFEST_CHANGED');
    if (index === 1 && previous.productionManifestSha256 !== sha(JSON.stringify(manifest))) throw Error('OD7_PRODUCTION_MANIFEST_CHANGED');
    for (const key of ['databaseId', 'credentialSetId', 'ledgerId', 'accountNamespace']) {
      if (!id(evidence.bindings?.[key]) || evidence.bindings[key] !== previous.productionBindings[key]) throw Error(`OD7_BINDING_CHANGED:${key}`);
    }
  }
  const needed = requiredReceipts(stage);
  const found = new Map();
  for (const row of evidence.receipts) {
    if (found.has(row.kind) || !needed.includes(row.kind)) throw Error('OD7_RECEIPT_DUPLICATE_OR_UNKNOWN');
    found.set(row.kind, row);
    await verifyReceipt(row, now);
  }
  for (const kind of needed) if (!found.has(kind)) throw Error(`OD7_RECEIPT_MISSING:${kind}`);
  const publicProbe = JSON.parse(await readFile(found.get('dns-tls').path, 'utf8'));
  if (publicProbe.schemaVersion !== 1 || publicProbe.environment !== manifest.environment ||
    publicProbe.publicOriginDigest !== sha(JSON.stringify(manifest.public)) || !date(publicProbe.checkedAt) ||
    Date.parse(publicProbe.checkedAt) > now || now - Date.parse(publicProbe.checkedAt) > 24 * 60 * 60_000 ||
    publicProbe.passed !== true || !Array.isArray(publicProbe.items) || publicProbe.items.length !== 7 ||
    publicProbe.items.some(item => item.passed !== true)) throw Error('OD7_PUBLIC_PROBE_INVALID');
  const operations = evidence.operations;
  if (!own(operations, ['observedAt', 'version', 'cloudPaused', 'salesPaused']) ||
    !date(operations?.observedAt) || now - Date.parse(operations.observedAt) > 5 * 60_000 ||
    Date.parse(operations.observedAt) > now || !/^(0|[1-9][0-9]*)$/.test(String(operations.version)) ||
    !Number.isSafeInteger(Number(operations.version)) ||
    typeof operations.cloudPaused !== 'boolean' || typeof operations.salesPaused !== 'boolean') throw Error('OD7_OPERATIONS_SNAPSHOT_INVALID');
  const captured = JSON.parse(await readFile(found.get('operations-control-snapshot').path, 'utf8'));
  if (JSON.stringify(captured) !== JSON.stringify(operations)) throw Error('OD7_OPERATIONS_SNAPSHOT_MISMATCH');
  const expectedCloudPaused = index < 3, expectedSalesPaused = index < 5;
  if (operations.cloudPaused !== expectedCloudPaused || operations.salesPaused !== expectedSalesPaused) throw Error('OD7_OPERATIONS_STATE_UNSAFE');
  if (stage === 'orders' && manifest.payment.mode !== 'wechat-native') throw Error('OD7_PAYMENT_MODE_REQUIRED');
  const receiptDigests = needed.map(kind => ({ kind, sha256: found.get(kind).sha256, reviewer: found.get(kind).reviewer }));
  return {
    schemaVersion: 1, stage, status: 'passed', checkedAt: new Date(now).toISOString(),
    expiresAt: evidence.expiresAt, manifestSha256: sha(JSON.stringify(manifest)),
    productionManifestSha256: index === 0 ? sha(JSON.stringify(productionManifest)) : undefined,
    productionBindings: index === 0 ? evidence.productionBindings : evidence.bindings,
    previousDigest: previous ? sha(JSON.stringify(previous)) : null,
    receiptDigests, operator: evidence.operator,
    permittedCapability: stage === 'staging' ? 'none' : stage,
  };
}
