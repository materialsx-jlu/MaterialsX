import assert from "node:assert/strict";
import { test } from "node:test";
import { PiDiagnosticFailure, responseFixtureEvents, verifyPiResponsesFixture, verifyPiResponsesLive } from "./platform-probe.js";

test("pinned Pi parses fragmented Responses and replays a real tool-result shape offline", async () => {
  const r = await verifyPiResponsesFixture();
  assert.equal(r.environment, "synthetic-fixture");
  assert.equal(r.actualSupplierVerified, false);
  assert.equal(r.requests, 2);
  assert.ok(r.toolDeltas >= 2);
  assert.ok(r.textDeltas >= 2);
  assert.equal(r.cacheReadTokens, 2);
  assert.equal(r.outputTokens, 4);
});

test("live probe serializes optional Pi fields, constrains tool use and preserves native usage offline", async () => {
  const payloads: Record<string, unknown>[] = [];
  const fixtureFetch: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.rootflowai.com/v1/responses");
    assert.equal(init?.redirect, "error");
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    payloads.push(payload);
    assert.equal(payload.model, "gpt-5.6-sol");
    assert.equal(payload.max_output_tokens, 256);
    assert.ok(Array.isArray(payload.tools));
    if (payloads.length === 1) assert.deepEqual(payload.tool_choice, { type: "function", name: "read_probe_material" });
    const events = responseFixtureEvents(payloads.length === 1 ? "tool" : "text");
    // Real gateway usage included a prefix of about 4.4K tokens. Pi reserves
    // another 4096 context tokens, so an arbitrary 8192 envelope shrank output.
    for (const event of events) if (event.type === "response.completed") {
      event.response!.usage = { input_tokens: 4447, input_tokens_details: { cached_tokens: 4224 },
        output_tokens: 19, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 4466 };
    }
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  const r = await verifyPiResponsesLive("fixture-only-not-a-secret", fixtureFetch);
  assert.equal(r.environment, "synthetic-fixture");
  assert.equal(r.requests, 2);
  assert.equal(r.toolResultRoundtrip, true);
  assert.equal(r.rawUsage.length, 2);
  assert.equal(r.rawUsage[1]?.input_tokens, 4447);
  assert.equal(r.rawUsage[1]?.input_tokens_details?.cached_tokens, 4224);
  assert.ok(r.unverified.includes("procurement_price"));
});

test("failed Pi roundtrip retains request metadata without credentials or supplier error body", async () => {
  let calls = 0;
  const fixtureFetch: typeof fetch = async () => {
    calls++;
    if (calls === 2) return new Response('{"error":{"message":"private-provider-body"}}', { status: 502 });
    return new Response(responseFixtureEvents("tool").map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  await assert.rejects(verifyPiResponsesLive("fixture-secret-not-real", fixtureFetch), (error: unknown) => {
    assert.ok(error instanceof PiDiagnosticFailure);
    assert.equal(error.message, "diagnostic_tool_result_failed");
    assert.equal(error.diagnostic.requests, 2);
    assert.deepEqual(error.diagnostic.httpStatuses, [200, 502]);
    const body = JSON.stringify(error.diagnostic);
    assert.ok(!body.includes("fixture-secret-not-real") && !body.includes("private-provider-body"));
    return true;
  });
  assert.equal(calls, 2);
});
