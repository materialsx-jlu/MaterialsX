import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PiLocalSessionService } from "../../packages/pi-adapter/src/local-session.js";
const dir = await mkdtemp(join(tmpdir(), "mx-ua1-pi-")),
  project = join(dir, "project");
await mkdir(project);
let calls = 0;
const payloads: any[] = [];
const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(req.url?.startsWith("/api/")?{models:[{key:"fixture",max_context_length:131072,loaded_instances:[{id:"fixture",config:{context_length:131072}}]}]}:{ data: [{ id: "fixture", context_length: 131072 }] }),
    );
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  payloads.push(body);
  calls++;
  const tool = calls === 1 || calls === 2;
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call_${calls}`,
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({
                command: "echo verified > marker.txt",
              }),
            },
          },
        ],
      }
    : { role: "assistant", content: "工具回执已收到。" };
  const event = (delta: any, finish_reason: string | null) => ({
    id: `chat_${calls}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason }],
  });
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(
    `data: ${JSON.stringify(event(delta, null))}\n\ndata: ${JSON.stringify(event({}, tool ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const addr = server.address();
assert(addr && typeof addr === "object");
const settings = {
    mode: "local" as const,
    modelId: "fixture",
    localEndpoint: `http://127.0.0.1:${addr.port}/v1`,
  },
  conversation = randomUUID();
let service = new PiLocalSessionService(process.cwd(), join(dir, "state"));
try {
  service.setPermissions(conversation, ["read", "search"]);
  await assert.rejects(service.prompt(conversation, project, settings, "列出现有文件"),/Unapproved/);
  await assert.rejects(readFile(join(project, "marker.txt")));
  assert(!payloads[0].tools.some((t:any)=>t.function?.name==='bash'));
  service.setPermissions(conversation, ["read", "search", "terminal", "patch"]);
  await service.prompt(conversation, project, settings, "列出工具执行结果");
  assert.equal(
    (await readFile(join(project, "marker.txt"), "utf8")).trim(),
    "verified",
  );
  service.dispose();
  service = new PiLocalSessionService(process.cwd(), join(dir, "state"));
  await service.prompt(conversation, project, settings, "显示之前的结果");
  assert(JSON.stringify(payloads.at(-1)).includes("verified > marker.txt"));
  await mkdir(resolve("runtime/agent/ua-1"), { recursive: true });
  const report = {
    stage: "UA.1",
    engine: "Pi 0.99.1",
    realSDK: true,
    transport: "scripted OpenAI chat streaming",
    intelligenceValidated: false,
    permissionBlock: true,
    terminalRunsOnce: true,
    persistentResume: true,
    calls,
  };
  await writeFile(
    resolve("runtime/agent/ua-1/pi-local.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  service.dispose();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
}
