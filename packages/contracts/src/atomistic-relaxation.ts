import { z } from "zod";
import { atomicStructureSchema, cellDeterminant } from "./atomistic.js";
import { localId, runnablePotentialId, atomisticSnapshotSchema } from "./atomistic-runtime.js";
const finite=z.number().finite();
const vector=z.tuple([finite,finite,finite]);
export const relaxationOptionsSchema=z.strictObject({optimizer:z.literal("FIRE"),cellMode:z.enum(["fixed","variable"]),
  cellConstraint:z.enum(["none","hydrostatic","full"]),externalPressureGPa:finite.min(-10).max(10).nullable(),
  maxSteps:z.number().int().min(1).max(500),fmaxEvPerAngstrom:finite.min(.001).max(.2),
}).superRefine((v,c)=>{if(v.cellMode==="fixed"?(v.cellConstraint!=="none"||v.externalPressureGPa!==null):(v.cellConstraint==="none"||v.externalPressureGPa===null))c.addIssue({code:"custom",message:"cell constraint and explicit pressure must match cell mode"});});
export type RelaxationOptions=z.infer<typeof relaxationOptionsSchema>;
export const startRelaxationSchema=z.strictObject({projectId:localId,structureId:localId,potentialId:runnablePotentialId,
  options:relaxationOptionsSchema,budget:atomisticSnapshotSchema.shape.plan.shape.budget.optional()});
export const relaxationStepSchema=z.strictObject({step:z.number().int().min(0).max(500),energyEv:finite,objectiveEv:finite,
  maxForceEvPerAngstrom:finite.nonnegative(),maxFilterForceEvPerAngstrom:finite.nonnegative(),volumeAngstrom3:finite.positive(),
  minimumDistanceAngstrom:finite.min(.4),elapsedSeconds:finite.nonnegative()});
export const relaxationSummarySchema=z.strictObject({version:z.literal("m6.3-v1"),runId:localId,planId:localId,structureId:localId,
  finalStructureId:localId,finalStructureSha256:z.string().regex(/^[a-f0-9]{64}$/),options:relaxationOptionsSchema,
  stopReason:z.enum(["converged","max_steps"]),completedSteps:z.number().int().min(0).max(500),
  initial:relaxationStepSchema,final:relaxationStepSchema,
  displacementDefinition:z.literal("final-minus-initial-cartesian-no-MIC-includes-cell-strain"),
  displacementsAngstrom:z.array(vector).min(1).max(2000),quality:z.literal("needs_review"),
}).superRefine((v,c)=>{
  if(v.initial.step!==0||v.final.step!==v.completedSteps||v.completedSteps>v.options.maxSteps)c.addIssue({code:"custom",message:"invalid step accounting"});
  const converged=v.final.maxForceEvPerAngstrom<v.options.fmaxEvPerAngstrom&&v.final.maxFilterForceEvPerAngstrom<v.options.fmaxEvPerAngstrom;
  if((v.stopReason==="converged")!==converged||v.stopReason==="max_steps"&&v.completedSteps!==v.options.maxSteps)c.addIssue({code:"custom",message:"stop condition inconsistent with real forces"});
});
export const relaxationCheckpointSchema=z.strictObject({version:z.literal("m6.3-v1"),runId:localId,planId:localId,
  structure:atomicStructureSchema,step:relaxationStepSchema});
export const relaxationStateSchema=z.strictObject({options:relaxationOptionsSchema,progress:relaxationStepSchema.nullable(),
  summary:relaxationSummarySchema.nullable(),partialArtifactId:localId.nullable()});
export const scientificSnapshotSchema=atomisticSnapshotSchema.safeExtend({relaxation:relaxationStateSchema.optional()}).superRefine((v,c)=>{
  const r=v.relaxation;
  if((v.plan.task.kind==="relaxation")!==!!r)c.addIssue({code:"custom",message:"relaxation metadata mismatch"});
  if(!r)return;
  if(v.plan.task.kind==="relaxation"){
    const {cellConstraint,...task}=r.options;
    for(const key of Object.keys(task) as Array<keyof typeof task>)if(task[key]!==v.plan.task[key])c.addIssue({code:"custom",message:"options differ from plan"});
  }
  if(r.summary&&(r.summary.runId!==v.job.id||r.summary.planId!==v.plan.id||r.summary.structureId!==v.structure.id||r.summary.displacementsAngstrom.length!==v.structure.atoms.length||v.result?.stopReason!==r.summary.stopReason||v.result.completedSteps!==r.summary.completedSteps))c.addIssue({code:"custom",message:"relaxation result scope mismatch"});
  if(v.job.status==="completed"&&!r.summary)c.addIssue({code:"custom",message:"completed relaxation needs summary"});
  if(r.partialArtifactId&&!v.artifacts.some(a=>a.id===r.partialArtifactId&&a.partial&&a.type==="atomic_structure"))c.addIssue({code:"custom",message:"partial checkpoint not registered"});
});
export type ScientificSnapshot=z.infer<typeof scientificSnapshotSchema>;
export type RelaxationSummary=z.infer<typeof relaxationSummarySchema>;
export const relaxationHistorySchema=z.array(relaxationStepSchema).min(1).max(501).refine(rows=>rows.every((r,i)=>r.step===i),"history steps must be continuous");
export const relaxationComparisonSchema=z.strictObject({version:z.literal("m6.3-v1"),projectId:localId,runId:localId,
  history:relaxationHistorySchema,before:atomicStructureSchema,after:atomicStructureSchema,forcesEvPerAngstrom:z.array(vector).min(1).max(2000),summary:relaxationSummarySchema,
}).superRefine((v,c)=>{
 if(JSON.stringify(v.history[0])!==JSON.stringify(v.summary.initial)||JSON.stringify(v.history.at(-1))!==JSON.stringify(v.summary.final))c.addIssue({code:"custom",message:"history differs from summary"});
 if(v.runId!==v.summary.runId||v.before.id!==v.summary.structureId||v.after.id!==v.summary.finalStructureId||v.before.atoms.length!==v.after.atoms.length||v.forcesEvPerAngstrom.length!==v.after.atoms.length||v.summary.displacementsAngstrom.length!==v.after.atoms.length)c.addIssue({code:"custom",message:"comparison count/identity mismatch"});
 v.before.atoms.forEach((a,i)=>{const b=v.after.atoms[i],delta=v.summary.displacementsAngstrom[i];if(!b||!delta||a.id!==b.id||a.element!==b.element||a.occupancy!==b.occupancy)c.addIssue({code:"custom",message:"atom mapping changed"});else if(a.position.some((x,k)=>Math.abs((b.position[k]!-x)-delta[k]!)>1e-8))c.addIssue({code:"custom",message:"displacement mismatch"});});
 if(v.summary.options.cellMode==="fixed"&&JSON.stringify(v.before.cell)!==JSON.stringify(v.after.cell))c.addIssue({code:"custom",message:"fixed cell changed"});
 if(JSON.stringify(v.before.pbc)!==JSON.stringify(v.after.pbc)||v.before.charge!==v.after.charge||v.before.spinMultiplicity!==v.after.spinMultiplicity)c.addIssue({code:"custom",message:"periodicity/charge/spin changed"});
 if(!v.after.cell||cellDeterminant(v.after.cell)<=0)c.addIssue({code:"custom",message:"invalid final cell"});
});
export const comparisonSceneSchema=z.strictObject({type:z.literal("comparison"),payload:relaxationComparisonSchema,
 style:z.enum(["ball-stick","sphere","stick"]),colorBy:z.enum(["element","displacement","force"]),showCell:z.boolean(),sync:z.boolean(),theme:z.enum(["materials-dark","codex-light"])});
export const comparisonCommandSchema=z.union([comparisonSceneSchema,z.strictObject({type:z.enum(["reset","dispose"])})]);
export const comparisonEventSchema=z.discriminatedUnion("type",[z.strictObject({type:z.literal("ready")}),z.strictObject({type:z.literal("rendered")}),z.strictObject({type:z.literal("error"),message:z.string().max(1000)})]);
export const relaxationSchemas={ScientificSnapshot:scientificSnapshotSchema,RelaxationOptions:relaxationOptionsSchema,StartRelaxation:startRelaxationSchema,RelaxationStep:relaxationStepSchema,
 RelaxationSummary:relaxationSummarySchema,RelaxationCheckpoint:relaxationCheckpointSchema,RelaxationComparison:relaxationComparisonSchema,RelaxationHistory:relaxationHistorySchema,ComparisonScene:comparisonSceneSchema,ComparisonCommand:comparisonCommandSchema,ComparisonEvent:comparisonEventSchema};
