import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMoosLinkClient, createMoosLinkServer, permittedMoosRoute } from './moos-link.mjs';

function certificateSet(dir) {
  const openssl = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-noenc', '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=MX test CA', '-days', '1');
  for (const [name, subject, ext] of [
    ['server', '/CN=moos.private.test', 'subjectAltName=DNS:moos.private.test\nextendedKeyUsage=serverAuth'],
    ['client', '/CN=mx-team', 'extendedKeyUsage=clientAuth'],
  ]) {
    openssl('req', '-newkey', 'rsa:2048', '-noenc', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', subject);
    writeFileSync(join(dir, `${name}.ext`), ext);
    openssl('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.pem`, '-days', '1', '-extfile', `${name}.ext`);
  }
  const read = name => readFileSync(join(dir, name));
  return { ca: read('ca.pem'), serverCert: read('server.pem'), serverKey: read('server.key'),
    clientCert: read('client.pem'), clientKey: read('client.key'),
    fingerprint: new X509Certificate(read('client.pem')).fingerprint256.replaceAll(':', '').toLowerCase() };
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

test('mTLS MOOS link allows scoped adapter routes and rejects arbitrary API or raw files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mx-moos-link-'));
  const services = [];
  try {
    const keys = certificateSet(dir);
    const seen = [];
    const backend = http.createServer(async (req, res) => {
      const body = [];
      for await (const chunk of req) body.push(chunk);
      seen.push({ path: req.url, method: req.method, auth: req.headers.authorization,
        body: Buffer.concat(body).toString() });
      if (req.url === '/api/knowledge/records/99') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ components: ['water', 'binder'], steps: ['mix'], evidencePage: 3 }));
      } else if (req.url === '/api/knowledge/search') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"items":[{"id":99}]}');
      } else if (req.url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
      } else { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); }
    });
    services.push(backend);
    const backendPort = await listen(backend);
    const server = createMoosLinkServer({ ca: keys.ca, cert: keys.serverCert, key: keys.serverKey,
      clientFingerprint: keys.fingerprint, upstreamPort: backendPort });
    services.push(server);
    const serverPort = await listen(server);
    const client = createMoosLinkClient({ ca: keys.ca, cert: keys.clientCert, key: keys.clientKey,
      serverName: 'moos.private.test', remoteHost: '127.0.0.1', remotePort: serverPort });
    services.push(client);
    const local = `http://127.0.0.1:${await listen(client)}`;
    const record = await fetch(`${local}/api/knowledge/records/99`, { headers: { authorization: 'forged-user-token' } });
    assert.equal(record.status, 200);
    assert.equal((await record.json()).evidencePage, 3);
    const search = await fetch(`${local}/api/knowledge/search`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'precise', query: 'water' }) });
    assert.equal(search.status, 200);
    assert.equal((await search.json()).items[0].id, 99);
    const broad = await fetch(`${local}/api/knowledge/search`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'broad', query: 'water' }) });
    assert.equal(broad.status, 403);
    const oversized = await fetch(`${local}/api/knowledge/search`, { method: 'POST',
      body: JSON.stringify({ mode: 'precise', query: 'x'.repeat(130 * 1024) }) });
    assert.equal(oversized.status, 413);
    for (const path of ['/api/assets/12/content', '/api/admin/users', '/api/knowledge/../admin', '/api/knowledge/%2e%2e/admin']) {
      const response = await fetch(local + path);
      assert.equal(response.status, 404, path);
    }
    assert.deepEqual(seen.map(item => item.path), ['/api/knowledge/records/99', '/api/knowledge/search']);
    assert.equal(seen[0].auth, undefined);
    const noCert = await new Promise(resolve => {
      const req = https.get({ hostname: '127.0.0.1', port: serverPort, path: '/api/health',
        ca: keys.ca, servername: 'moos.private.test' }, resolve);
      req.on('error', error => resolve(error));
    });
    assert.ok(noCert instanceof Error);
    const wrongFingerprint = createMoosLinkServer({ ca: keys.ca, cert: keys.serverCert, key: keys.serverKey,
      clientFingerprint: '0'.repeat(64), upstreamPort: backendPort });
    services.push(wrongFingerprint);
    const pinPort = await listen(wrongFingerprint);
    const pinResponse = await new Promise((resolve, reject) => {
      const request = https.get({ hostname: '127.0.0.1', port: pinPort, path: '/api/health',
        ca: keys.ca, cert: keys.clientCert, key: keys.clientKey, servername: 'moos.private.test' }, resolve);
      request.on('error', reject);
    });
    assert.equal(pinResponse.statusCode, 403);
    pinResponse.resume();
    const wrongName = createMoosLinkClient({ ca: keys.ca, cert: keys.clientCert, key: keys.clientKey,
      serverName: 'other.private.test', remoteHost: '127.0.0.1', remotePort: serverPort });
    services.push(wrongName);
    assert.equal((await fetch(`http://127.0.0.1:${await listen(wrongName)}/api/health`)).status, 502);
  } finally {
    for (const service of services.reverse()) if (service.listening) await close(service);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('route allowlist rejects original binary assets and path normalization', () => {
  assert.equal(permittedMoosRoute('GET', '/api/knowledge/evidence/abc%20def'), true);
  assert.equal(permittedMoosRoute('GET', '/api/assets/1/content'), false);
  assert.equal(permittedMoosRoute('PUT', '/api/knowledge/records/1'), false);
  assert.equal(permittedMoosRoute('GET', '//api/health'), false);
  assert.equal(permittedMoosRoute('GET', '/api/knowledge/%2e%2e/health'), false);
});

test('live MOOS recipe read crosses the encrypted link and retains project scope',
  { skip: process.env.MATERIALSX_TEST_LIVE_MOOS !== '1' }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mx-moos-link-live-'));
    const services = [];
    try {
      const keys = certificateSet(dir);
      const server = createMoosLinkServer({ ca: keys.ca, cert: keys.serverCert, key: keys.serverKey,
        clientFingerprint: keys.fingerprint, upstreamPort: 8080 });
      services.push(server);
      const serverPort = await listen(server);
      const client = createMoosLinkClient({ ca: keys.ca, cert: keys.clientCert, key: keys.clientKey,
        serverName: 'moos.private.test', remoteHost: '127.0.0.1', remotePort: serverPort });
      services.push(client);
      const localPort = await listen(client);
      const output = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/agent/ua13-moos-live.ts'], {
          cwd: process.cwd(), env: { ...process.env, MATERIALSX_MOOS_ORIGIN: `http://127.0.0.1:${localPort}` },
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk.toString().slice(0, 4096); });
        child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 4096); });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve(stdout) : reject(Error(`MOOS_LINK_LIVE_FAILED: ${stderr.slice(0, 500)}`)));
      });
      const receipt = JSON.parse(output.trim().split('\n').at(-1));
      assert.equal(receipt.passed, true);
      assert.equal(receipt.crossScopeDenied, true);
      assert.equal(receipt.externalModelCalls, 0);
      assert.ok(['pending_review', 'verified'].includes(receipt.reviewStatus));
      for (const section of ['recipes', 'ingredients', 'processes', 'evidence'])
        assert.ok(receipt.recipeSectionCounts[section] > 0, section);
      assert.ok(receipt.evidencePdfPage > 0);
    } finally {
      for (const service of services.reverse()) if (service.listening) await close(service);
      rmSync(dir, { recursive: true, force: true });
    }
  });
