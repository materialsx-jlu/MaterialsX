// Real SDK/App Server + isolated M5 PostgreSQL. Opt-in supplier generation; no production wallet writes.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdtemp, mkdir, rm, writeFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { IdentityClient, type CredentialVault } from '../../packages/control-plane-client/src/identity.js';
import { PiPlatformSessionService } from '../../packages/pi-adapter/src/platform-session.js';
import { CodexEngine } from '../../packages/agent/src/codex-engine.js';
import { HostMcp } from '../../packages/agent/src/host-mcp.js';
import { permissionGrantSchema, taskRefSchema } from '../../packages/contracts/src/agent.js';
const live = process.argv.includes('--provider'), directory = resolve('runtime/agent/ua-5');
await mkdir(directory, { recursive: true });
const config = JSON.parse(await readFile(resolve('runtime/m5-local/private-config.json'), 'utf8'));
const database = 'materialsx_ua5_' + randomBytes(6).toString('hex') + '_test';
const dsn = new URL('postgres://mx_local_owner@127.0.0.1:55452/' + database + '?sslmode=disable');
dsn.password = config.ownerPassword;
const env: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: config.ownerPassword, MATERIALSX_ENV: 'development', MATERIALSX_DEV_MODE: '0', MATERIALSX_DATABASE_URL: dsn.href, MATERIALSX_IDENTITY_MASTER_KEY: randomBytes(32).toString('base64'), MATERIALSX_CLOUD_MODE: live ? 'alpha' : 'disabled', MATERIALSX_CLOUD_ROUTE_VERIFIED: live ? '1' : '0', MATERIALSX_PAYMENT_MODE: 'disabled', ROOTFLOWAI_API_KEY: '', ROOTFLOWAI_MODEL: 'gpt-5.6-sol', ROOTFLOWAI_BASE_URL: 'https://api.rootflowai.com/v1', MATERIALSX_METERING_PRICE_VERSION: '', MATERIALSX_PROCUREMENT_PRICE_VERSION: '', MATERIALSX_CLOUD_MAX_REQUESTS: '8', MATERIALSX_CLOUD_MAX_OUTPUT_TOKENS: '1024', MATERIALSX_CLOUD_MAX_DURATION_SECONDS: '120' };
if (live) {
    const path = resolve('runtime/m5-local/paid-cloud.json'), s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) !== 0)
        throw Error('Private supplier profile required');
    const p = JSON.parse(await readFile(path, 'utf8'));
    if (p.model !== 'gpt-5.6-sol' || typeof p.apiKey !== 'string')
        throw Error('Expected reviewed supplier profile');
    env.ROOTFLOWAI_API_KEY = p.apiKey;
}
const psql = '/opt/homebrew/opt/postgresql@16/bin/psql';
const sql = (statement: string) => { const r = spawnSync(psql, ['-h', '127.0.0.1', '-p', '55452', '-U', 'mx_local_owner', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-At'], { env, input: statement, encoding: 'utf8' }); if (r.status !== 0)
    throw Error('Isolated test database operation failed; private output suppressed'); };
const listener = createServer();
await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
const port = (listener.address() as {
    port: number;
}).port;
await new Promise<void>(r => listener.close(() => r()));
const origin = 'http://127.0.0.1:' + port;
env.MATERIALSX_IDENTITY_ADDR = '127.0.0.1:' + port;
env.MATERIALSX_IDENTITY_PUBLIC_URL = origin;
const temp = await mkdtemp(join(tmpdir(), 'mx-ua5-cloud-')), binary = join(temp, 'identity'), email = 'ua5-' + randomBytes(8).toString('hex') + '@example.invalid', password = randomBytes(24).toString('base64url');
let server: ReturnType<typeof spawn> | null = null, engine: CodexEngine | null = null, mcp: HostMcp | null = null, created = false;
const cases: any[] = [];
const go = (args: string[], input?: string) => { const r = spawnSync('go', ['-C', 'services/control-plane', ...args], { env, encoding: 'utf8', ...(input ? { input } : {}) }); if (r.status !== 0)
    throw Error('Gateway fixture initialization failed; private output suppressed'); return r.stdout; };
try {
    sql('CREATE DATABASE ' + database);
    created = true;
    go(['run', './cmd/identityctl', '--command', 'migrate']);
    const accountId = go(['run', './cmd/identityctl', '--command', 'create-user'], JSON.stringify({ email, password, displayName: 'UA.5 synthetic test account' })).match(/id=([A-Za-z0-9_-]+)/)?.[1];
    assert(accountId);
    go(['run', './cmd/identityctl', '--command', 'grant-cloud'], JSON.stringify({ accountId, requestLimit: 24, expiresAt: new Date(Date.now() + 3600000).toISOString() }));
    go(['build', '-o', binary, live ? './cmd/identity' : './internal/gateway/testfixture']);
    server = spawn(binary, [], { env, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) {
        try {
            if ((await fetch(origin + '/health')).ok)
                break;
        }
        catch { }
        if (server.exitCode !== null)
            throw Error('Gateway fixture exited');
        await pause(100);
    }
    let credentials: Awaited<ReturnType<CredentialVault['read']>> = null;
    const vault: CredentialVault = { available: () => true, read: async () => credentials, write: async (v) => { credentials = v; }, clear: async () => { credentials = null; } };
    const client = new IdentityClient(origin, vault, async (authorization) => { const page = await fetch(authorization), html = await page.text(), csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1]; assert(csrf); const r = await fetch(authorization, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, Cookie: page.headers.get('set-cookie')!.split(';')[0]! }, body: new URLSearchParams({ csrf, email, password, approve: 'yes' }) }); assert.equal(r.status, 303); assert.equal((await fetch(r.headers.get('location')!)).status, 200); }, true);
    const account = await client.login();
    assert(account.user);
    const platform = new PiPlatformSessionService(client), catalog = await platform.catalog();
    const selection = { files: [{ id: 'fixture-silicon', name: 'synthetic-silicon.txt', text: 'Synthetic fixture: silicon (Si), atomic number 14. No real research data.', sha256: 'synthetic-fixture' }], skills: [] };
    const prompt = '显示合成硅文本中的原子序数，实际调用 read_material_file，fileId=fixture-silicon，读取本轮批准的合成文本，再用中文说明它的原子序数。不得用既有知识代替实际工具读取，不要其他工具。';
    for (const kind of (process.argv.includes('--cancel-only') ? [] : process.argv.includes('--pi-only') ? ['pi'] : process.argv.includes('--codex-only') ? ['codex'] : ['pi', 'codex']) as Array<'pi' | 'codex'>) {
        const conversation = randomUUID(), start = Date.now();
        let text = '', error = '';
        try {
            if (kind === 'pi')
                text = await platform.prompt(account.user.id, conversation, 'materials-research', prompt, selection, catalog, () => { });
            else {
                const project = join(temp, 'project');
                await mkdir(project, { recursive: true });
                mcp = new HostMcp(selection);
                await mcp.start();
                const task = taskRefSchema.parse({ taskId: randomUUID(), projectId: randomUUID(), conversationId: conversation }), grant = permissionGrantSchema.parse({ grantId: randomUUID(), projectId: task.projectId, conversationId: conversation, permissions: ['read', 'search', 'terminal', 'patch'], approvedBy: 'native-dialog', maxCredits: '100', maxSeconds: 120 });
                text = await platform.native(account.user.id, conversation, selection, catalog, '100', async (invoke) => {
                    engine = new CodexEngine({ home: join(temp, 'codex'), maxOutput: 1024, contextWindow: 32768, invoke: (payload, signal, id) => invoke({ ...payload as object, model: 'materials-research' }, signal, id), mcp: { url: mcp!.url, token: mcp!.token, tools: mcp!.toolNames } });
                    const completion = await engine.run({ task, grant, projectPath: project, content: prompt, onEvent: () => { } });
                    assert(['completed', 'completed_with_limitations'].includes(completion.state));
                    return completion.text;
                }, task.taskId);
            }
            const snapshot = platform.snapshot(conversation);
            assert(snapshot);
            assert.equal(snapshot.task.state, 'completed');
            assert(snapshot.requests.length >= 2);
            assert(snapshot.requests.every(r => r.terminalReceived && r.usage?.inputTokens != null && r.usage.outputTokens != null));
            assert.match(text, /14/);
            cases.push({ engine: kind, passed: true, elapsedMs: Date.now() - start, requests: snapshot.requests.map(r => ({ id: r.id, taskId: r.taskId, routeVersionId: r.routeVersionId, execution: r.execution, settlement: r.settlement, usage: r.usage })), text });
        }
        catch (e) {
            error = e instanceof Error ? e.message : String(e);
            cases.push({ engine: kind, passed: false, error, elapsedMs: Date.now() - start, snapshot: platform.snapshot(conversation) });
            process.exitCode = 1;
        }
        finally {
            await (engine as CodexEngine | null)?.dispose();
            engine = null;
            await mcp?.close();
            mcp = null;
        }
        console.log(JSON.stringify({ engine: kind, passed: !error, elapsedMs: Date.now() - start, error, requests: platform.snapshot(conversation)?.requests.length }));
    }
    // Cancel the genuine request immediately after M5 dispatch; never claim upstream compute was stopped.
    for (const kind of (process.argv.includes('--pi-only') ? ['pi'] : process.argv.includes('--codex-only') ? ['codex'] : ['pi', 'codex']) as Array<'pi' | 'codex'>) {
        const conversation = randomUUID();
        let dispatch!: () => void;
        const started = new Promise<void>(r => dispatch = r);
        const transport = { origin: client.origin, platformRequest: async (path: string, init?: RequestInit) => { const pending = client.platformRequest(path, init); void pending.catch(() => { }); if (path === '/v1/model-gateway/responses') {
                const id = new Headers(init?.headers).get('X-Materialsx-Request-Id');
                let admitted = false;
                for (let i = 0; i < 60; i++) {
                    try {
                        const r = await client.platformRequest('/v1/model-requests/' + id);
                        if (r.ok && (await r.json() as any).dispatched) {
                            admitted = true;
                            break;
                        }
                    }
                    catch { }
                    await pause(50);
                }
                assert(admitted, 'Cancellation must follow real M5 dispatch');
                dispatch();
            } return pending; } };
        const cancelled = new PiPlatformSessionService(transport);
        const p: Promise<string> = kind === 'pi' ? cancelled.prompt(account.user.id, conversation, 'materials-research', 'slow-fixture', { files: [], skills: [] }, catalog, () => { }) : cancelled.native(account.user.id, conversation, { files: [], skills: [] }, catalog, '100', async (invoke) => (await (await invoke({ model: 'materials-research', input: 'slow-fixture', stream: true, store: false, max_output_tokens: 64 }, new AbortController().signal)).text()));
        const result: Promise<boolean> = p.then(() => false, () => true);
        await started;
        cancelled.cancel(conversation);
        assert(await result);
        cases.push({ engine: kind, cancellation: true, localAbort: true, upstreamComputeStopped: 'unconfirmed', snapshot: cancelled.snapshot(conversation), serverRequests: await (await client.platformRequest('/v1/tasks/' + cancelled.snapshot(conversation)!.task.id + '/requests')).json() });
    }
    await client.logout();
}
catch (e) {
    cases.push({ setupError: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
}
finally {
    await (engine as CodexEngine | null)?.dispose();
    await mcp?.close();
    env.ROOTFLOWAI_API_KEY = '';
    if (server && server.exitCode === null) {
        server.kill('SIGTERM');
        await new Promise<void>(r => server!.once('exit', () => r()));
    }
    if (created)
        sql('DROP DATABASE ' + database);
    await rm(temp, { recursive: true, force: true });
    await writeFile(join(directory, (live ? 'platform-live-' : 'platform-fixture-') + Date.now() + '.json'), JSON.stringify({ stage: 'UA.5', mode: live ? 'real-rootflowai' : 'synthetic-provider-real-postgres', scientificAccuracyValidated: false, productionPayments: 0, productionWalletMutations: 0, cases }, null, 2) + '\n', { mode: 0o600 });
    const name = (live ? 'platform-live-' : 'platform-fixture-');
    const files = (await import('node:fs/promises')).readdir;
    const latest = (await files(directory)).filter(p => p.startsWith(name)).sort().at(-1)!;
    await writeFile(join(directory, process.argv.includes('--cancel-only') ? 'platform-cancel.json' : live ? 'platform-live.json' : 'platform-fixture.json'), await readFile(join(directory, latest)), { mode: 0o600 });
}
