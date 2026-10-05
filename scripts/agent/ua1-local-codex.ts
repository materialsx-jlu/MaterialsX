import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceStore } from "../../apps/desktop/main/store.js";
import { DesktopAgentRuntime } from "../../apps/desktop/main/agent-runtime.js";
import { PiLocalSessionService } from "../../packages/pi-adapter/src/local-session.js";
import { createAtomisticTools } from "../../packages/pi-adapter/src/atomistic-tools.js";
import { AtomisticRuntime } from "../../packages/atomistic/src/runtime.js";
import { CodexEngine } from "../../packages/agent/src/codex-engine.js";
import { localModelConnection, localResponsesInvoker } from "../../packages/agent/src/local-model-transport.js";
import { permissionGrantSchema, taskRefSchema } from "../../packages/contracts/src/agent.js";
import type { ModelSettings } from "../../packages/contracts/src/desktop.js";
import type { PiPlatformSessionService } from "../../packages/pi-adapter/src/platform-session.js";

// Opt-in local generation test. No API keys, cloud requests, paid tokens, downloads or user data.
const dir = await mkdtemp(join(tmpdir(), "mx-ua1-local-live-"));
const projectPath = join(dir, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "probe.txt"), "before\n");
const store = new WorkspaceStore(join(dir, "workspace.sqlite"));
const project = store.createProject(projectPath), conversation = store.createConversation(project.id);
const science = new AtomisticRuntime(process.cwd(), join(dir, "science"), (id) => id === project.id ? projectPath : null);
await science.restore();
const si = await science.importSample(project.id, "si-diamond");
const toolTrace: unknown[] = [];
const pi = new PiLocalSessionService(process.cwd(), join(dir, "state"), () => createAtomisticTools(science, project.id).map((tool) => {
  const execute = tool.execute.bind(tool);
  tool.execute = async (...args) => {
    try { const result = await execute(...args); toolTrace.push({ name: tool.name, args: args[1], result: result.content }); return result; }
    catch (cause) { toolTrace.push({ name: tool.name, args: args[1], error: String(cause) }); throw cause; }
  };
  return tool;
}));
let cloudCalls = 0;
const platform = { cancel() {}, native() { cloudCalls++; throw Error("CLOUD_NOT_ALLOWED"); } } as unknown as PiPlatformSessionService;
const agent = new DesktopAgentRuntime(store, pi, platform, join(dir, "state"));
const settings: ModelSettings = { mode: "local", agentEngine: "codex", localEndpoint: "http://localhost:1234/v1", modelId: process.env.MATERIALSX_LOCAL_MODEL ?? "openai/gpt-oss-20b" };
const startedAt = new Date().toISOString();
const report: Record<string, unknown> = { stage: "UA.1 extension", startedAt, model: settings.modelId, cloudCalls: 0, payments: 0, downloads: 0, intelligenceValidated: false, scientificValidation: "needs_review" };
const run = async (content: string, selected = settings, conversationId = conversation.id) => {
  const record = store.addRun(project.id, content.slice(0, 80), "running");
  const start = Date.now();
  const text = await agent.run(record.id, project.id, conversationId, projectPath, selected, content, () => {});
  store.updateRun(record.id, "completed");
  const session = store.engineSession(record.id)!;
  assert.equal(session.connection.modelId, settings.modelId);
  assert.equal(session.selection.engine, selected.agentEngine);
  assert.equal(session.connection.source, "local");
  if (selected.agentEngine === "codex") assert(session.nativeSessionId);
  console.log(JSON.stringify({ phase: content.slice(0, 40), elapsedMs: Date.now() - start, text }));
  return { record, session, elapsedMs: Date.now() - start };
};
try {
  const profile = await agent.localCompatibility(settings);
  assert.equal(profile.status, "limited", profile.reason.zh);
  report.compatibility = profile;
  const first = await run("显示 probe.txt，并通过 apply_patch 将 before 改为 after，运行终端 cat probe.txt 验证。必须实际执行工具，exec_command 使用 login=false。");
  assert.equal(await readFile(join(projectPath, "probe.txt"), "utf8"), "after\n");
  const before = (await stat(join(projectPath, "probe.txt"))).mtimeMs;
  const resumed = await run("Show probe.txt using the terminal (login=false). Do not modify files or rerun any calculation.");
  assert.equal(resumed.session.nativeSessionId, first.session.nativeSessionId);
  assert.equal((await stat(join(projectPath, "probe.txt"))).mtimeMs, before);
  report.fileExecution = { passed: true, sha256: createHash("sha256").update("after\n").digest("hex"), elapsedMs: first.elapsedMs };
  report.resume = true;
  const calculationConversation = store.createConversation(project.id);
  const calculate = await run(`Show the actual single-point result for imported silicon structure ${si.id}. Read lines 1-28 of materials-mlip-singlepoint using read_skill with startLine=1,endLine=28; these contain the basic task and tool contract. Use materials_science select with targetId=${si.id}, secondaryId=singlepoint, potentialId=null, domain=inorganic-crystals, mode=exploratory, evidenceIds=[]. Choose eligible installed CHGNet 0.3.0, otherwise eligible installed MACE-MP-0b3 medium. Follow the Skill's materials_science contract: action=singlepoint, targetId=returned assessmentId, secondaryId=null, potentialId=the eligible candidate ID, domain=inorganic-crystals, mode=exploratory, evidenceIds=that candidate's evidence. Then materials_science action=get, targetId=returned runId, secondaryId=null, potentialId=null, domain=inorganic-crystals, mode=exploratory, evidenceIds=[] until terminal. Do not use legacy named calculation tools or invent action names. Report real energy and artifacts; no DFT accuracy claim. Do not install or use terminal commands.`, settings, calculationConversation.id);
  const jobs = science.list(project.id).filter((j) => j.job.status === "completed");
  assert.equal(jobs.length, 1, "Exactly one real computation is required");
  const job = jobs[0]!;
  assert(job.result && Number.isFinite(job.result.energyEv));
  assert(job.artifacts.length > 0);
  for (const artifact of job.artifacts) {
    const bytes = await readFile(join(projectPath, artifact.relativePath));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
  }
  report.science = { passed: true, elapsedMs: calculate.elapsedMs, potentialId: job.plan.potentialId, energyEv: job.result.energyEv, artifactCount: job.artifacts.length,
    artifacts: job.artifacts.map((a) => ({ id: a.id, relativePath: a.relativePath, sha256: a.sha256, bytes: a.bytes })) };
  // A real local response in flight is steered then interrupted. Scripted fault tests cover process cancellation separately.
  let started!: () => void;
  const ready = new Promise<void>((r) => { started = r; });
  const connection = await localModelConnection(settings.localEndpoint, settings.modelId);
  const invoke = localResponsesInvoker(connection);
  const cancelEngine = new CodexEngine({ home: join(dir, "cancel-home"), modelId: connection.modelId, contextWindow: connection.contextWindow!, maxOutput: 4096,
    invoke: async (payload, signal) => { const response = await invoke(payload, signal); started(); return response; } });
  const task = taskRefSchema.parse({ taskId: randomUUID(), projectId: project.id, conversationId: randomUUID() });
  const execution = cancelEngine.run({ task, projectPath, content: "Show probe.txt, then run sleep 60 using exec_command login=false. Wait for it before replying.",
    grant: permissionGrantSchema.parse({ grantId: randomUUID(), projectId: task.projectId, conversationId: task.conversationId, permissions: ["read", "search", "terminal", "patch"], approvedBy: "local-user", maxCredits: null, maxSeconds: 90 }), onEvent() {} });
  const outcome = execution.catch((cause) => cause as Error);
  await Promise.race([ready, outcome.then(() => { throw Error("Cancellation probe ended before an in-flight response"); })]);
  await cancelEngine.steer(task.taskId, "Stop without modifying files.");
  assert.equal(await cancelEngine.cancel(task.taskId), true);
  assert.match(String(await outcome), /取消|停止/);
  report.steer = true; report.cancel = true;
  const piRun = await run("显示已有文件，然后使用 bash 在当前项目写入 pi-probe.txt，内容为 PI_LOCAL_VERIFIED，并用 read 实际读取结果。不要修改 probe.txt。", { ...settings, agentEngine: "pi" });
  assert.equal((await readFile(join(projectPath, "pi-probe.txt"), "utf8")).trim(), "PI_LOCAL_VERIFIED");
  assert.equal(await readFile(join(projectPath, "probe.txt"), "utf8"), "after\n");
  assert.equal(piRun.session.connection.protocol, "chat-completions");
  report.pi = { passed: true, elapsedMs: piRun.elapsedMs, model: piRun.session.connection.modelId, protocol: piRun.session.connection.protocol };
  assert.equal(cloudCalls, 0);
  report.cloudCalls = cloudCalls;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.toolTrace = toolTrace;
  await agent.dispose(); pi.dispose(); science.dispose(); store.close();
  await mkdir(resolve("runtime/agent/ua-1-extension"), { recursive: true });
  const serialized = JSON.stringify(report, null, 2) + "\n";
  await writeFile(resolve(`runtime/agent/ua-1-extension/local-live-${startedAt.replace(/[:.]/g, "-")}.json`), serialized, { mode: 0o600, flag: "wx" });
  await writeFile(resolve("runtime/agent/ua-1-extension/local-live.json"), serialized, { mode: 0o600 });
  console.log(JSON.stringify({ ...report, toolTrace: toolTrace.length }));
  await rm(dir, { recursive: true, force: true });
}
