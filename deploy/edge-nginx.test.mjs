import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseManifest } from './config-schema.mjs';
import { renderEdgeNginx } from './edge-nginx.mjs';

const source = await readFile('deploy/examples/development.yaml', 'utf8');
const fixture = () => {
  const value = parseManifest(source);
  value.environment = 'production';
  value.releaseChannel = 'stable';
  value.public = { apiOrigin: 'https://api.materialsx-fixture.org', siteOrigin: 'https://www.materialsx-fixture.org', adminOrigin: 'https://admin.materialsx-fixture.org' };
  value.payment.notifyOrigin = value.public.apiOrigin;
  return value;
};

test('edge has fixed hosts, bounded loopback upstreams and isolated admin entry', () => {
  const { config, adminAllow } = renderEdgeNginx(fixture());
  assert.match(config, /server_name api\.materialsx-fixture\.org;/);
  assert.match(config, /server_name admin\.materialsx-fixture\.org;/);
  assert.match(config, /ssl_reject_handshake on;/);
  assert.match(config, /location \^~ \/v1\/research\/ \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8793;/);
  assert.match(config, /location = \/v1\/model-gateway\/responses \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:8788;/);
  assert.match(config, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(config, /proxy_set_header X-User-ID "";/);
  assert.match(config, /proxy_next_upstream off;/);
  assert.match(config, /proxy_buffering off;/);
  assert.match(config, /if \(\$mx_api_origin_ok = 0\) \{ return 403; \}/);
  assert.match(config, /include \/etc\/materialsx\/edge\/admin-allow\.conf;/);
  assert.equal(adminAllow.trim().endsWith('deny all;'), true);
  assert.doesNotMatch(config, /listen (?:80|8788|8793|8790|4000|4001|5432)(?:\s|;)/);
  assert.doesNotMatch(config, /\$proxy_add_x_forwarded_for|\$http_x_forwarded_host|\$http_x_user_id/);
  assert.doesNotMatch(config, /\$request_uri|\$uri/); // no path or query in access log
  assert.throws(() => renderEdgeNginx(parseManifest(source)), /EDGE_HTTPS_ENVIRONMENT_REQUIRED/);
});

test('existing Nginx mode leaves the other sites default server untouched', () => {
  const { config } = renderEdgeNginx(fixture(), { includeDefaultServer: false });
  assert.doesNotMatch(config, /default_server|ssl_reject_handshake/);
  assert.match(config, /server_name api\.materialsx-fixture\.org;/);
  assert.match(config, /server_name admin\.materialsx-fixture\.org;/);
});

test('edge CLI writes once, redacts invalid manifest and does not embed keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mx-edge-'));
  try {
    const manifest = join(dir, 'prod.yaml');
    const yaml = source.replace('environment: development', 'environment: production')
      .replace('releaseChannel: development', 'releaseChannel: stable')
      .replaceAll('http://127.0.0.1:8788', 'https://api.materialsx-fixture.org')
      .replace('siteOrigin: http://127.0.0.1:4174', 'siteOrigin: https://www.materialsx-fixture.org')
      .replace('adminOrigin: http://127.0.0.1:8790', 'adminOrigin: https://admin.materialsx-fixture.org');
    await writeFile(manifest, yaml);
    const out = join(dir, 'output');
    const command = ['scripts/deployment-edge.mjs', '--manifest', manifest, '--out-dir', out];
    const result = spawnSync(process.execPath, command, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).live, false);
    const rendered = await readFile(join(out, 'materialsx-edge.conf'), 'utf8');
    assert.match(rendered, /location \^~ \/ops\/ \{ return 404; \}/);
    if (process.platform !== 'win32') {
      assert.equal((await stat(out)).mode & 0o777, 0o700);
      assert.equal((await stat(join(out, 'materialsx-edge.conf'))).mode & 0o777, 0o600);
    }
    assert.equal(spawnSync(process.execPath, command, { encoding: 'utf8' }).status, 1);
    const sharedOut = join(dir, 'shared-output');
    const shared = spawnSync(process.execPath,
      ['scripts/deployment-edge.mjs', '--manifest', manifest, '--out-dir', sharedOut, '--existing-nginx'],
      { encoding: 'utf8' });
    assert.equal(shared.status, 0, shared.stderr);
    assert.doesNotMatch(await readFile(join(sharedOut, 'materialsx-edge.conf'), 'utf8'), /default_server/);
    await writeFile(manifest, yaml + '\nsecret: sk-fixture-do-not-print\n');
    const invalid = spawnSync(process.execPath, ['scripts/deployment-edge.mjs', '--manifest', manifest, '--out-dir', join(dir, 'other')], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.doesNotMatch(invalid.stderr, /sk-fixture/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
