import { potentialRegistrySchema, type PotentialManifest, type PotentialRegistry } from "../../contracts/src/atomistic.js";

/** Registry input is trusted application data, never model-provided capabilities. No loading/downloading here. */
export function parsePotentialRegistry(input: unknown): PotentialRegistry {
  return potentialRegistrySchema.parse(input);
}
export function findPotential(registry: PotentialRegistry, id: string): PotentialManifest {
  const potential = registry.potentials.find(p => p.id === id);
  if (!potential) throw new Error("UNKNOWN_POTENTIAL");
  return potential;
}
export function potentialReadiness(p: PotentialManifest): { readyForTaskChecks: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (p.installation === "absent") blockers.push("WEIGHTS_NOT_INSTALLED");
  if (p.weights.verification === "unverified" || !p.weights.sha256) blockers.push("WEIGHT_IDENTITY_UNVERIFIED");
  if (p.licenses.redistribution !== "permitted-with-notices") blockers.push("LICENSE_REVIEW_REQUIRED");
  if (!p.environment.profileId) blockers.push("ENVIRONMENT_NOT_LOCKED");
  if (!p.runtimeEvidenceIds.length || !["runtime_verified", "task_validated"].includes(p.state)) blockers.push("RUNTIME_NOT_VERIFIED");
  if (p.state !== "task_validated" || !p.taskEvidenceIds.length) blockers.push("DOMAIN_NOT_VALIDATED");
  if (!p.declared.elements) blockers.push("ELEMENT_COVERAGE_UNKNOWN");
  if (["failed", "unsupported", "disabled"].includes(p.state)) blockers.push("POTENTIAL_DISABLED");
  // Metadata readiness is necessary but not sufficient: M6.1/M6.4 must check actual bytes, host,
  // structure, outputs, charge/spin/head, budgets and task evidence before executing any plan.
  return { readyForTaskChecks: blockers.length === 0, blockers };
}
