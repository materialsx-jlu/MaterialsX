import assert from "node:assert/strict";
import { test } from "node:test";
import { startStage, timedStage, type AgentTimingEvent } from "./agent-timing.js";
test("timing observation cannot fail or repeat work, even when consumer throws", async () => {
  let calls = 0;
  const out = await timedStage("acceptance", async () => { calls++; return 42; }, () => { throw Error("observer"); });
  assert.equal(out, 42); assert.equal(calls, 1);
});
test("timing stages close on failure and finish idempotently", async () => {
  const events: AgentTimingEvent[] = [];
  await assert.rejects(timedStage("recovery", async () => { throw Error("fixture"); }, e => events.push(e)), /fixture/);
  assert.deepEqual(events.map(e => e.edge), ["start", "end"]);
  const stop = startStage("acceptance", e => events.push(e)); stop(); stop();
  assert.equal(events.length, 4);
});
