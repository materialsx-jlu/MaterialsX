import { z } from "zod";
import { atomicStructureSchema, atomisticBudgetSchema, atomisticJobSchema, atomisticPlanSchema, atomisticResultSchema, atomisticArtifactSchema } from "./atomistic.js";
export const localId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/);
export const corePotentialId = z.enum(["mace-mp-0b3-medium", "chgnet-0.3.0"]);
export const runnablePotentialId = z.enum(["mace-mp-0b3-medium", "chgnet-0.3.0", "chgnet-r2scan"]);
export type RunnablePotentialId = z.infer<typeof runnablePotentialId>;
export const startAtomisticSchema = z.strictObject({ projectId: localId, structureId: localId,
  potentialId: runnablePotentialId, budget: atomisticBudgetSchema.optional() });
export const inspectAtomisticSchema = z.strictObject({ projectId: localId, structureId: localId });
export const getAtomisticSchema = z.strictObject({ projectId: localId, runId: localId });
export const atomisticSnapshotSchema = z.strictObject({ job: atomisticJobSchema, plan: atomisticPlanSchema,
  structure: atomicStructureSchema, result: atomisticResultSchema.nullable(),
  artifacts: z.array(atomisticArtifactSchema).max(20), outputDirectory: z.string().max(4096) }).superRefine((v,ctx)=>{
    if(v.job.projectId!==v.plan.projectId||v.job.planId!==v.plan.id||v.plan.structureId!==v.structure.id)ctx.addIssue({code:"custom",message:"snapshot scope mismatch"});
    if(v.result&&(v.result.runId!==v.job.id||v.result.planId!==v.plan.id||v.result.potentialId!==v.plan.potentialId||v.result.structureId!==v.structure.id))ctx.addIssue({code:"custom",message:"result scope mismatch"});
    if(v.artifacts.some(a=>a.projectId!==v.job.projectId||a.runId!==v.job.id))ctx.addIssue({code:"custom",message:"artifact scope mismatch"});
  });
export type AtomisticSnapshot = z.infer<typeof atomisticSnapshotSchema>;
export type StartAtomisticInput = z.infer<typeof startAtomisticSchema>;
export interface AtomisticRuntimeStatus { potentialId: RunnablePotentialId;
  installed: boolean; portable: boolean; platform: string; dependencyLockSha256: string | null; error: string | null }
