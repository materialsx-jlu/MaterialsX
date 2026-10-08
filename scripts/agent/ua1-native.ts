import { AtomisticRuntime } from "../../packages/atomistic/src/runtime.js";
import { createScienceBridge } from "../../packages/pi-adapter/src/science-bridge.js";
// Scripted transport tests native execution; it is never an intelligence benchmark.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { CodexEngine } from "../../packages/agent/src/codex-engine.js";
import { HostMcp } from "../../packages/agent/src/host-mcp.js";
import {
  permissionGrantSchema,
  taskRefSchema,
} from "../../packages/contracts/src/agent.js";
import { composerResponse } from "../../fixtures/agent/composer-response.js";
import type { AgentEvent } from "../../packages/agent/src/engine.js";
const dir = await mkdtemp(join(tmpdir(), "mx-ua1-native-")),
  project = join(dir, "project");
const unrelated = createServer((_req, res) => res.end("UNAPPROVED_LOOPBACK"));
await new Promise<void>((done) => unrelated.listen(0, "127.0.0.1", done));
const unrelatedAddress = unrelated.address();
assert(unrelatedAddress && typeof unrelatedAddress === "object");
const unrelatedUrl = `http://127.0.0.1:${unrelatedAddress.port}`;
assert.equal(await (await fetch(unrelatedUrl)).text(), "UNAPPROVED_LOOPBACK");
await mkdir(project);
await writeFile(join(project, "probe.txt"), "before\n");
await writeFile(join(dir, "private-scope.txt"), "PRIVATE_SCOPE_FIXTURE");
await writeFile(join(project, ".env"), "PRIVATE_ENV_FIXTURE");
const projectId = randomUUID(),
  conversationId = randomUUID();
const grant = permissionGrantSchema.parse({
  grantId: randomUUID(),
  projectId,
  conversationId,
  permissions: ["read", "search", "terminal", "patch", "science"],
  approvedBy: "native-dialog",
  maxCredits: "1",
  maxSeconds: 90,
});
const events: AgentEvent[] = [];
let round = 0;
let threadId = "";
const requests: any[] = [];
const scientificRuntime = new AtomisticRuntime(
  process.cwd(),
  join(dir, "scientific-state"),
  (id) => (id === projectId ? project : null),
);
await scientificRuntime.restore();
const si = await scientificRuntime.importSample(projectId, "si-diamond");
const science = createScienceBridge(scientificRuntime, projectId, {
  projectId,
  conversationId,
  structureId: si.id,
  permission: "singlepoint",
  domain: "inorganic-crystals",
  mode: "exploratory",
});
const inspectArgs = {
  action: "inspect",
  targetId: si.id,
  secondaryId: null,
  potentialId: null,
  domain: "inorganic-crystals",
  mode: "exploratory",
  evidenceIds: [],
};
const mcp = new HostMcp(
  {
    files: [],
    skills: [
      {
        id: "fixture",
        name: "fixture",
        text: "Evidence only",
        sha256: "a".repeat(64),
      },
    ],
  },
  science,
);
await mcp.start();
const invoke = async (payload: unknown) => {
  const body = payload as any;
  requests.push(body);
  assert.equal(body.model, "materials-research");
  assert(body.tools.some((t: any) => t.name === "agent_exec"));
  round++;
  assert(round <= 7);
  assert(!JSON.stringify(body).includes("PRIVATE_SCOPE_FIXTURE"));
  assert(!JSON.stringify(body).includes("PRIVATE_ENV_FIXTURE"));
  const patch =
    "*** Begin Patch\n*** Update File: probe.txt\n@@\n-before\n+after\n*** End Patch";
  return composerResponse(
    round,
    round === 1
      ? 'text(await tools.exec_command({cmd:"rg before probe.txt",max_output_tokens:100}));'
      : round === 2
        ? `text(await tools.apply_patch(${JSON.stringify(patch)}));`
        : round === 3
          ? `text(await tools.mcp__materialsx__read_skill({name:"fixture"}));text(await tools.mcp__materialsx__materials_science(${JSON.stringify(inspectArgs)}));`
          : round === 4
            ? `text(await tools.exec_command(${JSON.stringify({ cmd: `if cat ../private-scope.txt 2>/dev/null; then exit 17; fi; if cat .env 2>/dev/null; then exit 20; fi; if (printf x > ../outside.txt) 2>/dev/null; then exit 18; fi; if curl -ks --connect-timeout 1 https://192.0.2.1 >/dev/null 2>&1; then exit 19; fi; if curl -s --connect-timeout 1 ${unrelatedUrl} >/dev/null 2>&1; then exit 21; fi; echo SCOPE_BLOCKS_VERIFIED`, max_output_tokens: 100 })}));`
            : null,
  );
};
const options = {
  onDiagnostic: (e: unknown) => {
    if (process.env.MATERIALSX_PROTOCOL_DEBUG === "1")
      console.log(JSON.stringify(e));
  },
  home: join(dir, "home"),
  maxOutput: 512,
  invoke,
  mcp: { url: mcp.url, token: mcp.token, tools: mcp.toolNames },
  onThread: (id: string) => {
    threadId = id;
  },
};
const input = () => ({
  task: taskRefSchema.parse({
    projectId,
    conversationId,
    taskId: randomUUID(),
  }),
  projectPath: project,
  content:
    "显示 probe.txt，搜索 before，然后通过 patch 将 before 改成 after，并读取 fixture Skill。",
  grant,
  onEvent: (event: AgentEvent) => events.push(event),
});
try {
  const engine = new CodexEngine(options);
  const answer = await engine.run(input());
  assert.equal(answer.state, "completed_with_limitations");
  assert.equal(await readFile(join(project, "probe.txt"), "utf8"), "after\n");
  assert(
    events.some(
      (e) =>
        e.type === "receipt" &&
        e.receipt.kind === "commandExecution" &&
        e.receipt.exitCode === 0,
    ),
  );
  assert(
    events.some(
      (e) =>
        e.type === "receipt" &&
        e.receipt.kind === "fileChange" &&
        e.receipt.status === "completed",
    ),
  );
  assert(
    events.some(
      (e) =>
        e.type === "receipt" &&
        e.receipt.kind === "mcpToolCall" &&
        e.receipt.status === "completed",
    ),
  );
  const scienceOutput = requests[3].input.find(
    (i: any) => i.type === "function_call_output" && i.call_id === "call_3",
  );
  const values = JSON.parse(scienceOutput.output).flatMap((entry: any) => {
    try {
      const item = JSON.parse(entry.text);
      return (item.content ?? []).map((c: any) => JSON.parse(c.text));
    } catch {
      return [];
    }
  });
  assert(
    values.some(
      (v: any) =>
        v.structureId === si.id &&
        v.atomCount === si.atoms.length &&
        v.sourceSha256 === si.source.sha256,
    ),
  );
  assert.equal(round, 5);
  await assert.rejects(readFile(join(dir, "outside.txt")));
  assert(
    requests[4].input.some(
      (i: any) =>
        i.type === "function_call_output" &&
        i.call_id === "call_4" &&
        i.output.includes("SCOPE_BLOCKS_VERIFIED"),
    ),
  );
  const resumed = new CodexEngine({ ...options, threadId });
  await resumed.resume(
    { ...input(), content: "显示现有结果，不要重复工具" },
    threadId,
  );
  assert.equal(round, 6);
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const cancelEngine = new CodexEngine({
    ...options,
    invoke: async (_payload, signal) => {
      started();
      await new Promise<void>((_r, reject) => {
        signal.addEventListener("abort", () => reject(Error("cancelled")), {
          once: true,
        });
      });
      throw Error("unreachable");
    },
  });
  const cancelledInput = { ...input(), content: "显示已存在的文件" };
  const cancelled = cancelEngine.run(cancelledInput);
  const checked = assert.rejects(cancelled, /停止|取消/);
  await ready;
  await cancelEngine.steer(cancelledInput.task.taskId, "只查看，不重算");
  assert.equal(await cancelEngine.cancel(cancelledInput.task.taskId), true);
  await checked;
  const report = {
    stage: "UA.1",
    runtime: "Codex 0.160.0 app-server v2",
    transport: "scripted M5-normalized Responses",
    intelligenceValidated: false,
    nativeReadSearchTerminal: true,
    projectReadWriteIsolation: true,
    secretFileBlocked: true,
    externalNetworkBlocked: true,
    unrelatedLoopbackBlocked: true,
    m6Bridge: true,
    importedSiliconAtoms: si.atoms.length,
    patch: true,
    mcp: true,
    resume: true,
    steer: true,
    cancel: true,
    rounds: round,
    receipts: events.filter((e) => e.type === "receipt"),
    maxSourceLines: 600,
  };
  await mkdir(resolve("runtime/agent/ua-1"), { recursive: true });
  await writeFile(
    resolve("runtime/agent/ua-1/native.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    resolve("runtime/agent/ua-1/gateway-request.json"),
    JSON.stringify(requests[0], null, 2) + "\n",
  );
  console.log(JSON.stringify({ ...report, receipts: report.receipts.length }));
} finally {
  unrelated.closeAllConnections();
  await new Promise<void>((done) => unrelated.close(() => done()));
  await mcp.close();
  scientificRuntime.dispose();
  await rm(dir, { recursive: true, force: true });
}
