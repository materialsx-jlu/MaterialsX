import { WorkspaceStore } from '../../apps/desktop/main/store.js';
import { supervisionStore } from '../../apps/desktop/main/agent-supervision-store.js';
import { TaskSupervisor } from '../../packages/agent/src/task-supervisor.js';
import { directPlan } from '../../packages/agent/src/research-planning.js';
// Fixed real local model and bundled execution engines; synthetic project files only.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PiLocalSessionService } from '../../packages/pi-adapter/src/local-session.js';
import { CodexEngine } from '../../packages/agent/src/codex-engine.js';
import { localModelConnection, localResponsesInvoker } from '../../packages/agent/src/local-model-transport.js';
import { permissionGrantSchema, taskRefSchema } from '../../packages/contracts/src/agent.js';
const dir = await mkdtemp(join(tmpdir(), 'mx-ua5-local-')), directory = resolve('runtime/agent/ua-5'), cases: any[] = [];
await mkdir(directory, { recursive: true });
const endpoint = 'http://127.0.0.1:1234/v1', modelId = 'openai/gpt-oss-20b';
for (const engine of (process.argv.includes('--codex-only') ? ['codex'] : ['pi', 'codex']) as Array<'pi' | 'codex'>)
    for (const protocol of ['chat-completions', 'responses'] as const) {
        const project = join(dir, engine + '-' + protocol), home = join(dir, 'home-' + engine + '-' + protocol);
        await mkdir(project);
        await writeFile(join(project, 'probe.txt'), 'before\n');
        let pi: PiLocalSessionService | null = null, codex: CodexEngine | null = null, workspace: WorkspaceStore | null = null;
        let journal: unknown = null;
        const calls: any[] = [];
        const events: any[] = [];
        const start = Date.now();
        let error = '', text = '';
        try {
            const connection = await localModelConnection(endpoint, modelId, fetch, protocol, { maxOutputTokens: 1600 });
            const prompt = engine === 'pi' ? '显示 probe.txt，实际调用 read 读取，然后调用 edit（edits 数组格式）将 before 改为 after。再读取验证。只做这些操作，不运行命令，不使用科学计算工具。' : 'Show probe.txt using exec_command with login=false, then change before to after using apply_patch, then cat the file to verify. Actually execute tools. Do not use Python, science tools or network.';
            if (engine === 'pi') {
                pi = new PiLocalSessionService(resolve('.'), home);
                await mkdir(home, { recursive: true });
                workspace = new WorkspaceStore(join(home, 'workspace.sqlite'));
                const p = workspace.createProject(project), conversation = workspace.createConversation(p.id).id, run = workspace.addRun(p.id, 'UA.5 actual SDK files', 'running');
                const task = taskRefSchema.parse({ taskId: run.id, projectId: p.id, conversationId: conversation }), grant = permissionGrantSchema.parse({ grantId: randomUUID(), projectId: task.projectId, conversationId: conversation, permissions: ['read', 'patch', 'search'], approvedBy: 'local-user', maxCredits: null, maxSeconds: 120 });
                const context = { task, grant, methods: pi.toolCapabilities(project, conversation) };
                const control = new TaskSupervisor({ context, engine: 'pi', connectionId: connection.id, accountRef: 'local', projectPath: project, ...supervisionStore(workspace, run.id) });
                control.acceptPlan(directPlan(prompt, context));
                pi.setControl(conversation, control);
                pi.setPermissions(conversation, ['read', 'patch']);
                pi.setConnection(conversation, connection);
                text = await pi.prompt(conversation, project, { mode: 'local', localEndpoint: endpoint, modelId, agentEngine: engine, localProtocol: protocol }, prompt);
                journal = control.snapshot();
            }
            else {
                const transport = localResponsesInvoker(connection, async (input, init) => { calls.push({ url: String(input), body: JSON.parse(String(init?.body)) }); return fetch(input, init); });
                codex = new CodexEngine({ home, modelId, contextWindow: connection.contextWindow!, maxOutput: connection.maxOutputTokens, invoke: transport });
                const task = taskRefSchema.parse({ taskId: randomUUID(), projectId: randomUUID(), conversationId: randomUUID() }), grant = permissionGrantSchema.parse({ grantId: randomUUID(), projectId: task.projectId, conversationId: task.conversationId, permissions: ['read', 'search', 'terminal', 'patch'], approvedBy: 'local-user', maxCredits: null, maxSeconds: 120 });
                const completion = await codex.run({ task, grant, projectPath: project, content: prompt, onEvent: e => events.push(e) });
                text = completion.text;
            }
            assert.equal(await readFile(join(project, 'probe.txt'), 'utf8'), 'after\n');
            cases.push({ engine, protocol, modelId, connection, passed: true, elapsedMs: Date.now() - start, text, requests: engine === 'codex' ? calls.length : 'actual supervised SDK session', executionReceipts: events.filter(e => e.type === 'receipt'), journal, scientificAccuracyValidated: false });
        }
        catch (e) {
            error = e instanceof Error ? e.message : String(e);
            cases.push({ engine, protocol, modelId, passed: false, error, elapsedMs: Date.now() - start, requests: calls.length });
            process.exitCode = 1;
        }
        finally {
            pi?.dispose();
            await codex?.dispose();
            workspace?.close();
        }
        await writeFile(join(directory, 'local-live.json'), JSON.stringify({ stage: 'UA.5', mode: 'real-local-model-real-engines', scientificAccuracyValidated: false, payments: 0, cases }, null, 2) + '\n', { mode: 0o600 });
        console.log(JSON.stringify({ engine, protocol, passed: !error, elapsedMs: Date.now() - start, error }));
    }
await rm(dir, { recursive: true, force: true });
