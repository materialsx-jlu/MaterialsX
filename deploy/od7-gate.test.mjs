import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluateGate, requiredReceipts } from './od7-gate.mjs';
import { probeTopology } from './od7-probe.mjs';
import { parseManifest } from './config-schema.mjs';
import { readFile } from 'node:fs/promises';

const now = Date.parse('2026-10-09T04:00:00.000Z');
const hash = value => createHash('sha256').update(value).digest('hex');
const bindings = prefix => ({ databaseId: `${prefix}-database`, credentialSetId: `${prefix}-credentials`, ledgerId: `${prefix}-ledger`, accountNamespace: `${prefix}-accounts` });
const stagingTemplate = await readFile(new URL('./examples/staging.template.yaml', import.meta.url), 'utf8');
const productionTemplate = await readFile(new URL('./examples/production.template.yaml', import.meta.url), 'utf8');
const staging = parseManifest(stagingTemplate.replaceAll('staging.example.invalid', 'staging.fixture-materialsx.org'));
const production = parseManifest(productionTemplate.replaceAll('example.invalid', 'fixture-materialsx.org'));
production.payment = { mode: 'wechat-native', notifyOrigin: production.public.apiOrigin, releaseId: 'mx-v0.3-rootflow-svip-20261007-3model-approved-v1' };
production.cloud.mode = 'mx-production';

async function evidence(dir, stage, operations, baseNow = now) {
  const receipts = [];
  for (const kind of requiredReceipts(stage)) {
    const manifest = stage === 'staging' ? staging : production;
    const probe = kind === 'dns-tls' ? await probeTopology(manifest, async url => ({ status:
      url.endsWith('/v1/client-config') || url === manifest.public.siteOrigin + '/' ? 200 :
      url.endsWith('/v1/research/projects') ? 401 : 404,
      json: async () => ({ schemaVersion: 1, catalogRevision: 'a'.repeat(64), features: { account: true, models: false, research: false, payments: false } }),
    }), new Date(baseNow - 60_000)) : null;
    const content = kind === 'operations-control-snapshot' ? JSON.stringify(operations) : probe ? JSON.stringify(probe) : `Reviewed ${kind} fixture`;
    const path = join(dir, `${stage}-${kind}.txt`);
    await writeFile(path, content, { mode: 0o600 });
    receipts.push({ kind, path, sha256: hash(content), reviewer: 'fixture-reviewer', reviewedAt: new Date(baseNow - 60_000).toISOString() });
  }
  return { schemaVersion: 1, stage, operator: 'fixture-operator', approvedAt: new Date(baseNow - 60_000).toISOString(),
    expiresAt: new Date(baseNow + 3_600_000).toISOString(), bindings: bindings(stage === 'staging' ? 'stage' : 'prod'),
    productionBindings: bindings('prod'), operations, receipts };
}
const flags = (stage, baseNow = now) => ({ observedAt: new Date(baseNow - 30_000).toISOString(), version: 1,
  cloudPaused: ['staging', 'read-only', 'direct-read-only', 'research'].includes(stage), salesPaused: stage !== 'orders' });

test('all phases require reviewed receipts, isolation and previous phase', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-od7-'));
  try {
    let previous;
    for (const stage of ['staging', 'read-only', 'research', 'canary-model', 'wallet', 'orders']) {
      const item = await evidence(dir, stage, flags(stage));
      const result = await evaluateGate({ stage, manifest: stage === 'staging' ? staging : production,
        productionManifest: stage === 'staging' ? production : null, evidence: item, previous, now });
      assert.equal(result.status, 'passed');
      assert.equal(result.stage, stage);
      assert.equal(result.receiptDigests.length, requiredReceipts(stage).length);
      previous = result;
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('direct production begins with full first-phase evidence and continues in sequence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-od7-direct-'));
  try {
    assert.ok(requiredReceipts('direct-read-only').includes('fault-injection'));
    assert.ok(requiredReceipts('direct-read-only').includes('production-read-only-login'));
    let previous;
    for (const stage of ['direct-read-only', 'research', 'canary-model', 'wallet', 'orders']) {
      const item = await evidence(dir, stage, flags(stage));
      const result = await evaluateGate({ stage, manifest: production, evidence: item, previous, now });
      assert.equal(result.status, 'passed');
      previous = result;
    }
    const missing = await evidence(dir, 'direct-read-only', flags('direct-read-only'));
    missing.receipts = missing.receipts.filter(row => row.kind !== 'callback-idempotency');
    await assert.rejects(evaluateGate({ stage: 'direct-read-only', manifest: production, evidence: missing, now }),
      /OD7_RECEIPT_MISSING:callback-idempotency/);
    await assert.rejects(evaluateGate({ stage: 'direct-read-only', manifest: production,
      evidence: await evidence(dir, 'direct-read-only', flags('direct-read-only')), previous, now }),
    /OD7_DIRECT_STAGE_INPUT_INVALID/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('public probe fails closed when admin leaks or a route is unreachable', async () => {
  const result = await probeTopology(staging, async url => ({ status: url.includes('/ops') ? 200 : 404 }), new Date(now));
  assert.equal(result.passed, false);
  assert.equal(result.items.find(item => item.name === 'admin-anonymous-denied').passed, false);
  assert.equal(result.items.find(item => item.name === 'api-client-config').passed, false);
});

test('public probe accepts an admin hostname blocked outside VPN', async () => {
  const report = await probeTopology(staging, async url => {
    if (url.startsWith(staging.public.adminOrigin)) throw Error('outside VPN');
    return { status: url.endsWith('/v1/client-config') || url === staging.public.siteOrigin + '/' ? 200 :
      url.endsWith('/v1/research/projects') ? 401 : 404,
      json: async () => ({ schemaVersion: 1, catalogRevision: 'b'.repeat(64),
        features: { account: true, models: false, research: false, payments: false } }) };
  }, new Date(now));
  assert.equal(report.passed, true);
  assert.equal(report.items.find(item => item.name === 'admin-anonymous-denied').status, null);
});

test('missing, tampered, stale, unreviewed or unsafe evidence blocks release', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-od7-'));
  try {
    const item = await evidence(dir, 'staging', flags('staging'));
    const call = () => evaluateGate({ stage: 'staging', manifest: staging, productionManifest: production, evidence: item, now });
    item.receipts.pop();
    await assert.rejects(call(), /OD7_RECEIPT_MISSING/);
    item.receipts = (await evidence(dir, 'staging', flags('staging'))).receipts;
    await writeFile(item.receipts[0].path, 'tampered');
    await assert.rejects(call(), /OD7_RECEIPT_HASH_MISMATCH/);
    item.receipts = (await evidence(dir, 'staging', flags('staging'))).receipts;
    item.operations.cloudPaused = false;
    await assert.rejects(call(), /OD7_OPERATIONS_SNAPSHOT_MISMATCH/);
    item.operations.cloudPaused = true;
    item.expiresAt = new Date(now - 1).toISOString();
    await assert.rejects(call(), /OD7_EVIDENCE_INVALID/);
    item.expiresAt = new Date(now + 3_600_000).toISOString();
    item.productionBindings.databaseId = item.bindings.databaseId;
    await assert.rejects(call(), /OD7_ISOLATION_FAILED/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('orders cannot open without formal payment or prior gates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-od7-'));
  try {
    const item = await evidence(dir, 'orders', flags('orders'));
    await assert.rejects(evaluateGate({ stage: 'orders', manifest: production, evidence: item, now }), /OD7_PREVIOUS_STAGE_REQUIRED/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('operator CLI writes one private report and refuses to overwrite it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-od7-cli-'));
  try {
    const manifest = join(dir, 'staging.yaml'), productionPath = join(dir, 'production.yaml');
    const input = join(dir, 'evidence.json'), out = join(dir, 'staging-report.json');
    await writeFile(manifest, stagingTemplate.replaceAll('staging.example.invalid', 'staging.fixture-materialsx.org'));
    await writeFile(productionPath, productionTemplate.replaceAll('example.invalid', 'fixture-materialsx.org'));
    const current = Date.now();
    const item = await evidence(dir, 'staging', flags('staging', current), current);
    await writeFile(input, JSON.stringify(item), { mode: 0o600 });
    const args = ['scripts/od7-gate.mjs', '--stage', 'staging', '--manifest', manifest,
      '--production-manifest', productionPath, '--evidence', input, '--out', out];
    const ok = spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    const report = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(report.status, 'passed');
    const again = spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(again.status, 1);
    assert.ok(!again.stderr.includes(item.operator));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
