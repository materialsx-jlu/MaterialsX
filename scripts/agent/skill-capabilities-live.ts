// Opt-in real local-model test. Isolated state; no user history, paid APIs or remote installation.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CodexEngine } from '../../packages/agent/src/codex-engine.js';
import { HostMcp } from '../../packages/agent/src/host-mcp.js';
import { localModelConnection, localResponsesInvoker } from '../../packages/agent/src/local-model-transport.js';
import { permissionGrantSchema, taskRefSchema } from '../../packages/contracts/src/agent.js';
import { SkillInstallationService } from '../../packages/skills/src/installation-service.js';
import { createInstalledSkillTools } from '../../packages/pi-adapter/src/installed-skill-tools.js';
import { PiLocalSessionService } from '../../packages/pi-adapter/src/local-session.js';
import { MATERIALS_RESEARCH_INSTRUCTIONS } from '../../packages/agent/src/research-instructions.js';

const dir = await mkdtemp(join(tmpdir(), 'mx-capabilities-live-')), project = join(dir, 'project');
await mkdir(project);
const service = new SkillInstallationService(join(dir, 'state'), () => []); await service.restore();
const trace: unknown[] = [], requests: unknown[] = [];
const sessions = new PiLocalSessionService(process.cwd(), join(dir, 'pi'), () => createInstalledSkillTools(service, project), () => service.paths());
const permissions = ['read', 'search', 'terminal', 'patch'] as const;
const tools = (await sessions.hostTools(project, 'fixture', permissions)).filter(t => t.name === 'skill_capabilities').map(t => ({ ...t, execute: async (...args: Parameters<typeof t.execute>) => {
  const result = await t.execute(...args); trace.push({ name: t.name, result }); return result;
} }));
const mcp = new HostMcp({ files: [], skills: [] }, undefined, { tools, permissions, signal: new AbortController().signal });
await mcp.start();
const connection = await localModelConnection('http://localhost:1234/v1', process.env.MATERIALSX_LOCAL_MODEL ?? 'openai/gpt-oss-20b', fetch, 'chat-completions');
const invoke = localResponsesInvoker(connection); let threadId: string | undefined, engine: CodexEngine | undefined;
const taskBase = { projectId: randomUUID(), conversationId: randomUUID() };
const results: unknown[] = [];
let failure: string | null = null;
try {
  for (const [index, content] of ['你可以自己安装 skill吗', 'Can you install skills? Is capability-fixture available now?'].entries()) {
    if (index === 1) {
      const source = join(dir, 'source'); await mkdir(source);
      await writeFile(join(source, 'SKILL.md'), '---\nname: capability-fixture\ndescription: Read-only capability test\n---\nRead inputs.\n');
      await service.install(source, new AbortController().signal);
    }
    const started = Date.now(), task = taskRefSchema.parse({ ...taskBase, taskId: randomUUID() });
    const grant = permissionGrantSchema.parse({ ...taskBase, grantId: randomUUID(), permissions, approvedBy: 'local-user', maxCredits: null, maxSeconds: 180 });
    const before = trace.length;
    engine = new CodexEngine({ home: join(dir, 'codex'), maxOutput: 1536, contextWindow: connection.contextWindow!, modelId: connection.modelId,
      ...(threadId ? { threadId } : {}), onThread: id => { threadId = id; }, mcp: { url: mcp.url, token: mcp.token, tools: mcp.toolNames }, mcpPermissions: mcp.permissionMap,
      localToolScope: true, invoke: async (payload: any, signal) => {
        const current = payload.input.some((i: any) => ['developer', 'system'].includes(i.role) &&
          (typeof i.content === 'string' ? i.content : (i.content ?? []).map((p: any) => p.text ?? '').join('\n')).includes(MATERIALS_RESEARCH_INSTRUCTIONS));
        requests.push({ currentGuidance: current, toolNames: payload.tools.map((t: any) => t.name) }); assert(current);
        return invoke(payload, signal);
      } });
    const answer = await engine.run({ task, grant, projectPath: project, content, onEvent() {} });
    const semanticPassed = !/skill_installer|安装工具[^\n]*skill\.install|(?:不可以|无法|不能).{0,15}安装|not authorized|cannot install|unable to install|请管理员/i.test(answer.text);
    results.push({ content, text: answer.text, elapsedMs: Date.now() - started, capabilityRead: trace.length > before, semanticPassed });
    assert(trace.length > before, 'Model must inspect the real capability receipt');
    assert.match(answer.text, /安装|install/i);
    if (index === 1) assert.match(answer.text, /capability[-\u2010-\u2015]fixture/);
    await engine.dispose(); engine = undefined;
  }
} catch (error) { failure = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  const out = resolve('runtime/agent/skill-install'); await mkdir(out, { recursive: true });
  const passed = !failure && results.length === 2 && results.every((r: any) => r.semanticPassed);
  const createdAt = new Date().toISOString();
  const report = JSON.stringify({ passed, createdAt, model: connection.modelId, engine: 'codex', freshAndResume: true,
    cloudCalls: 0, remoteDownloads: 0, failure, requests, trace, results }, null, 2);
  await writeFile(join(out, `capabilities-live-${createdAt.replace(/[:.]/g, '-')}.json`), report, { flag: 'wx' });
  await writeFile(join(out, 'capabilities-live.json'), report);
  console.log(JSON.stringify({ passed, failure, results })); if (!passed) process.exitCode = 1;
  await engine?.dispose(); sessions.dispose(); await mcp.close(); await rm(dir, { recursive: true, force: true });
}
