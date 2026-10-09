import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parseManifest, validateManifest } from './config-schema.mjs';
import { scanText, inventory } from './inventory.mjs';
import { renderPreview } from './render.mjs';
import { routes, validateRoutes } from './routes.mjs';

const root = resolve('.');
const example = await readFile(join(root, 'deploy/examples/development.yaml'), 'utf8');
const base = parseManifest(example);
const copy = () => structuredClone(base);

test('local example renders a non-deployable, credential-free preview', () => {
  const preview = renderPreview(base);
  assert.equal(preview.deploymentReady, false);
  assert.equal(preview.partialEnvironment.identityGo.MATERIALSX_IDENTITY_PUBLIC_URL, base.public.apiOrigin);
  assert.equal(preview.partialEnvironment.teamResearch.MATERIALSX_TEAM_PUBLIC_ORIGIN, base.public.apiOrigin);
  assert.equal(preview.partialEnvironment.website.SITE_ORIGIN, undefined);
  assert.equal(preview.partialEnvironment.identityGo.MATERIALSX_PAYMENT_MODE, 'disabled');
  assert.equal(preview.routes.at(-1).path, '/');
  assert.ok(!JSON.stringify(preview).includes('ROOTFLOWAI_API_KEY'));
});

test('strict manifest rejects credentials, duplicate YAML keys and unsafe origins', () => {
  assert.throws(() => parseManifest(example + '\nROOTFLOWAI_API_KEY: hidden\n'), /MANIFEST_SCHEMA_INVALID/);
  assert.throws(() => parseManifest(example.replace('environment: development', 'environment: development\nenvironment: production')), /MANIFEST_YAML_INVALID/);
  assert.throws(() => parseManifest(example.replace('http://127.0.0.1:8788', 'http://user:password@127.0.0.1:8788')), /PUBLIC_ORIGIN_INVALID/);
  assert.throws(() => parseManifest(example.replace('identity: 127.0.0.1:8788', 'identity: 0.0.0.0:8788')), /INTERNAL_LOOPBACK_REQUIRED/);
});

test('production checks enforce TLS, real domains, no dev switches and distinct listeners', () => {
  const value = copy();
  value.environment = 'production';
  value.releaseChannel = 'stable';
  value.public = { apiOrigin: 'https://api.fixture-materialsx.org', siteOrigin: 'https://www.fixture-materialsx.org', adminOrigin: 'https://admin.fixture-materialsx.org' };
  value.payment.notifyOrigin = value.public.apiOrigin;
  assert.deepEqual(validateManifest(value), value);
  assert.equal(renderPreview(value).partialEnvironment.website.SITE_ORIGIN, value.public.siteOrigin);
  value.public.apiOrigin = 'http://api.fixture-materialsx.org';
  assert.throws(() => validateManifest(value), /PUBLIC_HTTPS_DOMAIN_REQUIRED/);
  value.public.apiOrigin = 'https://api.example.invalid';
  assert.throws(() => validateManifest(value), /PUBLIC_HTTPS_DOMAIN_REQUIRED/);
  value.public.apiOrigin = 'https://api.fixture-materialsx.org';
  value.development.disableAdminTotp = true;
  assert.throws(() => validateManifest(value), /DEVELOPMENT_FLAGS_FORBIDDEN/);
  value.development.disableAdminTotp = false;
  value.internal.team = value.internal.identity;
  assert.throws(() => validateManifest(value), /INTERNAL_PORT_CONFLICT/);
  value.internal.team = '127.0.0.1:8793';
  value.payment.notifyOrigin = 'https://other.fixture-materialsx.org';
  assert.throws(() => validateManifest(value), /PAYMENT_CALLBACK_ORIGIN_MISMATCH/);
  value.payment.notifyOrigin = value.public.apiOrigin;
  value.payment.mode = 'wechat-native';
  assert.throws(() => validateManifest(value), /MX_PRODUCTION_RELEASE_REQUIRED/);
  value.payment.releaseId = 'mx-v0.3-rootflow-svip-20261007-3model-approved-v1';
  assert.equal(validateManifest(value), value);
  assert.equal(renderPreview(value).partialEnvironment.identityGo.MATERIALSX_CLOUD_MODE, 'mx-production');
  value.payment.releaseId = 'unreviewed';
  assert.throws(() => validateManifest(value), /MX_PRODUCTION_RELEASE_UNAPPROVED/);
  assert.throws(() => parseManifest(example.replace('enablePaymentPilot: false', 'enablePaymentPilot: true')), /PAYMENT_PILOT_NOT_CONFIGURABLE/);
});

test('staging can probe an isolated alpha route, but production cannot use alpha or mismatched MX payment', async () => {
  const source = await readFile(join(root, 'deploy/examples/staging.template.yaml'), 'utf8');
  const staging = parseManifest(source.replaceAll('staging.example.invalid', 'staging.fixture-materialsx.org'));
  assert.equal(renderPreview(staging).partialEnvironment.identityGo.MATERIALSX_CLOUD_MODE, 'alpha');
  const production = structuredClone(staging);
  production.environment = 'production'; production.releaseChannel = 'stable';
  production.public = { apiOrigin: 'https://api.fixture-materialsx.org', siteOrigin: 'https://www.fixture-materialsx.org', adminOrigin: 'https://admin.fixture-materialsx.org' };
  assert.throws(() => validateManifest(production), /PRODUCTION_ALPHA_CLOUD_FORBIDDEN/);
  production.cloud.mode = 'disabled';
  production.payment = { mode: 'wechat-native', notifyOrigin: production.public.apiOrigin, releaseId: 'mx-v0.3-rootflow-svip-20261007-3model-approved-v1' };
  assert.throws(() => validateManifest(production), /PAYMENT_REQUIRES_MX_CLOUD/);
  production.cloud.mode = 'mx-production';
  assert.equal(renderPreview(validateManifest(production)).partialEnvironment.identityGo.MATERIALSX_CLOUD_MODE, 'mx-production');
});

test('remote MOOS mode only accepts private mTLS link and loopback MOOS API', () => {
  const value = copy();
  value.environment = 'production';
  value.releaseChannel = 'stable';
  value.public = { apiOrigin: 'https://api.fixture-materialsx.org', siteOrigin: 'https://www.fixture-materialsx.org', adminOrigin: 'https://admin.fixture-materialsx.org' };
  value.payment.notifyOrigin = value.public.apiOrigin;
  value.researchData = { mode: 'private-mtls', linkAddress: '10.24.0.5:9443', serverName: 'moos.internal.materialsx.org', moosHostApi: '127.0.0.1:8080' };
  assert.equal(renderPreview(validateManifest(value)).partialEnvironment.moosLinkClient.MATERIALSX_MOOS_LINK_REMOTE, '10.24.0.5:9443');
  value.researchData.linkAddress = '0.0.0.0:9443';
  assert.throws(() => validateManifest(value), /MOOS_PRIVATE_ADDRESS_REQUIRED/);
  value.researchData.linkAddress = '10.24.0.5:9443';
  value.researchData.moosHostApi = '10.24.0.5:8080';
  assert.throws(() => validateManifest(value), /INTERNAL_LOOPBACK_REQUIRED/);
  value.researchData.moosHostApi = '127.0.0.1:8080';
  value.researchData.serverName = '127.0.0.1';
  assert.throws(() => validateManifest(value), /MOOS_SERVER_NAME_INVALID/);
  const development = copy();
  development.researchData = { mode: 'private-mtls', linkAddress: '10.24.0.5:9443', serverName: 'moos.internal.materialsx.org', moosHostApi: '127.0.0.1:8080' };
  assert.throws(() => validateManifest(development), /MOOS_PRIVATE_LINK_REQUIRES_NONDEVELOPMENT/);
});

test('dedicated routes cannot be shadowed or reassigned', () => {
  assert.equal(validateRoutes(routes), routes);
  const broad = { ...routes.at(-1), path: '/v1/', match: 'prefix' };
  assert.throws(() => validateRoutes([broad, ...routes]), /ROUTE_SHADOWED/);
  const changed = routes.map(route => route.path === '/ops/' ? { ...route, access: 'public-api' } : route);
  assert.throws(() => validateRoutes(changed), /ROUTE_POLICY_INVALID/);
});

test('scanner shows variable names and origins without URL credentials, paths or values', async () => {
  const found = scanText('process.env.ROOTFLOWAI_API_KEY; os.Getenv("MATERIALSX_IDENTITY_ADDR"); fetch("https://paper.example.org/private?key=hidden"); fetch("https://user:pass@private.example.org/")');
  assert.ok(found.variables.includes('ROOTFLOWAI_API_KEY'));
  assert.deepEqual(found.origins, ['https://paper.example.org']);
  const report = await inventory(root);
  assert.ok(report.areas.desktop.variableNames.includes('MATERIALSX_IDENTITY_URL'));
  assert.ok(report.areas.goApiAndPayments.filesScanned > 0);
  assert.ok(!JSON.stringify(report).includes('/private?key=hidden'));
});

test('CLI writes a no-secret preview once and never prints raw invalid input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-od0-'));
  try {
    const output = join(dir, 'preview.json');
    const command = ['scripts/deployment-config.mjs', '--manifest', 'deploy/examples/development.yaml', '--out', output];
    const ok = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).deploymentReady, false);
    if (process.platform !== 'win32') assert.equal((await stat(output)).mode & 0o777, 0o600);
    const overwrite = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8' });
    assert.equal(overwrite.status, 1);
    assert.ok(!overwrite.stderr.includes(output));
    const invalid = join(dir, 'invalid.yaml');
    await writeFile(invalid, example + '\nunknownKey: confidential-fixture-value\n');
    const fail = spawnSync(process.execPath, ['scripts/deployment-config.mjs', '--manifest', invalid], { cwd: root, encoding: 'utf8' });
    assert.equal(fail.status, 1);
    assert.ok(!fail.stderr.includes('confidential-fixture-value'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
