import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from './store.js';
import { ResearchService } from './research-service.js';
import { TaskSupervisor } from '../../../packages/agent/src/task-supervisor.js';
import { campaignTask as task } from '../../../tests/fixtures/agent/ua11-task.js';
import { supervisionStore } from './agent-supervision-store.js';
import { requireRecoverable, recoveryDeadline } from './agent-recovery.js';
import { HostMcp } from '../../../packages/agent/src/host-mcp.js';
import { PiLocalSessionService } from '../../../packages/pi-adapter/src/local-session.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const local = process.platform === 'darwin';
async function setup() {
    const temp = await mkdtemp(join(tmpdir(), 'ua11-')), store = new WorkspaceStore(join(temp, 'db.sqlite')), p = store.createProject(temp), service = new ResearchService(store, { client: null, assetRoot: process.cwd(), jobStateRoot: join(temp, 'private-jobs') });
    return { temp, store, p, service, close: async () => { for (const j of service.campaigns.overview(p.id).jobs)
            if (['queued', 'running', 'unknown'].includes(j.status)) {
                await service.campaigns.cancel(p.id, j.id);
                await settle(service, p.id, j.id).catch(() => { });
            } store.close(); await rm(temp, { recursive: true, force: true }); } };
}
async function submit(s: Awaited<ReturnType<typeof setup>>, t: ReturnType<typeof task>, id: string) {
    const args = { action: 'submit', configurationId: id, reason: 'Actual detached reference' };
    t.control.beforeTool({ id: randomUUID(), name: 'campaign_job', args, permissions: t.context.grant.permissions });
    const attempt = t.control.snapshot().attempts.at(-1)!;
    const result = await s.service.campaigns.tool(s.p.id, t.run.id, args);
    t.control.afterTool(attempt.id, { content: [{ type: 'text', text: JSON.stringify(result) }] }, false);
    return (result as any).job;
}
async function settle(service: ResearchService, project: string, id: string) { const end = Date.now() + 12000; let job; do {
    job = await service.campaigns.query(project, id);
    if (['completed', 'failed', 'cancelled'].includes(job.status))
        return job;
    if (job.status === 'unknown')
        throw Error(job.error ?? 'Unknown job');
    await new Promise(r => setTimeout(r, 100));
} while (Date.now() < end); throw Error('JOB_DID_NOT_TERMINATE: ' + JSON.stringify(job)); }
const input = { label: 'test', script: 'run.mjs', inputs: [], outputs: ['result.json'], args: [], maxComputeSeconds: 4, maxElapsedSeconds: 172800, heapMiB: 128, maxOutputMiB: 1, detachApproved: true, pauseModelWhileComputing: true };
test('detached worker survives store/service restart; recovery queries real original job and publishes hash-verified reference files once', { skip: !local }, async () => {
    const s = await setup();
    try {
        const c = await s.service.campaigns.installExample(s.p.id), t = task(s, c.id), job = await submit(s, t, c.id);
        assert.equal(job.status, 'queued');
        assert.equal(s.service.campaigns.overview(s.p.id).jobs.length, 1);
        assert.throws(() => t.control.beforeTool({ id: 'again', name: 'campaign_job', args: { action: 'submit', configurationId: c.id, reason: 'same identity' }, permissions: t.context.grant.permissions }), /在途计算/);
        assert(t.control.canWaitForJobs());
        const requests = t.control.snapshot().requests.length;
        assert.throws(() => t.control.beforeRequest({ messages: [] }, 'execute', 32768, 100), /COMPUTATION_PENDING/);
        assert.equal(t.control.snapshot().requests.length, requests);
        t.control.finish('completed_with_limitations');
        assert.equal(t.control.snapshot().state, 'waiting');
        const before = t.control.snapshot();
        assert.throws(() => requireRecoverable(before), /先查询回执/);
        s.store.updateRun(t.run.id, 'waiting');
        s.store.close();
        const reopened = new WorkspaceStore(join(s.temp, 'db.sqlite')), service = new ResearchService(reopened, { client: null, assetRoot: process.cwd(), jobStateRoot: join(s.temp, 'private-jobs') });
        try {
            assert.equal(reopened.agentJournal.read(t.run.id)?.state, 'waiting');
            const done = await settle(service, s.p.id, job.id);
            assert.equal(done.status, 'completed');
            assert.equal(done.worker?.exitCode, 0);
            assert(done.worker?.pid);
            assert.equal(done.artifacts.length, 5);
            const a = done.artifacts.find(a => a.path.endsWith('reference-result.json'))!, data = JSON.parse(await service.campaigns.preview(s.p.id, done.id, a.path));
            assert.equal(data.rows, 36);
            assert.equal(data.domainValidated, false);
            assert(data.checks.every((c: any) => c.error < 1e-10));
            assert.deepEqual(await service.campaigns.query(s.p.id, job.id), done);
            assert.equal(service.campaigns.overview(s.p.id).jobs.length, 1);
            const current = reopened.agentJournal.read(t.run.id)!;
            const resumed = new TaskSupervisor({ context: t.context, engine: 'pi', connectionId: 'fixture', accountRef: 'local', projectPath: s.temp, previous: current, previousPlan: reopened.researchPlan(t.run.id)!, resolveArtifact: (step, name) => service.campaigns.resolveArtifact(t.run.id, step, name), ...supervisionStore(reopened, t.run.id) });
            resumed.reconcileJobs([{ id: job.id, state: done.status }]);
            requireRecoverable(resumed.snapshot());
            resumed.resume();
            assert.equal(resumed.snapshot().requests.length, before.requests.length);
            assert.equal(resumed.snapshot().grant.maxSeconds, before.grant.maxSeconds);
            await resumed.verifyBackendSteps();
            resumed.finish('completed_with_limitations');
            assert.equal(resumed.snapshot().state, 'completed_with_limitations');
            await writeFile(join(s.temp, a.path), 'tampered');
            assert.equal((await service.campaigns.query(s.p.id, job.id)).status, 'unknown');
            await assert.rejects(service.campaigns.preview(s.p.id, job.id, a.path), /NOT_VERIFIED/);
        }
        finally {
            reopened.close();
        }
    }
    finally {
        await rm(s.temp, { recursive: true, force: true });
    }
});
test('only approved frozen owned inputs and supervised attempts may launch; changed inputs and unbound new configurations never launch', { skip: !local }, async () => {
    const s = await setup();
    try {
        await writeFile(join(s.temp, 'run.mjs'), "import{writeFileSync}from'node:fs';writeFileSync('result.json','{}');");
        const c = await s.service.campaigns.configure(s.p.id, input), t = task(s, c.id);
        await assert.rejects(s.service.campaigns.submit(s.p.id, t.run.id, c.id), /SUPERVISED|AUTHORIZED/);
        await writeFile(join(s.temp, 'run.mjs'), 'changed');
        t.control.beforeTool({ id: 'changed', name: 'campaign_job', args: { action: 'submit' }, permissions: t.context.grant.permissions });
        await assert.rejects(s.service.campaigns.submit(s.p.id, t.run.id, c.id), /CHANGED/);
        assert.equal(s.service.campaigns.overview(s.p.id).jobs.length, 0);
        await symlink(join(s.temp, 'run.mjs'), join(s.temp, 'alias.mjs'));
        await assert.rejects(s.service.campaigns.configure(s.p.id, { ...input, script: 'alias.mjs' }), /SYMLINK/);
        await assert.rejects(s.service.campaigns.configure(s.p.id, { ...input, inputs: ['../secrets.json'] }), /NOT_ALLOWED/);
        await assert.rejects(s.service.campaigns.configure(s.p.id, { ...input, outputs: ['job-summary.json'] }), /INVALID/);
        await assert.rejects(s.service.campaigns.configure(s.p.id, { ...input, detachApproved: false }));
        const c2 = await s.service.campaigns.configure(s.p.id, { ...input, label: 'new' });
        assert(!s.service.campaigns.inputs(t.run.id).some(c => c.id === c2.id));
    }
    finally {
        await s.close();
    }
});
test('actual worker fails closed for missing files, timeout, excessive logs, escape attempts, cancellation and output symlinks', { skip: !local }, async () => {
    for (const [name, code, seconds, expected, cancel] of [
        ['missing', "console.log('no output');", 2, 'failed', false],
        ['timeout', 'setInterval(()=>{},100);', 1, 'failed', false],
        ['logs', "console.log('x'.repeat(600000));setInterval(()=>{},100);", 3, 'failed', false],
        ['escape', "import{writeFileSync}from'node:fs';writeFileSync('../receipt.json','forged');", 3, 'failed', false],
        ['cancel', 'setInterval(()=>{},100);', 4, 'cancelled', true],
        ['symlink', "import{symlinkSync}from'node:fs';symlinkSync('run.mjs','result.json');", 3, 'failed', false],
    ] as const) {
        const s = await setup();
        try {
            await writeFile(join(s.temp, 'run.mjs'), code);
            const c = await s.service.campaigns.configure(s.p.id, { ...input, label: name, maxComputeSeconds: seconds }), t = task(s, c.id), j = await submit(s, t, c.id);
            if (cancel)
                await s.service.campaigns.cancel(s.p.id, j.id);
            const done = await settle(s.service, s.p.id, j.id);
            assert.equal(done.status, expected, name + ': ' + done.error + ' stderr=' + await readFile(join(s.temp, 'private-jobs', j.id, 'stderr.txt'), 'utf8'));
            assert.equal(done.artifacts.length, 0);
            assert.equal(done.cost.platformCharged, '0');
            const logs = await s.service.campaigns.logs(s.p.id, j.id);
            assert.equal(typeof logs.stderr, 'string');
        }
        finally {
            await s.close();
        }
    }
});
test('real Pi host tools and Codex MCP share campaign submission, supervisor receipts and frozen inputs', { skip: !local }, async () => {
    const s = await setup(), client = new Client({ name: 'ua11-test', version: '1' });
    let pi: PiLocalSessionService | undefined, mcp: HostMcp | undefined;
    try {
        const c = await s.service.campaigns.installExample(s.p.id), t = task(s, c.id);
        pi = new PiLocalSessionService(process.cwd(), s.temp, (_p, id) => s.service.tools(s.p.id, id));
        assert(!(await pi.hostTools(s.temp, t.conversation.id, ['read'])).some(t => t.name === 'campaign_job'));
        const tools = await pi.hostTools(s.temp, t.conversation.id, t.context.grant.permissions);
        mcp = new HostMcp({ files: [], skills: [] }, undefined, { tools, permissions: t.context.grant.permissions, signal: new AbortController().signal }, t.control);
        await mcp.start();
        await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url), { requestInit: { headers: { Authorization: 'Bearer ' + mcp.token } } }) as any);
        const call = async (args: Record<string, unknown>) => { const raw = await client.callTool({ name: 'campaign_job', arguments: args }); assert(!raw.isError, JSON.stringify(raw.content)); return JSON.parse((raw.content as Array<{
            text: string;
        }>)[0]!.text); };
        const choices = await call({ action: 'inputs' });
        assert.equal(choices.configurations[0].id, c.id);
        const result = await call({ action: 'submit', configurationId: c.id, reason: 'Actual shared provider' });
        assert.equal(result.job.status, 'queued');
        t.control.finish('completed_with_limitations');
        assert.equal(t.control.snapshot().state, 'waiting');
        const done = await settle(s.service, s.p.id, result.job.id);
        assert.equal(done.status, 'completed');
        assert.equal(s.service.campaigns.overview(s.p.id).jobs.length, 1);
    }
    finally {
        await client.close();
        await mcp?.close();
        pi?.dispose();
        await s.close();
    }
});
test('waiting recovery uses approved elapsed cap and remaining active time; normal expired tasks cannot extend budgets', () => {
    const now = Date.now(), state = { state: 'waiting', deadline: now - 86400000, waiting: { campaignId: randomUUID(), startedAt: now - 86400000, until: now + 100000, remainingActiveMs: 12000 }, attempts: [], requests: [], accountRef: 'local' } as any;
    assert.equal(recoveryDeadline(state, now), now + 12000);
    assert.doesNotThrow(() => requireRecoverable(state));
    assert.throws(() => requireRecoverable({ ...state, state: 'interrupted', waiting: undefined }), /时间预算/);
    assert.throws(() => requireRecoverable({ ...state, waiting: { ...state.waiting, until: now - 1 } }), /时间预算/);
});
test('global local worker capacity and forged terminal receipts cannot launch extra jobs or certify completion', { skip: !local }, async () => {
    const s = await setup();
    try {
        await writeFile(join(s.temp, 'run.mjs'), "import{writeFileSync}from'node:fs';await new Promise(r=>setTimeout(r,1500));writeFileSync('result.json','{}');");
        const c = await s.service.campaigns.configure(s.p.id, input), one = task(s, c.id), two = task(s, c.id), third = task(s, c.id), j = await submit(s, one, c.id);
        await submit(s, two, c.id);
        third.control.beforeTool({ id: 'capacity', name: 'campaign_job', args: { action: 'submit' }, permissions: third.context.grant.permissions });
        await assert.rejects(s.service.campaigns.submit(s.p.id, third.run.id, c.id), /CAPACITY/);
        third.control.afterTool('capacity', { error: 'Actual capacity rejection' }, true);
        assert.equal(s.service.campaigns.overview(s.p.id).jobs.length, 2);
        const done = await settle(s.service, s.p.id, j.id);
        assert.equal(done.status, 'completed');
        one.control.reconcileJobs([{ id: j.id, state: 'completed' }]);
        one.control.beforeTool({ id: 'repeat', name: 'campaign_job', args: { action: 'submit', configurationId: c.id, reason: 'Reuse original identity' }, permissions: one.context.grant.permissions });
        const original = await s.service.campaigns.submit(s.p.id, one.run.id, c.id);
        one.control.afterTool('repeat', { job: original }, false);
        assert.equal(original.id, j.id);
        assert.equal(s.service.campaigns.overview(s.p.id).jobs.length, 2);
        const receiptPath = join(s.temp, 'private-jobs', j.id, 'receipt.json'), receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
        receipt.nonce = '0'.repeat(64);
        await writeFile(receiptPath, JSON.stringify(receipt));
        const unknown = await s.service.campaigns.query(s.p.id, j.id);
        assert.equal(unknown.status, 'unknown');
        assert.match(unknown.error!, /RECEIPT/);
        await assert.rejects(s.service.campaigns.preview(s.p.id, j.id, done.artifacts[0]!.path), /NOT_VERIFIED/);
        assert.equal(s.service.campaigns.overview(s.p.id).jobs.length, 2);
    }
    finally {
        await s.close();
    }
});

test('a real submitting parent exits before computation finishes; a new process can query and collect the original detached worker',{skip:!local},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ua11-parent-'));let store:WorkspaceStore|undefined;
 try{const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','tests/fixtures/agent/ua11-detached-parent.ts',directory],{cwd:process.cwd(),timeout:12000,maxBuffer:65536});
 const data=JSON.parse(stdout);assert.throws(()=>process.kill(data.parentPid,0));store=new WorkspaceStore(join(directory,'db.sqlite'));const service=new ResearchService(store,{client:null,assetRoot:process.cwd(),jobStateRoot:join(directory,'private-jobs')});assert.equal(store.agentJournal.read(data.taskId)?.state,'waiting');
 const job=await settle(service,data.projectId,data.jobId);assert.equal(job.status,'completed');assert.notEqual(job.worker?.workerPid,data.parentPid);assert.equal(job.artifacts.length,5);assert.equal(service.campaigns.overview(data.projectId).jobs.length,1);
 }finally{store?.close();await rm(directory,{recursive:true,force:true});}
});
