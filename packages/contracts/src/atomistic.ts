import { z } from "zod";

/** M6 local science contracts. Runtime refinements are mandatory in addition to JSON Schema. */
export const ATOMISTIC_CONTRACT_VERSION = "m6.0-v1";
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/);
const text = z.string().min(1).max(4096);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^[a-f0-9]{40}$/);
const finite = z.number().finite();
const vector = z.tuple([finite, finite, finite]);
const matrix = z.tuple([vector, vector, vector]);
const relativePath = z.string().min(1).max(512).refine(p =>
  !p.startsWith("/") && !p.includes("\\") && !p.includes(":") && !p.includes("\0") &&
  p.split("/").every(s => s !== "" && s !== "." && s !== ".."), "unsafe relative path");
export const elementSymbols = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" ");
const element = z.string().refine(v => elementSymbols.includes(v), "unknown element");
const bilingual = z.strictObject({ zh: text, en: text });
const evidence = z.strictObject({ id, url: z.url().refine(u => u.startsWith("https://")), revision, path: relativePath, sha256: digest });
const claim = z.enum(["yes", "no", "unknown"]);
const license = z.strictObject({ expression: text, evidenceIds: z.array(id).max(20), status: z.enum(["documented", "unknown"]) });
export const potentialManifestSchema = z.strictObject({
  schemaVersion: z.literal(ATOMISTIC_CONTRACT_VERSION), id, name: text,
  family: z.enum(["MACE", "CHGNet", "MatterSim", "ORB", "SevenNet", "MatGL", "UMA"]),
  checkpoint: text, role: z.enum(["core-candidate", "extension-candidate"]),
  source: evidence, evidence: z.array(evidence).max(20), citation: text,
  weights: z.strictObject({ url: z.url().refine(u => u.startsWith("https://")), revision: text,
    sha256: digest.nullable(), bytes: z.number().int().positive().nullable(),
    verification: z.enum(["download-hashed", "publisher-digest", "unverified"]) }),
  licenses: z.strictObject({ code: license, weights: license, trainingData: license,
    redistribution: z.enum(["permitted-with-notices", "review-required", "restricted", "unknown"]) }),
  declared: z.strictObject({ energy: claim, forces: claim, stress: claim, conservative: claim,
    elements: z.array(element).min(1).max(118).nullable(),
    periodicity: z.array(z.enum(["bulk", "slab", "molecule"])).max(3),
    domains: z.array(text).min(1).max(10), headPolicy: z.enum(["single", "required", "unknown"]), heads: z.array(text).max(20),
    chargeInput: z.enum(["required", "unsupported", "unknown"]),
    spinInput: z.enum(["required", "unsupported", "unknown"]),
    nativeUnits: z.strictObject({ energy: z.enum(["eV", "eV/atom", "unknown"]),
      forces: z.enum(["eV/angstrom", "unknown"]), stress: z.enum(["eV/angstrom^3", "GPa", "unknown"]),
      stressConvention: text }),
    temperatureRangeK: z.tuple([finite.nonnegative(), finite.positive()]).nullable(),
    pressureRangeGPa: z.tuple([finite, finite]).nullable(), evidenceIds: z.array(id).min(1).max(20) }),
  energyReference: z.strictObject({ functional: text, dataset: text, convention: text }),
  environment: z.strictObject({ adapter: z.enum(["mace-ase", "chgnet-ase", "mattersim-ase", "orb-ase", "sevennet-ase", "matgl-ase", "fairchem-ase"]),
    profileId: id.nullable(), codeRevision: revision, diskEstimateMiB: z.number().positive().nullable(),
    memoryEstimateMiB: z.number().positive().nullable(),
    matrix: z.array(z.strictObject({ platform: z.enum(["macos-arm64", "windows-x64"]),
      device: z.enum(["cpu", "cuda", "mps"]), status: z.enum(["not-tested", "unsupported", "verified"]), evidenceId: id.nullable() })).min(1).max(6) }),
  state: z.enum(["catalogued", "audited", "packaged", "installed", "runtime_verified", "task_validated", "failed", "unsupported", "disabled"]),
  installation: z.enum(["absent", "bundled", "user-installed"]),
  runtimeEvidenceIds: z.array(id).max(20), taskEvidenceIds: z.array(id).max(20),
  description: bilingual, examples: z.array(bilingual).min(1).max(2),
  limitations: z.array(bilingual).min(1).max(10), relatedCatalogIds: z.array(z.string().min(1).max(256)).max(10),
}).superRefine((v, ctx) => {
  const problem = (message: string) => ctx.addIssue({ code: "custom", message });
  if (v.weights.verification !== "unverified" && (!v.weights.sha256 || !v.weights.bytes)) problem("verified identity needs hash and size");
  if (v.role === "core-candidate" && (!v.weights.sha256 || !v.environment.profileId)) problem("core needs frozen weights and environment profile");
  if (v.declared.elements && new Set(v.declared.elements).size !== v.declared.elements.length) problem("duplicate elements");
  for (const row of v.environment.matrix) if (row.status === "verified" && !row.evidenceId) problem("verified platform needs evidence");
  const stages = ["packaged", "installed", "runtime_verified", "task_validated"];
  if (stages.includes(v.state) && (v.installation === "absent" || !v.weights.sha256 || v.licenses.redistribution !== "permitted-with-notices")) problem("installed stage needs licensed, pinned package");
  if (["runtime_verified", "task_validated"].includes(v.state) && (!v.runtimeEvidenceIds.length || !v.environment.matrix.some(m => m.status === "verified"))) problem("runtime stage needs measured evidence");
  if (v.state === "task_validated" && !v.taskEvidenceIds.length) problem("task validation needs separate evidence");
  const known = new Set([v.source.id, ...v.evidence.map(e => e.id)]);
  for (const e of [...v.declared.evidenceIds, ...v.licenses.code.evidenceIds, ...v.licenses.weights.evidenceIds, ...v.licenses.trainingData.evidenceIds]) if (!known.has(e)) problem(`unresolved metadata evidence: ${e}`);
});
export type PotentialManifest = z.infer<typeof potentialManifestSchema>;
export const potentialRegistrySchema = z.strictObject({ schemaVersion: z.literal(ATOMISTIC_CONTRACT_VERSION),
  releaseId: id, reviewedAt: z.iso.date(), potentials: z.array(potentialManifestSchema).min(10).max(20),
}).refine(v => new Set(v.potentials.map(p => p.id)).size === v.potentials.length, "duplicate checkpoint id");
export type PotentialRegistry = z.infer<typeof potentialRegistrySchema>;

export function cellDeterminant(c: z.infer<typeof matrix>): number {
  return c[0][0]*(c[1][1]*c[2][2]-c[1][2]*c[2][1])-c[0][1]*(c[1][0]*c[2][2]-c[1][2]*c[2][0])+c[0][2]*(c[1][0]*c[2][1]-c[1][1]*c[2][0]);
}
export const atomicStructureSchema = z.strictObject({
  schemaVersion: z.literal(ATOMISTIC_CONTRACT_VERSION), id, coordinateUnit: z.literal("angstrom"),
  atoms: z.array(z.strictObject({ id, element, position: vector, occupancy: finite.positive().max(1) })).min(1).max(2000),
  cell: matrix.nullable(), pbc: z.tuple([z.boolean(), z.boolean(), z.boolean()]),
  charge: finite.int().nullable(), spinMultiplicity: finite.int().positive().nullable(),
  source: z.strictObject({ artifactId: id, sha256: digest, format: z.enum(["cif", "xyz", "extxyz", "poscar"]),
    provenance: z.enum(["user-file", "team-synthetic", "literature-reconstructed", "hypothesis"]),
    license: text, transformations: z.array(text).max(100) }),
  issues: z.array(z.strictObject({ code: id, severity: z.enum(["warning", "blocking"]), detail: text })).max(100),
}).superRefine((v, ctx) => {
  if (new Set(v.atoms.map(a => a.id)).size !== v.atoms.length) ctx.addIssue({ code: "custom", message: "duplicate atom IDs" });
  if (v.cell && !Number.isFinite(cellDeterminant(v.cell))) ctx.addIssue({ code: "custom", message: "cell volume overflows" });
  if (v.pbc.some(Boolean) && (!v.cell || Math.abs(cellDeterminant(v.cell)) < 1e-8)) ctx.addIssue({ code: "custom", message: "periodic structure requires nonsingular cell" });
});
export type AtomicStructure = z.infer<typeof atomicStructureSchema>;
export const atomisticBudgetSchema = z.strictObject({ maxAtoms: z.number().int().min(1).max(2000),
  maxSteps: z.number().int().min(1).max(2000), maxWallSeconds: z.number().int().min(1).max(1800),
  maxMemoryMiB: z.number().int().min(256).max(8192), maxOutputMiB: z.number().int().min(1).max(256), threads: z.number().int().min(1).max(8) });
const task = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("singlepoint") }),
  z.strictObject({ kind: z.literal("relaxation"), optimizer: z.literal("FIRE"), cellMode: z.enum(["fixed", "variable"]),
    maxSteps: z.number().int().min(1).max(500), fmaxEvPerAngstrom: finite.min(0.001).max(0.2), externalPressureGPa: finite.min(-10).max(10).nullable() }),
  z.strictObject({ kind: z.literal("md"), ensemble: z.enum(["nve", "nvt"]), steps: z.number().int().min(1).max(2000),
    timestepFs: finite.min(0.01).max(1), temperatureK: finite.min(1).max(1000), sampleEvery: z.number().int().min(1).max(2000), seed: z.number().int().min(0).max(4294967295) }),
]);
export const atomisticPlanSchema = z.strictObject({ schemaVersion: z.literal(ATOMISTIC_CONTRACT_VERSION), id,
  projectId: id, structureId: id, structureSha256: digest, potentialId: id, potentialSha256: digest,
  environmentProfileId: id, device: z.enum(["cpu", "cuda", "mps"]), dtype: z.enum(["float32", "float64"]),
  head: text.nullable(), task, budget: atomisticBudgetSchema,
  qualityPolicyId: id, selectionEvidenceIds: z.array(id).min(1).max(20),
}).superRefine((v, ctx) => {
  if (v.task.kind !== "singlepoint" && (v.task.kind === "md" ? v.task.steps : v.task.maxSteps) > v.budget.maxSteps) ctx.addIssue({ code: "custom", message: "task exceeds step budget" });
  if (v.task.kind === "md" && v.task.sampleEvery > v.task.steps) ctx.addIssue({ code: "custom", message: "sampling exceeds trajectory steps" });
  if (v.task.kind === "relaxation" && ((v.task.cellMode === "fixed") !== (v.task.externalPressureGPa === null))) ctx.addIssue({ code: "custom", message: "pressure only with explicit variable cell" });
});
export type AtomisticPlan = z.infer<typeof atomisticPlanSchema>;
export const atomisticArtifactSchema = z.strictObject({ schemaVersion: z.literal(ATOMISTIC_CONTRACT_VERSION), id,
  projectId: id, runId: id, type: z.enum(["atomic_structure", "atomic_trajectory", "atomistic_result", "validation_report", "plot", "image"]),
  relativePath, sha256: digest, bytes: z.number().int().positive().max(256*1024*1024),
  structureId: id.nullable(), frames: z.number().int().positive().max(2001).nullable(), partial: z.boolean(),
});
export const atomisticJobSchema = z.strictObject({ schemaVersion: z.literal(ATOMISTIC_CONTRACT_VERSION), id,
  projectId: id, planId: id, status: z.enum(["queued", "validating", "loading_model", "running", "cancelling", "completed", "failed", "cancelled", "interrupted"]),
  quality: z.enum(["unreviewed", "passed", "needs_review", "invalid"]),
  createdAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(), resultArtifactId: id.nullable(), error: text.nullable(),
}).refine(v => !["completed", "failed", "cancelled", "interrupted"].includes(v.status) || v.finishedAt !== null, "terminal job needs finish time")
  .refine(v => v.status !== "completed" || (v.resultArtifactId !== null && v.error === null), "completed job needs real result")
  .refine(v => v.status !== "failed" || v.error !== null, "failed job needs an error")
  .refine(v => v.quality !== "passed" || v.status === "completed", "only completed runs can pass quality");
export const atomisticResultSchema = z.strictObject({ schemaVersion: z.literal(ATOMISTIC_CONTRACT_VERSION), runId: id,
  planId: id, structureId: id, potentialId: id, potentialSha256: digest,
  atomCount: z.number().int().min(1).max(2000), energyEv: finite,
  forcesEvPerAngstrom: z.array(vector).min(1).max(2000),
  stress: z.strictObject({ unit: z.literal("eV/angstrom^3"), sign: z.literal("positive-tension"),
    order: z.literal("xx,yy,zz,yz,xz,xy"), values: z.tuple([finite, finite, finite, finite, finite, finite]) }).nullable(),
  stopReason: z.enum(["singlepoint", "converged", "max_steps", "cancelled", "failed"]),
  completedSteps: z.number().int().min(0).max(2000), quality: z.enum(["unreviewed", "passed", "needs_review", "invalid"]),
  validationEvidenceIds: z.array(id).max(20),
}).refine(v => v.forcesEvPerAngstrom.length === v.atomCount, "force shape must match atoms")
  .refine(v => v.quality !== "passed" || (v.validationEvidenceIds.length > 0 && ["singlepoint", "converged"].includes(v.stopReason)), "quality needs evidence and a successful stop condition");
export const atomicViewerConfigSchema = z.strictObject({ artifactId: id,
  style: z.enum(["ball-stick", "sphere", "stick"]), showCell: z.boolean(), showInferredBonds: z.boolean(),
  supercell: z.tuple([z.number().int().min(1).max(3), z.number().int().min(1).max(3), z.number().int().min(1).max(3)]),
  frame: z.number().int().min(0).max(2000), colorBy: z.enum(["element", "force-magnitude"]),
});
export const potentialSelectionSchema = z.strictObject({ schemaVersion: z.literal(ATOMISTIC_CONTRACT_VERSION),
  structureId: id, selectedPotentialId: id.nullable(), head: text.nullable(),
  candidates: z.array(z.strictObject({ potentialId: id, evidenceIds: z.array(id).min(1).max(20), reason: bilingual })).max(20),
  exclusions: z.array(z.strictObject({ potentialId: id, reasonCodes: z.array(id).min(1).max(30) })).max(20),
  limitations: z.array(bilingual).min(1).max(20), validationPlan: text,
}).refine(v => v.selectedPotentialId === null || v.candidates.some(c => c.potentialId === v.selectedPotentialId), "selection must come from candidates");
export const atomisticSchemas = { PotentialManifest: potentialManifestSchema, PotentialRegistry: potentialRegistrySchema,
  AtomicStructure: atomicStructureSchema, AtomisticBudget: atomisticBudgetSchema, AtomisticPlan: atomisticPlanSchema,
  AtomisticArtifact: atomisticArtifactSchema, AtomisticJob: atomisticJobSchema, AtomisticResult: atomisticResultSchema,
  AtomicViewerConfig: atomicViewerConfigSchema, PotentialSelection: potentialSelectionSchema };
