import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bindProposal } from "../../packages/agent/src/research-planning.js";
import {
  permissionGrantSchema,
  taskRefSchema,
  type Permission,
} from "../../packages/contracts/src/agent.js";
// Re-check actual cached model proposals; no generation, fixture answer injection or tool execution.
const directory = resolve("runtime/agent/ua-1");
const recorded = JSON.parse(
  await readFile(resolve(directory, "goals-local.json"), "utf8"),
);
const methods = new Map<string, readonly Permission[]>([
  ["engine.execute", []],
  ["read", ["read"]],
  ["search", ["search"]],
  ["terminal", ["terminal"]],
  ["patch", ["patch"]],
  ["materials_science", ["science"]],
]);
const results = recorded.results.map((r: any) => {
  if (!r.proposal)
    return {
      id: r.id,
      locale: r.locale,
      contractPass: false,
      error: r.error,
      proposalReceived: false,
    };
  try {
    const plan = bindProposal(r.proposal, r.originalRequest, {
      task: taskRefSchema.parse(r.task),
      grant: permissionGrantSchema.parse(r.grant),
      methods,
    });
    return {
      id: r.id,
      locale: r.locale,
      contractPass: true,
      proposalReceived: true,
      actualMissing: plan.cognition.missing.map((m) => m.question),
      originalRequestPreserved: plan.originalRequest === r.originalRequest,
    };
  } catch (cause) {
    return {
      id: r.id,
      locale: r.locale,
      contractPass: false,
      proposalReceived: true,
      error: cause instanceof Error ? cause.message : "INVALID_PLAN",
    };
  }
});
const report = {
  stage: "UA.1",
  kind: "cached-real-model-contract-replay",
  modelId: recorded.modelId,
  temperature: recorded.temperature,
  outputLimit: recorded.outputLimit,
  generationCalls: 0,
  originalContractPass: recorded.contractPass,
  total: results.length,
  contractPass: results.filter((r: any) => r.contractPass).length,
  scientificAccuracyValidated: false,
  semanticExpertReview: "pending",
  results,
};
await writeFile(
  resolve(directory, "goal-replay.json"),
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify({ ...report, results: undefined }));
