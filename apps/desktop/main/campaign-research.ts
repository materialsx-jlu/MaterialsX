import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { longJobConfigInput, longJobSchema, workerReceipt, campaignToolInput, type LongJob, type LongJobConfig, type CampaignOverview } from '../../../packages/contracts/src/campaigns.js';
import { readOwnedBytes, hashOwnedFile } from '../../../packages/atomistic/src/artifact-io.js';
import { hash, canonical, atomicJson, ownedText, safeDirectory } from '../../../packages/atomistic/src/discovery-io.js';
import { codexSandbox } from '../../../packages/agent/src/codex-sandbox.js';
import { writeScientificFiles } from '../../../packages/agent/src/scientific-artifacts.js';
import type { WorkspaceStore } from './store.js';
import type { TaskExecution } from '../../../packages/contracts/src/task-execution.js';
const terminal = new Set(['completed', 'failed', 'cancelled']);
const reserved = new Set(['job-summary.json', 'job-report.md', 'stdout.txt', 'stderr.txt']);
/** One durable local computation provider behind the existing research journal; no model execution or billing loop. */
export class CampaignResearch {
    private operations = new Map<string, Promise<LongJob>>();
    constructor(private store: WorkspaceStore, readonly root: string, readonly stateRoot: string) { }
    private project(id: string) { const p = this.store.getProject(id); if (!p)
        throw Error('PROJECT_NOT_OWNED'); return p; }
    private directory(id: string) { return safeDirectory(this.stateRoot, id); }
    async selectFile(projectId: string, path: string) { const root = await realpath(this.project(projectId).path), p = relative(root, resolve(path)); await this.file(root, p); return p; }
    private async file(root: string, path: string) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/.test(path) || path.split('/').some(p => ['..', '.', ''].includes(p)) || /(?:^|\/)(?:\.env[^/]*|auth\.json|credentials\.json|id_rsa|id_ed25519)|\.(?:pem|key|p12|pfx)$/i.test(path))
            throw Error('JOB_INPUT_PATH_NOT_ALLOWED');
        const bytes = await readOwnedBytes(root, join(root, path), null, 8 * 1048576);
        return { path, sha256: hash(bytes), bytes: bytes.length };
    }
    async configure(projectId: string, input: unknown) {
        const q = longJobConfigInput.parse(input), root = await realpath(this.project(projectId).path);
        if (!/\.(?:mjs|js)$/.test(q.script) || new Set([q.script, ...q.inputs]).size !== q.inputs.length + 1 || new Set(q.outputs).size !== q.outputs.length || q.outputs.some(n => reserved.has(n)))
            throw Error('JOB_FILES_INVALID');
        const files = [];
        for (const p of [q.script, ...q.inputs])
            files.push(await this.file(root, p));
        if (files.reduce((n, f) => n + f.bytes, 0) > 24 * 1048576)
            throw Error('JOB_INPUT_SIZE_LIMIT');
        const previous = this.store.research.longJobConfigurations(projectId).reduce((n, c) => Math.max(n, Date.parse(c.createdAt)), 0);
        const value = { id: randomUUID(), projectId, createdAt: new Date(Math.max(Date.now(), previous + 1)).toISOString(), input: q, files };
        return this.store.research.saveLongJobConfiguration({ ...value, sha256: hash(canonical(value)) });
    }
    frozenInputs(projectId: string) {
        const latest = new Map<string, LongJobConfig>();
        for (const c of this.store.research.longJobConfigurations(projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
            latest.set(c.input.label, c);
        return [...latest.values()].map(c => ({ id: 'long-job-config:' + c.id, version: c.createdAt, sha256: c.sha256 }));
    }
    inputs(taskId: string) { const b = this.store.research.binding(taskId); if (!b)
        throw Error('RESEARCH_BINDING_MISSING'); return this.store.research.longJobConfigurations(b.projectId).filter(c => b.approvedInputs.some(p => p.id === 'long-job-config:' + c.id && p.sha256 === c.sha256 && p.version === c.createdAt)); }
    overview(projectId: string): CampaignOverview {
        this.project(projectId);
        const jobs = this.store.research.longJobs(projectId), now = Date.now(), tasks = new Set(jobs.map(j => j.taskId));
        return { configurations: this.store.research.longJobConfigurations(projectId), campaigns: this.store.research.campaigns(projectId), jobs, providerAvailable: process.platform === 'darwin', timings: { downloadMs: 0,
                queueMs: jobs.reduce((n, j) => n + (j.worker ? Math.max(0, (j.worker.startedAt ?? j.worker.finishedAt ?? now) - j.worker.createdAt) : 0), 0),
                computeMs: jobs.reduce((n, j) => n + (j.worker?.startedAt ? Math.max(0, (j.worker.finishedAt ?? now) - j.worker.startedAt) : 0), 0),
                modelMs: [...tasks].reduce((n, id) => n + (this.store.agentJournal.read(id)?.requests.reduce((m, r) => m + (r.endedAt ? Math.max(0, r.endedAt - r.startedAt) : 0), 0) ?? 0), 0),
                waitingMs: [...tasks].reduce((n, id) => { const s = this.store.agentJournal.read(id); return n + (s?.waitingMs ?? 0) + (s?.waiting ? Math.max(0, Math.min(now, s.waiting.until) - s.waiting.startedAt) : 0); }, 0) } };
    }
    private owned(projectId: string, id: string) { this.project(projectId); const j = this.store.research.longJobs(projectId).find(j => j.id === id); if (!j)
        throw Error('JOB_NOT_OWNED'); return j; }
    private async single(key: string, fn: () => Promise<LongJob>) { const old = this.operations.get(key); if (old)
        return old; const operation = fn(); this.operations.set(key, operation); try {
        return await operation;
    }
    finally {
        this.operations.delete(key);
    } }
    async tool(projectId: string, taskId: string, input: unknown) {
        const q = campaignToolInput.parse(input);
        if (q.action === 'inputs')
            return { configurations: this.inputs(taskId), provider: 'local-node', scientificStatus: 'needs_review' };
        if (q.action === 'submit') {
            if (!q.configurationId || !q.reason?.trim())
                throw Error('CONFIGURATION_AND_REASON_REQUIRED');
            const job = await this.submit(projectId, taskId, q.configurationId);
            return { job, reason: q.reason, waiting: !terminal.has(job.status), instruction: 'Pending is not completion. End this model turn; query the original job before resuming. Never resubmit.' };
        }
        if (!q.jobId || this.owned(projectId, q.jobId).taskId !== taskId)
            throw Error('JOB_NOT_OWNED_BY_TASK');
        const job = q.action === 'cancel' ? await this.cancel(projectId, q.jobId) : await this.query(projectId, q.jobId);
        return { job, ...(terminal.has(job.status) ? { logs: await this.logs(projectId, q.jobId) } : {}) };
    }
    async submit(projectId: string, taskId: string, configurationId: string) {
        return this.single('submit:' + taskId, async () => {
            if (process.platform !== 'darwin')
                throw Error('LOCAL_LONG_JOB_PLATFORM_NOT_QUALIFIED');
            const state = this.store.agentJournal.read(taskId), plan = this.store.researchPlan(taskId), c = this.inputs(taskId).find(c => c.id === configurationId);
            if (!c || !state || state.task.projectId !== projectId || state.state !== 'running' || state.accountRef !== 'local' || !state.activeStepId || !plan || plan.planRevision !== state.planRevision || state.deadline <= Date.now() || !['read', 'patch', 'terminal', 'science'].every(p => state.grant.permissions.includes(p as any)))
                throw Error('JOB_NOT_FROZEN_OR_AUTHORIZED');
            const admitted = state.attempts.some(a => a.method === 'campaign_job' && a.stepId === state.activeStepId && a.planRevision === state.planRevision && a.state === 'running');
            if (!admitted)
                throw Error('JOB_REQUIRES_SUPERVISED_TOOL_ATTEMPT');
            const old = this.store.research.longJobs(projectId).find(j => j.taskId === taskId && j.stepId === state.activeStepId && j.configurationId === c.id);
            if (old)
                return this.query(projectId, old.id);
            if (this.store.listProjects().flatMap(p => this.store.research.longJobs(p.id)).filter(j => ['prepared', 'queued', 'running'].includes(j.status) || j.status === 'unknown' && !terminal.has(j.worker?.status ?? 'unknown')).length >= 2)
                throw Error('LOCAL_JOB_CAPACITY: query or cancel existing jobs first');
            const campaign = this.store.research.campaigns(projectId).find(c => c.taskId === taskId), now = Date.now(), until = campaign?.elapsedUntil ?? now + c.input.maxElapsedSeconds * 1000;
            if (until <= now || (campaign?.jobIds.length ?? 0) >= 32)
                throw Error('CAMPAIGN_LIMIT_REACHED');
            const root = await realpath(this.project(projectId).path), bytes = [];
            for (const f of c.files)
                bytes.push({ path: f.path, body: await readOwnedBytes(root, join(root, f.path), f.sha256, 8 * 1048576) });
            const id = randomUUID(), directory = this.directory(id), workspace = safeDirectory(directory, 'work'), home = safeDirectory(directory, 'home');
            for (const f of bytes) {
                const path = join(workspace, f.path);
                await mkdir(resolve(path, '..'), { recursive: true });
                await writeFile(path, f.body, { flag: 'wx', mode: 0o600 });
            }
            const sandbox = await codexSandbox(process.execPath, home, workspace), nonce = randomBytes(32).toString('hex');
            const workerPath = join(this.root, 'experiments/local-job-worker.mjs'), providerSha256 = hash(await readOwnedBytes(this.root, workerPath, null, 8 * 1048576)), binary = await realpath(process.execPath), runtimeBinarySha256 = (await hashOwnedFile(dirname(binary), binary, null, 512 * 1048576)).sha256;
            const packet = { elapsedUntil: until, providerSha256, runtimeBinarySha256, version: 'ua11-local-v1', jobId: id, nonce, command: sandbox.command, args: [...sandbox.args.slice(0, -2).map(arg => arg.replace('(allow network-inbound (local ip \"localhost:*\"))', '')), '--max-old-space-size=' + c.input.heapMiB, join(workspace, c.input.script), ...c.input.args], workspace,
                outputs: c.input.outputs, maxOutputMiB: c.input.maxOutputMiB, maxComputeSeconds: Math.max(1, Math.min(c.input.maxComputeSeconds, Math.floor((until - now) / 1000))),
                environment: { ELECTRON_RUN_AS_NODE: '1', OPENSSL_CONF: '/dev/null', HOME: home, TMPDIR: join(home, 'tmp'), PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } };
            atomicJson(directory, 'packet.json', packet);
            const manifestSha256 = hash(ownedText(join(directory, 'packet.json')));
            const job = longJobSchema.parse({ id, projectId, taskId, stepId: state.activeStepId, planRevision: state.planRevision, configurationId: c.id, configurationSha256: c.sha256, provider: 'local-node', createdAt: new Date(now).toISOString(), elapsedUntil: until, status: 'prepared', manifestSha256, nonce, worker: null, artifacts: [], error: null, scientificStatus: 'needs_review', cost: { currency: 'CNY', platformCharged: '0', externalActual: null, basis: 'offline-local-compute' } });
            // Journal the identity BEFORE spawning. A crash here remains unknown, never an automatic resubmission.
            this.store.research.createCampaignJob(job, campaign ?? { id: randomUUID(), taskId, projectId, createdAt: job.createdAt, elapsedUntil: until, jobIds: [] });
            const child = spawn(process.execPath, [workerPath, join(directory, 'packet.json')], { cwd: directory, detached: true, stdio: 'ignore', env: packet.environment });
            const spawned = await new Promise<boolean>(resolve => { child.once('spawn', () => resolve(true)); child.once('error', () => resolve(false)); });
            child.unref();
            const next = { ...job, status: spawned ? 'queued' as const : 'unknown' as const, error: spawned ? null : 'WORKER_DISPATCH_NOT_CONFIRMED' };
            this.store.research.saveLongJob(next, job);
            return next;
        });
    }
    async query(projectId: string, id: string) {
        return this.single('query:' + id, async () => {
            const old = this.owned(projectId, id), dir = this.directory(id);
            let next = old;
            try {
                if (hash(ownedText(join(dir, 'packet.json'))) !== old.manifestSha256)
                    throw Error('JOB_PACKET_CHANGED');
                if (!existsSync(join(dir, 'receipt.json'))) {
                    if (Date.now() - Date.parse(old.createdAt) > 30000 || Date.now() >= old.elapsedUntil)
                        throw Error('WORKER_RECEIPT_MISSING_QUERY_ONLY');
                    return old;
                }
                const receipt = workerReceipt.parse(JSON.parse(ownedText(join(dir, 'receipt.json'), 65536)));
                if (receipt.jobId !== id || receipt.nonce !== old.nonce || receipt.manifestSha256 !== old.manifestSha256 || receipt.createdAt < Date.parse(old.createdAt) || receipt.startedAt !== null && receipt.startedAt < receipt.createdAt || receipt.finishedAt !== null && receipt.finishedAt < (receipt.startedAt ?? receipt.createdAt))
                    throw Error('JOB_RECEIPT_INVALID');
                if (old.worker && terminal.has(old.worker.status) && canonical(old.worker) !== canonical(receipt))
                    throw Error('TERMINAL_RECEIPT_CHANGED');
                next = { ...old, worker: receipt, status: receipt.status, error: receipt.error };
                if (!terminal.has(receipt.status)) {
                    try {
                        process.kill(receipt.workerPid, 0);
                    }
                    catch {
                        next = { ...next, status: 'unknown', error: 'WORKER_NOT_RUNNING_QUERY_ONLY' };
                    }
                    if (Date.now() >= old.elapsedUntil) {
                        atomicJson(dir, 'cancel.json', { jobId: id, nonce: old.nonce });
                        next = { ...next, status: 'unknown', error: 'CAMPAIGN_ELAPSED_LIMIT' };
                    }
                }
                if (receipt.status === 'completed') {
                    const c = this.store.research.longJobConfigurations(projectId).find(c => c.id === old.configurationId);
                    if (!c || c.sha256 !== old.configurationSha256 || receipt.exitCode !== 0 || !receipt.pid || !receipt.finishedAt || receipt.outputs.length !== c.input.outputs.length || new Set(receipt.outputs.map(o => o.name)).size !== receipt.outputs.length || receipt.outputs.some(o => !c.input.outputs.includes(o.name)) || receipt.outputs.reduce((n, o) => n + o.bytes, 0) > c.input.maxOutputMiB * 1048576)
                        throw Error('JOB_OUTPUT_CONTRACT_FAILED');
                    for (const f of c.files)
                        await readOwnedBytes(join(dir, 'work'), join(dir, 'work', f.path), f.sha256, 8 * 1048576);
                    const files = [];
                    for (const o of receipt.outputs) {
                        const body = await readOwnedBytes(join(dir, 'work'), join(dir, 'work', o.name), o.sha256, 8 * 1048576, true);
                        if (body.length !== o.bytes)
                            throw Error('JOB_OUTPUT_SIZE_CHANGED');
                        files.push({ name: o.name, body });
                    }
                    const packet = JSON.parse(ownedText(join(dir, 'packet.json')));
                    const summary = { job: { ...old, status: 'completed', worker: receipt, artifacts: [], error: null }, configuration: c, execution: { providerSha256: packet.providerSha256, runtimeBinarySha256: packet.runtimeBinarySha256, arguments: c.input.args, inputFiles: c.files } };
                    files.push({ name: 'job-summary.json', body: Buffer.from(JSON.stringify(summary, null, 2) + '\n') }, { name: 'job-report.md', body: Buffer.from('# 本地计算 / Local computation\n\nJob: ' + id + '\n\nTask: ' + old.taskId + '\n\nConfiguration SHA256: ' + c.sha256 + '\n\nExit: 0 · ' + receipt.environment.node + ' · ' + receipt.environment.platform + '/' + receipt.environment.arch + '\n\n科学结论待复核 / Scientific conclusions require review.\n\n平台积分扣费 0；本地资源消耗未折算费用 / No platform credits charged; local resource cost is not estimated.\n') });
                    for (const name of ['stdout', 'stderr'])
                        files.push({ name: name + '.txt', body: await readOwnedBytes(dir, join(dir, name + '.txt'), null, 512 * 1024, true) });
                    next = { ...next, artifacts: await writeScientificFiles(this.project(projectId).path, id, files, true) };
                }
            }
            catch (e) {
                next = { ...old, status: 'unknown', error: (e instanceof Error ? e.message : String(e)).slice(0, 2000) };
            }
            if (canonical(next) !== canonical(old))
                return this.store.research.saveLongJob(next, old);
            return old;
        });
    }
    async cancel(projectId: string, id: string) { const job = this.owned(projectId, id); if (!terminal.has(job.status))
        atomicJson(this.directory(id), 'cancel.json', { jobId: id, nonce: job.nonce }); return this.query(projectId, id); }
    wait(state: TaskExecution) {
        if (state.accountRef !== 'local')
            return null;
        const campaign = this.store.research.campaigns(state.task.projectId).find(c => c.taskId === state.task.taskId);
        if (!campaign || campaign.elapsedUntil <= Date.now())
            return null;
        const jobs = this.store.research.longJobs(state.task.projectId).filter(j => j.taskId === state.task.taskId && !terminal.has(j.status));
        if (!jobs.length || jobs.some(j => !['queued', 'running'].includes(j.status) || !state.attempts.some(a => a.state === 'completed' && a.jobIds.includes(j.id))))
            return null;
        return { campaignId: campaign.id, until: campaign.elapsedUntil, jobIds: jobs.map(j => j.id) };
    }
    async queryJobs(projectId: string, ids: string[]) { const owned = new Set(this.store.research.longJobs(projectId).map(j => j.id)), records = []; for (const id of ids)
        if (owned.has(id)) {
            const j = await this.query(projectId, id);
            records.push({ id, state: j.status });
        } return records; }
    async logs(projectId: string, id: string) {
        const job = this.owned(projectId, id), dir = this.directory(job.id), result: {
            stdout: string | null;
            stderr: string | null;
            truncated: boolean;
        } = { stdout: null, stderr: null, truncated: false };
        for (const name of ['stdout', 'stderr'] as const) {
            const path = join(dir, name + '.txt');
            if (existsSync(path)) {
                const bytes = await readOwnedBytes(dir, path, null, 512 * 1024, true);
                result[name] = bytes.subarray(0, 8192).toString('utf8');
                result.truncated ||= bytes.length > 8192;
            }
        }
        return result;
    }
    async verifyTask(taskId: string) { const b = this.store.research.binding(taskId); if (!b)
        return []; const results = []; for (const j of this.store.research.longJobs(b.projectId).filter(j => j.taskId === taskId)) {
        const current = await this.query(b.projectId, j.id);
        if (current.status === 'unknown')
            throw Error('JOB_RECONCILIATION_REQUIRED: ' + current.error);
        results.push({ id: j.id, state: current.status });
    } return results; }
    async resolveArtifact(taskId: string, stepId: string, name: string) {
        if (!['计算 JSON', '计算报告'].includes(name))
            return null;
        const b = this.store.research.binding(taskId);
        if (!b)
            return null;
        const job = this.store.research.longJobs(b.projectId).filter(j => j.taskId === taskId && j.stepId === stepId && j.status === 'completed' && this.store.agentJournal.read(taskId)?.attempts.some(a => a.state === 'completed' && a.jobIds.includes(j.id) && a.planRevision === this.store.researchPlan(taskId)?.planRevision)).at(-1);
        if (!job)
            return null;
        const a = job.artifacts.find(a => a.path.endsWith(name === '计算 JSON' ? '/job-summary.json' : '/job-report.md'));
        if (!a)
            return null;
        await readOwnedBytes(this.project(b.projectId).path, join(this.project(b.projectId).path, a.path), a.sha256, 8 * 1048576);
        return a.path;
    }
    async preview(projectId: string, id: string, path: string) { const job = await this.query(projectId, id), a = job.artifacts.find(a => a.path === path); if (job.status !== 'completed' || !a)
        throw Error('JOB_ARTIFACT_NOT_VERIFIED'); return (await readOwnedBytes(this.project(projectId).path, join(this.project(projectId).path, path), a.sha256, 8 * 1048576, true)).toString('utf8'); }
    async installExample(projectId: string) {
        const root = await realpath(this.project(projectId).path), dir = safeDirectory(root, 'campaign-demo');
        for (const [source, name] of [['experiments/campaign-reference.mjs', 'run.mjs'], ['experiments/math.mjs', 'math.mjs'], ['methods/references/Norris.dat', 'Norris.dat'], ['methods/references/NOTICE.txt', 'NOTICE.txt']]) {
            const bytes = await readOwnedBytes(this.root, join(this.root, source!), null, 8 * 1048576), path = join(dir, name!);
            if (existsSync(path)) {
                if (hash(await readOwnedBytes(root, path, null, 8 * 1048576)) !== hash(bytes))
                    throw Error('EXAMPLE_FILE_EXISTS_DIFFERENT');
            }
            else
                await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        }
        return this.configure(projectId, { label: 'NIST Norris · 后台参考计算', script: 'campaign-demo/run.mjs', inputs: ['campaign-demo/math.mjs', 'campaign-demo/Norris.dat', 'campaign-demo/NOTICE.txt'], outputs: ['reference-result.json'], args: ['2'], maxComputeSeconds: 120, maxElapsedSeconds: 172800, heapMiB: 128, maxOutputMiB: 2, detachApproved: true, pauseModelWhileComputing: true });
    }
}
