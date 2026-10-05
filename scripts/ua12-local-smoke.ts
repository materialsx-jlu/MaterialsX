import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WorkspaceStore } from '../apps/desktop/main/store.js';
import { ResearchService } from '../apps/desktop/main/research-service.js';
import { DesktopAgentRuntime } from '../apps/desktop/main/agent-runtime.js';
import { PiLocalSessionService } from '../packages/pi-adapter/src/local-session.js';
import { localModelConnection } from '../packages/agent/src/local-model-transport.js';
import { ua12Parent } from '../tests/fixtures/agent/ua12-task.js';
const dir = await mkdtemp(join(tmpdir(), 'mx-ua12-live-')), root = join(dir, 'project');
await mkdir(root);
const store = new WorkspaceStore(join(dir, 'state.sqlite')), project = store.createProject(root), service = new ResearchService(store, { client: null });
let runtime: DesktopAgentRuntime | undefined, pi: PiLocalSessionService | undefined;
try {
    const settings = { mode: 'local' as const, modelId: process.env.MATERIALSX_UA12_MODEL ?? 'openai/gpt-oss-20b', localEndpoint: process.env.MATERIALSX_UA12_ENDPOINT ?? 'http://localhost:1234/v1', agentEngine: (process.env.MATERIALSX_UA12_ENGINE ?? 'pi') as 'pi' | 'codex', localMaxOutputTokens: 1024 };
    const connection = await localModelConnection(settings.localEndpoint, settings.modelId, fetch, 'chat-completions', { maxOutputTokens: 1024 });
    const content = 'Material: PVDF\nTest temperature: 298 K\nElastic modulus: not reported\nSource: local controlled fixture, not a publication\n';
    await writeFile(join(root, 'source.txt'), content);
    store.agentWorkspace.savePolicy(project.id, { subtasksEnabled: true, origins: [], shareBrowserContent: false });
    pi = new PiLocalSessionService(process.cwd(), dir, (_path, id) => service.tools(project.id, id).filter(t => ['research_data', 'method_package_search'].includes(t.name)));
    runtime = new DesktopAgentRuntime(store, pi, {} as any, dir, { projectRoot: process.cwd() }, undefined, service);
    if (settings.agentEngine === 'codex')
        await runtime.localCompatibility(settings, false);
    const parent = ua12Parent(store, service, project.id, connection.id, settings.agentEngine), started = Date.now();
    const result = await runtime.subtasks.execute(project.id, parent.control.snapshot(), { objective: '读取 input-0-source.txt，核对 PVDF 实验温度和弹性模量是否提供', reason: '独立核对原始字段，供主任务综合时确认条件和数据缺项', acceptance: '先真实 read 文件，再用中文给出材料、温度、缺失模量和文件证据。不得声称已计算或科学验证。', files: ['source.txt'] }, connection, settings, new AbortController().signal);
    const child = store.agentJournal.read(result.id)!;
    assert.equal(child.state, 'completed_with_limitations');
    assert(child.attempts.some(a => a.method === 'read' && a.state === 'completed'));
    assert.match(result.result, /298/);
    assert.match(result.result, /PVDF/);
    assert.equal(child.deadline, parent.control.snapshot().deadline);
    assert.equal(result.artifacts.length, 2);
    const output = resolve('runtime/agent/ua-12');
    await mkdir(output, { recursive: true });
    await writeFile(join(output, settings.agentEngine + '-local.json'), JSON.stringify({ passed: true, realModel: settings.modelId, engine: settings.agentEngine, elapsedMs: Date.now() - started, visionMetadata: connection.vision ?? false, actualReadReceipt: true, requestCount: child.requests.length, toolCount: child.attempts.length, result: result.result, artifacts: result.artifacts, semanticQualification: 'not_assessed', parentFixture: true }, null, 2) + '\n');
    console.log('UA12 real ' + settings.agentEngine + ' child passed: ' + child.requests.length + ' requests, ' + (Date.now() - started) + ' ms');
}
finally {
    await runtime?.dispose();
    pi?.dispose();
    await service.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
}
