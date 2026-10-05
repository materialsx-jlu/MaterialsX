import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WorkspaceStore } from '../apps/desktop/main/store.js';
import { ResearchService } from '../apps/desktop/main/research-service.js';
import { DesktopAgentRuntime } from '../apps/desktop/main/agent-runtime.js';
import { AgentWorkspace } from '../apps/desktop/main/agent-workspace.js';
import { PiLocalSessionService } from '../packages/pi-adapter/src/local-session.js';
void (async()=>{
const dir = await mkdtemp(join(tmpdir(), 'mx-ua12-parent-')), root = join(dir, 'project');
await mkdir(root);
const store = new WorkspaceStore(join(dir, 'state.sqlite')), p = store.createProject(root), service = new ResearchService(store, { client: null });
let code = 1;
await app.whenReady();app.on('window-all-closed',()=>{});const keeper=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false}});
let runtime: DesktopAgentRuntime | undefined, pi: PiLocalSessionService | undefined, workspace: AgentWorkspace | undefined;
try {
    const settings = { mode: 'local' as const, modelId: 'openai/gpt-oss-20b', localEndpoint: 'http://localhost:1234/v1', agentEngine: (process.env.MATERIALSX_UA12_ENGINE ?? 'pi') as 'pi' | 'codex', localMaxOutputTokens: 4096 };
    await writeFile(join(root, 'source.txt'), 'Material: PVDF\nTest temperature: 298 K\nElastic modulus: not reported\nSource: controlled local fixture; not a scientific publication.\n');
    store.agentWorkspace.savePolicy(p.id, { subtasksEnabled: true, origins: [], shareBrowserContent: false });
    pi = new PiLocalSessionService(process.cwd(), dir, (_path, id) => { const definitions = [...service.tools(p.id, id), ...(workspace?.tools(p.id, id) ?? [])]; return workspace?.childTools(p.id, id, definitions) ?? definitions; });
    runtime = new DesktopAgentRuntime(store, pi, {} as any, dir, { projectRoot: process.cwd() }, undefined, service);
    workspace = new AgentWorkspace(store, runtime, dir);
    const conversation = store.createConversation(p.id), run = store.addRun(p.id, 'Full parent-child flow', 'running'), started = Date.now();
    const request = '请分两个步骤执行资料核对任务。第一步使用 research_subtask 创建一个只读子任务，核对项目内 source.txt 的材料体系、测试温度与弹性模量是否报告，返回原文件证据及缺项。独立分工的价值是减少主任务遗漏原始字段；子任务 files=["source.txt"]。第二步由主任务根据已完成子任务的真实报告和回执，用中文综合材料、温度、缺项和限制。不要重复读取或新建子任务，不做科学计算，不新增额外产物，不声称已验证科学结论。整个任务最多 180 秒。';
    const result = await runtime.run(run.id, p.id, conversation.id, root, settings, request, () => { }), parent = store.agentJournal.read(run.id)!, children = store.agentWorkspace.subtasks(p.id);
    assert.equal(parent.state, 'completed_with_limitations');
    assert.equal(children.length, 1);
    assert.equal(children[0]?.status, 'completed');
    assert.match(result, /PVDF/);
    assert.match(result, /298/);
    const child = store.agentJournal.read(children[0]!.id)!;
    assert.equal(child.parentTaskId, run.id);
    assert(child.attempts.some(a => a.method === 'read' && a.state === 'completed'));
    assert.equal(child.deadline, parent.deadline);
    assert(parent.attempts.some(a => a.method === 'research_subtask' && a.state === 'completed'));
    const output = resolve('runtime/agent/ua-12');
    await mkdir(output, { recursive: true });
    await writeFile(join(output, settings.agentEngine + '-parent.json'), JSON.stringify({ passed: true, engine: settings.agentEngine, realModel: settings.modelId, elapsedMs: Date.now() - started, realParentPlan: true, realDelegation: true, realChildRead: true, parentState: parent.state, childState: child.state, totalRequests: parent.requests.length + child.requests.length, result, scientificQualification: false }, null, 2) + '\n');
    code = 0;
    console.log('UA12 full ' + settings.agentEngine + ' parent-child flow passed, ' + (Date.now() - started) + ' ms');
}
catch (error) {
    const failureRoot=resolve('runtime/agent/ua-12');await mkdir(failureRoot,{recursive:true});await writeFile(join(failureRoot,'parent-failure.json'),JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:null},null,2)+'\n');
    console.error(error);
}
finally {
    await workspace?.browser.dispose();
    await runtime?.dispose();
    pi?.dispose();
    await service.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
    keeper.destroy();await new Promise(r=>setTimeout(r,100));app.exit(code);
}

})();
