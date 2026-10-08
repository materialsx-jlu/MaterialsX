import assert from "node:assert/strict";
import { test } from "node:test";
import { observeRootflowWire } from "./rootflow-wire-observer.js";
test("wire observer separates tool deltas from actual content and retains failure terminals", async () => {
  const lines = [
    { type: "response.function_call_arguments.delta", delta: '{"a":' },
    { type: "response.output_text.delta", delta: "测试" },
    { type: "response.failed", response: { status: "failed", error: { code: "fixture" }, usage: null } },
  ].map(e => "data: " + JSON.stringify(e) + "\r\n\r\n").join("");
  const bytes = new TextEncoder().encode(lines);
  const response = new Response(new ReadableStream({ start(out) {
    for (let n = 0; n < bytes.length; n += 7) out.enqueue(bytes.slice(n, n + 7));
    out.close();
  } }));
  const result = await observeRootflowWire(response, 1, 2);
  assert(result.firstDeltaAt !== null); assert(result.firstTextAt !== null);
  assert(result.firstTextAt >= result.firstDeltaAt);
  assert.equal(result.terminal[0]?.error, "fixture");
  assert.equal(result.terminal[0]?.usage, null);
  assert.equal(result.events.length, 3);
});
test("a failed response without content never claims a first content timestamp", async () => {
  const result = await observeRootflowWire(new Response('data: {"type":"error","code":"failure"}\n\n'), 1, 2);
  assert.equal(result.firstTextAt, null); assert.equal(result.firstDeltaAt, null);
  assert.equal(result.terminal[0]?.error, "failure");
});
