import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from './store.js';
import { ResearchService } from './research-service.js';
import { ResearchSubtasks } from './research-subtasks.js';
import { TaskSupervisor } from '../../../packages/agent/src/task-supervisor.js';
import { supervisionStore } from './agent-supervision-store.js';
import { directPlan } from '../../../packages/agent/src/research-planning.js';
import type { SubtaskRecord } from '../../../packages/contracts/src/agent-workspace.js';
import { browserUrl, publicAddress } from '../../../packages/agent/src/browser-policy.js';
const connection = { id: 'model-' + 'a'.repeat(32), source: 'local' as const, modelId: 'fixture', endpoint: 'http://127.0.0.1:1234/v1', protocol: 'chat-completions' as const, contextWindow: 32768, maxOutputTokens: 1024, revision: 'fixture' };
const input = { objective: '核对输入文件中的材料体系与实验条件', reason: '独立核对可以帮助主任务确认来源及缺失条件', acceptance: '引用原始文件字段，列出缺失信息，不作科学验证', files: ['source.txt'] };
const settings = { mode: 'local' as const, modelId: 'fixture', localEndpoint: connection.endpoint, agentEngine: 'pi' as const };
async function setup() {
    const temp = await mkdtemp(join(tmpdir(), 'mx-ua12-')), store = new WorkspaceStore(join(temp, 'state.sqlite')), path = join(temp, 'project');
    await mkdir(path);
    await writeFile(join(path, 'source.txt'), 'PVDF, room temperature, elastic modulus missing.\n');
    const project = store.createProject(path), conversation = store.createConversation(project.id), run = store.addRun(project.id, 'parent', 'running'), service = new ResearchService(store, { client: null }), task = { taskId: run.id, projectId: project.id, conversationId: conversation.id } as any;
    const grant = { grantId: randomUUID(), projectId: project.id, conversationId: conversation.id, permissions: ['read', 'search', 'network', 'patch', 'terminal', 'science'], approvedBy: 'local-user', maxCredits: null, maxSeconds: 600 } as any;
    const context = { task, grant, methods: new Map<string, readonly any[]>([['engine.execute', []], ['research_subtask', ['read', 'search']], ['read', ['read']]]) };
    service.begin(run.id, project.id, '分工核对资料并汇总');
    const control = new TaskSupervisor({ context, engine: 'pi', connectionId: connection.id, accountRef: 'local', projectPath: path, ...supervisionStore(store, run.id) }), plan = directPlan('分工核对资料并汇总', context);
    plan.executionMode = 'planned';
    plan.steps = [{ ...plan.steps[0]!, id: 'execute' as any, method: 'research_subtask', permissions: ['read', 'search', 'network'] }, { ...plan.steps[0]!, id: 'synthesize' as any, dependsOn: ['execute' as any] }];
    control.acceptPlan(plan);
    store.agentWorkspace.savePolicy(project.id, { subtasksEnabled: true, origins: [], shareBrowserContent: false });
    control.beforeTool({ id: 'delegate', name: 'research_subtask', args: input, permissions: ['read', 'search'] });
    return { temp, path, store, project, conversation, run, service, context, control, close: async () => { store.close(); await service.close(); await rm(temp, { recursive: true, force: true }); } };
}
async function completeChild(s: Awaited<ReturnType<typeof setup>>, record: SubtaskRecord, manager: ResearchSubtasks, reads=1) {
    const parent = s.control.snapshot(), context = { task: { taskId: record.id, projectId: record.projectId, conversationId: record.conversationId } as any, grant: { ...parent.grant, conversationId: record.conversationId, permissions: ['read', 'search', 'network'] as any }, methods: new Map<string, readonly any[]>([['engine.execute', []], ['read', ['read']]]) };
    const child = new TaskSupervisor({ context, engine: 'pi', connectionId: connection.id, accountRef: 'local', projectPath: record.workspace, parentTaskId: parent.task.taskId, deadline: parent.deadline, admit: (kind, p) => manager.admit(record.id, record.projectId, kind, p), ...supervisionStore(s.store, record.id) });
    child.acceptPlan(directPlan('核对原始文件', context));
    const q = child.beforeRequest({ messages: [{ role: 'user', content: 'Inspect file' }] }, 'execute', 32768, 1024);
    child.endRequest(q.id, 'completed');
    for(let i=0;i<reads;i++){child.beforeTool({ id: 'read-source-'+i, name: 'read', args: { path: 'input-0-source.txt' }, permissions: ['read'] });child.afterTool('read-source-'+i, { content: [{ type: 'text', text: await readFile(join(record.workspace, 'input-0-source.txt'), 'utf8') }] }, false);}
    if(reads===511)assert.throws(()=>child.beforeTool({id:'overflow',name:'read',args:{path:'input-0-source.txt'},permissions:['read']}),/512/);
    child.finish('completed_with_limitations');
    return 'PVDF；室温；弹性模量未提供。证据：input-0-source.txt。科学结论待复核。';
}
test('subtask has isolated workspace, same real journal, frozen inputs, original parent deadline and verified files', async () => {
    const s = await setup();
    try {
        let manager: ResearchSubtasks;
        manager = new ResearchSubtasks(s.store, async (record, launch) => { assert.equal(launch.connection, connection); assert.equal(launch.parent.deadline, s.control.snapshot().deadline); assert.notEqual(record.conversationId, s.conversation.id); return completeChild(s, record, manager); });
        const result = await manager.execute(s.project.id, s.control.snapshot(), input, connection, settings, new AbortController().signal);
        assert.equal(result.status, 'completed');
        assert.equal(result.artifacts.length, 2);
        assert.equal(result.semanticAcceptance, 'needs_review');
        const record = s.store.agentWorkspace.subtasks(s.project.id)[0]!;
        assert(record.workspace.startsWith(join(s.path, '.materialsx', 'subtasks')));
        assert.equal(s.store.agentJournal.read(record.id)?.parentTaskId, s.run.id);
        assert.equal(s.store.agentJournal.read(record.id)?.deadline, s.control.snapshot().deadline);
        assert.equal(s.store.research.binding(record.id)?.approvedInputs[0]?.sha256, s.store.research.binding(s.run.id)?.approvedInputs[0]?.sha256);
        assert.match(await manager.preview(s.project.id, record.id, result.artifacts[0]!.path), /PVDF/);
        await writeFile(join(record.workspace, result.artifacts[0]!.path), 'changed');
        await assert.rejects(manager.preview(s.project.id, record.id, result.artifacts[0]!.path), /CHANGED/);await assert.rejects(manager.resolveArtifact(s.run.id,'execute','子任务报告'),/CHANGED/);
    }
    finally {
        await s.close();
    }
});
test('subtasks share permissions and deadline without a 32-request ceiling', async () => {
    const s = await setup();
    try {
        let manager: ResearchSubtasks;
        manager = new ResearchSubtasks(s.store, async (record) => {
            manager.admit(record.id, s.project.id, 'check', ['read']);
            assert.throws(() => manager.admit(record.id, s.project.id, 'check', ['patch']), /只读|权限/);
            assert.throws(() => manager.admit(record.id, s.project.id, 'check', ['science']), /只读|权限/);
            for (let i = 0; i < 33; i++) {
                const q = s.control.beforeRequest({ messages: [{ role: 'user', content: 'budget' }] }, 'execute', 32768, 128);
                s.control.endRequest(q.id, 'completed');
            }
            assert.doesNotThrow(() => manager.admit(record.id, s.project.id, 'request'));
            const child = { ...s.control.snapshot(), parentTaskId: s.run.id, task: { ...s.control.snapshot().task, taskId: record.id as any, conversationId: record.conversationId as any } };
            await assert.rejects(manager.execute(s.project.id, child, input, connection, settings, new AbortController().signal), /NESTED/);
            s.control.finish('cancelled');
            assert.throws(() => manager.admit(record.id, s.project.id, 'check'), /主任务已停止/);
            throw Error('parent cancelled');
        });
        await assert.rejects(manager.execute(s.project.id, s.control.snapshot(), input, connection, settings, new AbortController().signal), /parent cancelled/);
        assert.equal(s.store.agentWorkspace.subtasks(s.project.id)[0]?.status, 'failed');
    }
    finally {
        await s.close();
    }
});
test('opt-in, complex plan and genuine completion are required; secrets and symlink files are denied', async () => {
    const s = await setup();
    try {
        const manager = new ResearchSubtasks(s.store, async () => 'I claim completion');
        s.store.agentWorkspace.savePolicy(s.project.id, { subtasksEnabled: false, origins: [], shareBrowserContent: false });
        await assert.rejects(manager.execute(s.project.id, s.control.snapshot(), input, connection, settings, new AbortController().signal), /APPROVAL/);
        s.store.agentWorkspace.savePolicy(s.project.id, { subtasksEnabled: true, origins: [], shareBrowserContent: false });
        await assert.rejects(manager.execute(s.project.id, s.control.snapshot(), { ...input, files: ['.env.production'] }, connection, settings, new AbortController().signal), /DENIED/);
        await symlink(join(s.path, 'source.txt'), join(s.path, 'link.txt'));
        await assert.rejects(manager.execute(s.project.id, s.control.snapshot(), { ...input, files: ['link.txt'] }, connection, settings, new AbortController().signal), /SYMLINK/);
        await assert.rejects(manager.execute(s.project.id, s.control.snapshot(), input, connection, settings, new AbortController().signal), /REAL_COMPLETION/);
        assert.equal(s.store.agentWorkspace.subtasks(s.project.id)[0]?.status, 'failed');
    }
    finally {
        await s.close();
    }
});
test('parent cancellation aborts the original child without resubmission; pending records survive as unknown', async () => {
    const s = await setup();
    try {
        let started!: () => void;
        const ready = new Promise<void>(r => started = r);
        const manager = new ResearchSubtasks(s.store, async (_r, launch) => { started(); await new Promise((_r, reject) => launch.signal.addEventListener('abort', () => reject(launch.signal.reason), { once: true })); return 'never'; });
        const flight = manager.execute(s.project.id, s.control.snapshot(), input, connection, settings, new AbortController().signal);
        await assert.rejects(manager.execute(s.project.id, s.control.snapshot(), input, connection, settings, new AbortController().signal), /IN_FLIGHT/);
        await ready;
        manager.cancelParent(s.run.id);
        await assert.rejects(flight, /PARENT_STOPPED/);
        assert.equal(s.store.agentWorkspace.subtasks(s.project.id)[0]?.status, 'cancelled');
        const record = s.store.agentWorkspace.subtasks(s.project.id)[0]!;
        s.store.agentWorkspace.saveSubtask({ ...record, status: 'running' }, record);
        assert.equal(new ResearchSubtasks(s.store, async () => { throw Error('must not dispatch'); }).overview(s.project.id)[0]?.status, 'unknown');
    }
    finally {
        await s.close();
    }
});
test('browser origin contract blocks private/network schemes and keeps explicit public origins', () => { for (const u of ['file:///etc/passwd', 'http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://user:secret@example.com', 'https://example.com:8443', 'https://example.local'])
    assert.throws(() => browserUrl(u, [new URL(u).origin])); assert.equal(browserUrl('https://arxiv.org/abs/2601.00001', ['https://arxiv.org']).hostname, 'arxiv.org'); assert.throws(() => browserUrl('https://evil.org/', ['https://arxiv.org'])); for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:127.0.0.1'])
    assert.equal(publicAddress(ip), false); assert.equal(publicAddress('1.1.1.1'), true); });

test('aggregate tool cap includes the parent delegation receipt; child cannot gain another 512 tool calls',async()=>{const s=await setup();try{let manager:ResearchSubtasks;manager=new ResearchSubtasks(s.store,record=>completeChild(s,record,manager,511));const result=await manager.execute(s.project.id,s.control.snapshot(),input,connection,settings,new AbortController().signal);assert.equal(s.store.agentJournal.read(result.id)?.attempts.length,511);assert.throws(()=>manager.admit(s.run.id,s.project.id,'tool',['read']),/512/);}finally{await s.close();}});
