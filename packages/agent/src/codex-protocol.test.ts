import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCodexRequest, codexResponse } from "./codex-protocol.js";
import { responseFixtureEvents } from "../../pi-adapter/src/platform-probe.js";
const raw = () => ({
  input: [
    {
      type: "additional_tools",
      tools: [
        {
          type: "namespace",
          name: "functions",
          tools: [
            {
              type: "custom",
              name: "exec",
              description: "Run native composed tools",
            },
            { type: "custom", name: "wait", description: "Wait" },
          ],
        },
      ],
    },
    { type: "message", role: "user", content: "read Si" },
  ],
  parallel_tool_calls: true,
});
test("native namespaces normalize to bounded M5 functions without remote execution", () => {
  const r = normalizeCodexRequest(raw(), 512);
  assert.equal(r.model, "materials-research");
  assert.equal(r.max_output_tokens, 512);
  assert.equal(r.tools?.length, 2);
  assert(!("parallel_tool_calls" in r));
  assert.equal(normalizeCodexRequest(raw(), 512, false).tool_choice, "none");
  const instructed = normalizeCodexRequest({ ...raw(), instructions: "Actual native instructions" }, 512);
  assert.equal((instructed.input[0] as any).type, "message");
  assert.equal((instructed.input[0] as any).content, "Actual native instructions");
  assert.throws(() =>
    normalizeCodexRequest(
      {
        input: [
          {
            type: "custom_tool_call",
            namespace: "other",
            name: "exec",
            input: "code",
          },
        ],
      },
      512,
    ),
  );
});
test("function SSE returns actual native custom calls, keeps terminal usage, handles byte chunks", async () => {
  const events: any[] = structuredClone(responseFixtureEvents("tool").filter((e) => !e.type.startsWith("response.function_call_arguments.")));
  const item = {
    type: "function_call",
    name: "agent_exec",
    call_id: "call",
    id: "item",
    arguments: JSON.stringify({ input: 'text("Si")' }),
  };
  for (const e of events) {
    if (e.item)
      e.item = e.type.endsWith("added") ? { ...item, arguments: "" } : item;
    if (e.response)
      e.response.output = e.type === "response.completed" ? [item] : [];
  }
  events.splice(
    2,
    0,
    {
      type: "response.function_call_arguments.delta",
      item_id: "item",
      output_index: 0,
      delta: item.arguments,
    },
    {
      type: "response.function_call_arguments.done",
      item_id: "item",
      output_index: 0,
      arguments: item.arguments,
    },
  );
  const data = Buffer.from(
    events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(""),
  );
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < data.length; i += 7)
        c.enqueue(data.subarray(i, i + 7));
      c.close();
    },
  });
  const text = await codexResponse(new Response(stream)).text();
  assert.match(text, /custom_tool_call_input.delta/);
  assert.match(text, /usage/);
  assert.match(text, /namespace/);
  assert(!text.includes("function_call_arguments.delta"));
});
test("interpretation cannot execute a tool even when provider ignores tool_choice none", async () => {
  const e = {
    type: "response.output_item.added",
    item: {
      type: "function_call",
      name: "agent_exec",
      id: "item",
      arguments: "",
    },
  };
  const response = new Response(`data: ${JSON.stringify(e)}\n\n`);
  await assert.rejects(codexResponse(response, false).text());
});
