// Public runtime feasibility probe. Scripted Responses are not LLM intelligence evidence.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { responseFixtureEvents } from "../../packages/pi-adapter/src/platform-probe.js";

const root = process.cwd(), directory = resolve("runtime/agent/ua-0");
const binary = resolve("node_modules/.bin/codex");
assert.match(execFileSync(binary, ["--version"], { encoding: "utf8" }), /0\.160\.0/);
const home = await mkdtemp(join(tmpdir(), "mx-codex-home-"));
const project = join(home, "project");
await mkdir(project);
await writeFile(join(project, "probe.txt"), "before\n");
let rounds = 0;
let toolNames: string[] = [];
const modelCalls: Array<{ round: number; inputItems: number; inputBytes: number }> = [];
const fixtureErrors: string[] = [];
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/responses");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    rounds++;
    const advertised = body.tools ?? body.input.find((item: any) => item.type === "additional_tools")?.tools ?? [];
    toolNames = advertised.flatMap((tool: any) => tool.tools ? tool.tools.map((nested: any) => `${tool.name}.${nested.name}`) : [tool.name ?? tool.function?.name]);
    modelCalls.push({ round: rounds, inputItems: body.input.length, inputBytes: Buffer.byteLength(JSON.stringify(body.input)) });
    assert(rounds <= 5, "Probe exceeded fixed script rounds");
    const composed = toolNames.includes("functions.exec");
    const patch = "*** Begin Patch\n*** Update File: probe.txt\n@@\n-before\n+after\n*** End Patch";
    const call = rounds === 1 ? { name: composed ? "functions.exec" : "exec_command", arguments: composed ? 'text(await tools.exec_command({cmd:"cat probe.txt",max_output_tokens:100}));' : JSON.stringify({ cmd: "cat probe.txt", max_output_tokens: 100 }) }
      : rounds === 2 ? { name: composed ? "functions.exec" : "apply_patch", arguments: composed ? `text(await tools.apply_patch(${JSON.stringify(patch)}));` : patch }
      : rounds === 3 ? { name: composed ? "functions.exec" : "mcp__fixture__materials_ping", arguments: composed ? 'text(await tools.mcp__fixture__materials_ping({formula:"Si"}));' : JSON.stringify({ formula: "Si" }) } : null;
    let events: any[] = JSON.parse(JSON.stringify(responseFixtureEvents(call ? "tool" : "text")));
    if (call) {
      assert(toolNames.includes(call.name), `Native tool missing: ${call.name}`);
      // Codex apply_patch uses a custom tool, not a function with JSON arguments.
      const custom = call.name === "apply_patch" || composed;
      const item = { id: `item_${rounds}`, type: custom ? "custom_tool_call" : "function_call",
        call_id: `call_${rounds}`, name: composed ? "exec" : call.name, ...(composed ? { namespace: "functions" } : {}), status: "completed",
        ...(custom ? { input: call.arguments } : { arguments: call.arguments }) };
      events = events.filter(event => !event.type.includes("function_call_arguments"));
      for (const event of events) {
        if (event.item) event.item = event.type.endsWith("added")
          ? { ...item, status: "in_progress", ...(custom ? { input: "" } : { arguments: "" }) }
          : item;
        if (event.response) { event.response.id = `resp_${rounds}`; if (event.type === "response.completed") event.response.output = [item]; }
      }
      events.splice(2, 0,
        { type: custom ? "response.custom_tool_call_input.delta" : "response.function_call_arguments.delta", output_index: 0, item_id: item.id, delta: call.arguments },
        { type: custom ? "response.custom_tool_call_input.done" : "response.function_call_arguments.done", output_index: 0, item_id: item.id, ...(custom ? { input: call.arguments } : { arguments: call.arguments }) },
      );
    }
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end();
  } catch (error) {
    fixtureErrors.push(error instanceof Error ? error.message : "SCRIPT_ERROR");
    response.writeHead(500); response.end("UA0_SCRIPTED_TRANSPORT_FAILED");
  }
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address === "object");
await writeFile(join(home, "config.toml"), `model = "gpt-5.6-sol"
model_provider = "ua0"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.ua0]
name = "UA0 offline fixture"
base_url = "http://127.0.0.1:${address.port}/v1"
wire_api = "responses"
requires_openai_auth = false
[mcp_servers.fixture]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(join(root, "node_modules/tsx/dist/cli.mjs"))}, ${JSON.stringify(join(root, "spikes/mcp-server/server.ts"))}]
`);

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
function start() {
  // Child-specific Codex home is its documented storage setting; never touch the user's home/config/auth.
  const child = spawn(binary, ["app-server", "--stdio"], {
    cwd: project, env: { PATH: process.env.PATH ?? "", CODEX_HOME: home, LANG: "en_US.UTF-8" }, stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number, Pending>();
  const notifications: any[] = [];
  let nextId = 0, stderrBytes = 0;
  child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    const message = JSON.parse(line);
    if (message.id !== undefined && !message.method) {
      const entry = pending.get(message.id);
      if (entry) { clearTimeout(entry.timer); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
    } else if (message.method && message.id !== undefined) {
      // Unexpected approval requests are rejected, never auto-approved by a protocol fixture.
      child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: "UA0_UNEXPECTED_SERVER_REQUEST" } }) + "\n");
    } else notifications.push(message);
  });
  child.on("exit", () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error("CODEX_EXITED")); } pending.clear(); });
  function request(method: string, params: unknown): Promise<any> {
    const id = ++nextId;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`UA0_RPC_TIMEOUT:${method}`)); }, 30_000);
      pending.set(id, { resolve: resolveRequest, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async function stop() {
    lines.close(); child.stdin.end(); child.kill("SIGTERM");
    await new Promise<void>(done => { if (child.exitCode !== null || child.signalCode !== null) done(); else child.once("exit", () => done()); });
    return stderrBytes;
  }
  async function initialize() {
    const result = await request("initialize", { clientInfo: { name: "materialsx_ua0", title: "MaterialsX UA0", version: "0.0.1" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    return result;
  }
  return { request, notifications, stop, initialize };
}
let rpc = start();
try {
  const initialized = await rpc.initialize();
  const thread = await rpc.request("thread/start", { cwd: project, model: "gpt-5.6-sol", modelProvider: "ua0", approvalPolicy: "never", sandbox: "danger-full-access" });
  const turn = await rpc.request("turn/start", { threadId: thread.thread.id, input: [{ type: "text", text: "UA0 scripted protocol fixture: read probe.txt, patch before to after, call materials_ping with Si.", text_elements: [] }] });
  const deadline = Date.now() + 40_000;
  let finished;
  while (Date.now() < deadline) {
    finished = rpc.notifications.find(item => item.method === "turn/completed" && item.params?.turn?.id === turn.turn.id);
    if (finished) break;
    await new Promise(done => setTimeout(done, 25));
  }
  assert(finished, "UA0_TURN_TIMEOUT");
  assert.equal(finished.params.turn.status, "completed");
  assert.deepEqual(fixtureErrors, []);
  assert.equal(rounds, 4);
  assert.equal(await readFile(join(project, "probe.txt"), "utf8"), "after\n");
  const items = rpc.notifications.filter(item => item.method === "item/completed").map(item => item.params.item);
  assert(items.some(item => item.type === "commandExecution" && item.exitCode === 0));
  assert(items.some(item => item.type === "fileChange" && item.status === "completed"));
  const mcp = items.find(item => item.type === "mcpToolCall" && item.status === "completed");
  assert.equal(mcp?.result?.structuredContent?.formula, "Si");
  assert.equal(mcp?.readOnlyHint, true);
  const stderrBytes = await rpc.stop();
  rpc = start();
  await rpc.initialize();
  const resumed = await rpc.request("thread/resume", { threadId: thread.thread.id, cwd: project });
  assert.equal(resumed.thread.id, thread.thread.id);
  assert(resumed.thread.turns.length > 0, "Restart must restore completed turn");
  const native = await rpc.request("command/exec", { command: ["/bin/cat", "probe.txt"], cwd: project, timeoutMs: 5000 });
  assert.equal(native.exitCode, 0);
  assert.equal(native.stdout, "after\n");
  const report = { stage: "UA.0", measuredAt: new Date().toISOString(), codex: "0.160.0", sdk: "app-server v2 JSON-RPC",
    transport: "offline scripted Responses", cloudModelCalls: 0, intelligenceValidated: false,
    initialized: !!initialized, threadId: thread.thread.id, turnId: turn.turn.id,
    exec: true, patch: true, mcp: true, restartResume: true, restoredTurns: resumed.thread.turns.length,
    fileHash: createHash("sha256").update(await readFile(join(project, "probe.txt"))).digest("hex"),
    items: items.map(item => ({ id: item.id, type: item.type, status: item.status ?? null, exitCode: item.exitCode ?? null })),
    rounds, toolNames, modelCalls, stderrBytes };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "codex.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ exec: true, patch: true, mcp: true, restartResume: true, rounds, intelligenceValidated: false }));
} finally {
  await rpc.stop();
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  await rm(home, { recursive: true, force: true });
}
