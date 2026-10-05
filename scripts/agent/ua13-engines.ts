// Actual SDK/App Server loops with controlled model responses and project-scoped HTTP MCP.
// Engineering qualification only: no scientific or real-model semantic claims.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PiLocalSessionService } from "../../packages/pi-adapter/src/local-session.js";
import { CodexEngine } from "../../packages/agent/src/codex-engine.js";
import { HostMcp } from "../../packages/agent/src/host-mcp.js";
import { TaskSupervisor } from "../../packages/agent/src/task-supervisor.js";
import { directPlan } from "../../packages/agent/src/research-planning.js";
import { composerResponse } from "../../fixtures/agent/composer-response.js";
import { MaterialsMcpClient } from "../../packages/agent/src/mcp-client.js";
import { teamFixture } from "../../packages/agent/src/team/test-fixture.js";
import {
  taskRefSchema,
  permissionGrantSchema,
  type Permission,
} from "../../packages/contracts/src/agent.js";
const temp = await mkdtemp(join(tmpdir(), "ua13-engines-")),
  root = join(temp, "project");
await mkdir(root);
const fixture = teamFixture(),
  origin = await fixture.start(),
  projectId = randomUUID(),
  conversationId = randomUUID(),
  payloads: any[] = [];
const client = new MaterialsMcpClient({
  url: origin + "/v1/research/projects/" + fixture.project.id + "/mcp",
  projectId: fixture.project.id,
  fetch: (u, i) =>
    fetch(u, {
      ...i,
      headers: {
        ...Object.fromEntries(new Headers(i?.headers)),
        Authorization: "Bearer reader",
      },
    }),
});
let mode: "old" | "private" = "old",
  posts = 0,
  reads = 0;
const model = createServer(async (req, res) => {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ data: [{ id: "fixture", context_length: 65536 }] }),
    );
    return;
  }
  const chunks: Buffer[] = [];
  for await (const part of req) chunks.push(Buffer.from(part));
  const payload = JSON.parse(Buffer.concat(chunks).toString());
  payloads.push(payload);
  const n = mode === "private" ? ++posts : 0;
  const call = n === 1 ? "bash" : n === 2 ? "research_data" : null;
  const delta = call
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "private-" + n,
            type: "function",
            function: {
              name: call,
              arguments: JSON.stringify(
                call === "bash"
                  ? { command: "echo forbidden > forbidden.txt" }
                  : { action: "read" },
              ),
            },
          },
        ],
      }
    : {
        role: "assistant",
        content:
          mode === "old"
            ? "OLD_UNSCOPED_PRIVATE_HISTORY_SENTINEL"
            : "Received genuine scoped tool receipt.",
      };
  const chunk = (d: any, end: string | null) => ({
    id: "fixture-" + n,
    object: "chat.completion.chunk",
    model: "fixture",
    choices: [{ index: 0, delta: d, finish_reason: end }],
  });
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(
    `data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, call ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
const settings = {
  mode: "local" as const,
  modelId: "fixture",
  localEndpoint: "http://127.0.0.1:" + (model.address() as any).port + "/v1",
};
const parameters = Type.Object(
    { action: Type.Literal("read") },
    { additionalProperties: false },
  ),
  read = async () => {
    reads++;
    const raw = await client.call("moos_get_experiment", {
      ref: fixture.upstream.ref(),
      section: "observations",
      limit: 1,
    });
    assert(!raw.isError);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(raw.content) }],
      details: {},
    };
  };
const tool = defineTool({
  name: "research_data",
  description: "Read actual authorized source data",
  label: "MOOS data",
  parameters,
  execute: read,
});
const pi = new PiLocalSessionService(process.cwd(), join(temp, "state"), () => [
  tool,
]);
let mcp: HostMcp | null = null,
  engine: CodexEngine | null = null;
function control(kind: "pi" | "codex") {
  const task = taskRefSchema.parse({
      taskId: randomUUID(),
      projectId,
      conversationId,
    }),
    grant = permissionGrantSchema.parse({
      grantId: randomUUID(),
      projectId,
      conversationId,
      permissions: ["read", "search", "patch", "science"] as Permission[],
      approvedBy: "local-user" as const,
      maxCredits: null,
      maxSeconds: 60,
    });
  const context = {
      task,
      grant,
      methods: new Map<string, readonly Permission[]>([
        ["engine.execute", []],
        ["research_data", ["read", "search"]],
      ]),
    },
    results = new Map<string, unknown>();
  const supervisor = new TaskSupervisor({
    context,
    engine: kind,
    connectionId: "fixture",
    accountRef: "local",
    projectPath: root,
    persist: () => {},
    savePlan: () => {},
    saveResult: (hash, value) => {
      results.set(hash, value);
      return hash;
    },
    readResult: (hash) => results.get(hash),
  });
  const plan = directPlan("Read authorized MOOS observations", context);
  plan.steps[0]!.method = "research_data";
  plan.steps[0]!.permissions = ["read", "search"];
  supervisor.acceptPlan(plan);
  return { task, grant, supervisor };
}
try {
  const old = control("pi");
  pi.setControl(conversationId, old.supervisor);
  pi.setPermissions(conversationId, old.grant.permissions);
  await pi.prompt(
    conversationId,
    root,
    settings,
    "Remember previous unscoped context",
  );
  mode = "private";
  const p = control("pi");
  pi.setAuthorizationScope(conversationId, "team-grant-1");
  pi.setPermissions(conversationId, p.grant.permissions);
  pi.setControl(conversationId, p.supervisor);
  await pi.prompt(
    conversationId,
    root,
    settings,
    "Read authorized MOOS observations",
  );
  p.supervisor.finish("completed_with_limitations");
  assert(
    !JSON.stringify(payloads.slice(1)).includes(
      "OLD_UNSCOPED_PRIVATE_HISTORY_SENTINEL",
    ),
  );
  await assert.rejects(readFile(join(root, "forbidden.txt")));
  assert.equal(reads, 1);
  assert.equal(
    p.supervisor.snapshot().attempts.filter((a) => a.state === "completed")
      .length,
    1,
  );
  assert.equal(p.supervisor.snapshot().attempts[0]?.method, "research_data");
  const n = control("codex");
  mcp = new HostMcp(
    { files: [], skills: [] },
    undefined,
    {
      permissions: n.grant.permissions,
      signal: AbortSignal.timeout(60000),
      tools: [
        {
          name: "research_data",
          description: "Read actual authorized MOOS source",
          parameters: parameters as any,
          permissions: ["read", "search"],
          execute: read,
        },
      ],
    },
    n.supervisor,
  );
  await mcp.start();
  let rounds = 0;
  engine = new CodexEngine({
    home: join(temp, "codex"),
    maxOutput: 1024,
    contextWindow: 131072,
    readOnlyWorkspace: true,
    mcp: { url: mcp.url, token: mcp.token, tools: mcp.toolNames },
    mcpPermissions: mcp.permissionMap,
    invoke: async () => {
      rounds++;
      assert(rounds <= 4);
      return composerResponse(
        rounds,
        rounds === 1
          ? 'text(await tools.mcp__materialsx__invoke_material_tool({"name":"research_data","arguments":{"action":"read"}}));'
          : null,
      );
    },
  });
  assert(!engine.capabilities.tools.has("exec_command"));
  assert(!engine.capabilities.tools.has("apply_patch"));
  await engine.run({
    task: n.task,
    grant: n.grant,
    projectPath: root,
    content: "Read authorized MOOS observations",
    control: n.supervisor,
    onEvent: () => {},
  });
  n.supervisor.finish("completed_with_limitations");
  assert.equal(reads, 2);
  assert.equal(
    n.supervisor
      .snapshot()
      .attempts.filter(
        (a) => a.method === "research_data" && a.state === "completed",
      ).length,
    1,
  );
  const report = {
    passed: true,
    realPiSDK: true,
    realCodexAppServer: true,
    controlledModel: true,
    scopedHttpMcp: true,
    piOldHistoryNotRestored: true,
    piTerminalBlocked: true,
    codexNoNativeExecOrPatchCapability: true,
    codexReadOnlyHostAnalysis: true,
    reads,
    scientificQualification: false,
  };
  await mkdir(resolve("runtime/agent/ua-13"), { recursive: true });
  await writeFile(
    resolve("runtime/agent/ua-13/engines.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await engine?.dispose();
  await mcp?.close();
  pi.dispose();
  model.closeAllConnections();
  await new Promise<void>((r) => model.close(() => r()));
  await client.close();
  await fixture.close();
  await rm(temp, { recursive: true, force: true });
}
