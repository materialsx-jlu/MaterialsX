import assert from "node:assert/strict";
import { test } from "node:test";
import { createScienceBridge } from "./science-bridge.js";
import type { AtomisticRuntime } from "../../atomistic/src/runtime.js";

test("scientific calls cannot change selected physics or resubmit the same assessment/potential", async () => {
  let starts = 0;
  const job = { job: { id: "job", status: "validating" }, plan: { potentialId: "chgnet-0.3.0" } };
  const runtime = {
    inspect: () => ({ id: "structure" }),
    assess: async () => ({ id: "assessment", request: { projectId: "project", structureId: "structure", task: "singlepoint", domain: "inorganic-crystals", mode: "exploratory", interaction: "short-range" }, selection: {}, rankingBasis: "hard gates", registrySha256: "fixture" }),
    startSelected: async () => { starts++; return job; },
    get: () => job,
  } as unknown as AtomisticRuntime;
  const bridge = createScienceBridge(runtime, "project");
  const base = { domain: "inorganic-crystals", mode: "exploratory", potentialId: null, secondaryId: null, evidenceIds: [] };
  const selected = await bridge.execute({ ...base, action: "select", targetId: "structure", secondaryId: "singlepoint", interaction: null }) as any;
  assert.equal(selected.assessmentId, "assessment");
  const call = { ...base, action: "singlepoint", targetId: selected.assessmentId, potentialId: "chgnet-0.3.0", evidenceIds: ["actual-citation"] };
  await assert.rejects(bridge.execute({ ...call, interaction: "long-range-required" }), /REQUIREMENT_MISMATCH/);
  await assert.rejects(bridge.execute({ ...call, mode: "production" }), /REQUIREMENT_MISMATCH/);
  await assert.rejects(bridge.execute({ ...call, domain: "molecules" }), /REQUIREMENT_MISMATCH/);
  assert.equal(starts, 0);
  const [first, repeated] = await Promise.all([bridge.execute({ ...call, interaction: null }), bridge.execute(call)]) as any[];
  assert.equal(starts, 1); assert.equal(repeated.runId, first.runId); assert.equal(repeated.reused, true);
});
