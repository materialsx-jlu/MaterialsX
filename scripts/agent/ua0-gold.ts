import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Structural validation only. Actual model evaluation uses these same cases in UA.1/UA.14.
export async function verifyGold() {
  const boundary = JSON.parse(await readFile(resolve("fixtures/agent/contract-baseline.v1.json"), "utf8"));
  assert.equal(boundary.contractOwner, "packages/contracts/src");
  assert.deepEqual(boundary.goalPlanSections, ["goal", "constraints", "cognition", "steps", "adjustmentRules", "acceptance"]);
  assert.equal(boundary.mcp.sdkClient, boundary.mcp.sdkServer);
  assert.equal(boundary.mcp.tools.length, 8);
  const fixture = JSON.parse(await readFile(resolve("fixtures/agent/research-goals.v1.json"), "utf8"));
  assert.equal(fixture.cohort, "UA.14-first-30");
  assert.equal(fixture.cases.length, 30);
  const ids = new Set<string>();
  for (const example of fixture.cases) {
    assert(!ids.has(example.id)); ids.add(example.id);
    assert(example.prompt.zh && example.prompt.en);
    for (const section of ["goal", "constraints", "cognition", "steps", "adjustment", "acceptance"]) assert(example[section]);
    assert(["direct", "planned"].includes(example.executionMode));
    const steps = new Set<string>();
    for (const step of example.steps) {
      assert(!steps.has(step.id));
      for (const dependency of step.dependsOn) assert(steps.has(dependency), `${example.id}: forward/cyclic dependency`);
      steps.add(step.id);
    }
    assert(example.acceptance.requiredArtifacts.length > 0);
    assert(example.acceptance.realReceiptsRequired);
    assert.equal(example.acceptance.scientificStatus, "not_automatically_validated");
    assert.equal(example.adjustment.retryLimit, 2);
  }
  // Preserve critical negative cases, not merely a matching field count.
  const find = (id: string) => fixture.cases.find((example: any) => example.id === id);
  assert.equal(find("UA-G09").constraints.downloadAllowed, false);
  assert.equal(find("UA-G18").constraints.networkAllowed, false);
  assert.deepEqual(find("UA-G20").goal.priorities, ["strength", "weight"]);
  assert.equal(find("UA-G28").acceptance.expectedTaskState, "failed");
  return { cases: ids.size, bilingualPrompts: ids.size * 2, structuralValidation: true, modelEvaluation: "pending UA.1", expertReview: fixture.expertReview };
}
console.log(JSON.stringify(await verifyGold(), null, 2));
