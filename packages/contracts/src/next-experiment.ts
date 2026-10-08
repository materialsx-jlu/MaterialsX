import {z} from 'zod';
const text=z.string().trim().min(1).max(2000),key=z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const studyInput=z.strictObject({
  expectedProjectRevision:z.number().int().positive(),materialSystem:z.string().trim().min(1).max(300),question:text,
  hypotheses:z.array(z.strictObject({statement:text,alternative:text,falsification:text})).min(1).max(10),
  snapshotIds:z.array(z.uuid()).max(20),experimentalUnit:text,measurementConditions:text,
  response:z.strictObject({metric:z.enum(['fitSlopeMPa','observedPeakStressMPa','reported']),property:text,unit:text,direction:z.enum(['maximize','minimize']),target:z.number().finite().nullable()}),
  factors:z.array(z.strictObject({key,label:text,unit:text,kind:z.enum(['continuous','discrete']),levels:z.array(z.number().finite()).min(2).max(5),costPerUnitCny:z.number().finite().nonnegative().max(1e6)})).min(1).max(3),
  constraints:z.array(z.strictObject({terms:z.record(key,z.number().finite()),min:z.number().finite().nullable(),max:z.number().finite().nullable(),reason:text})).max(12),
  control:z.record(key,z.number().finite()),blocks:z.array(text).min(1).max(8),replicates:z.number().int().min(1).max(5),
  baseCostCny:z.number().finite().positive().max(1e7),minutesPerRun:z.number().finite().positive().max(1e6),costBasis:text,
  maxCostCny:z.number().finite().positive().max(1e9),maxMinutes:z.number().finite().positive().max(1e9),maxRuns:z.number().int().min(2).max(400),manufacturabilityNotes:text,
}).superRefine((v,c)=>{
  const issue=(message:string)=>c.addIssue({code:'custom',message}),keys=v.factors.map(f=>f.key);
  if(new Set(keys).size!==keys.length||new Set(v.blocks).size!==v.blocks.length||new Set(v.snapshotIds).size!==v.snapshotIds.length)issue('DUPLICATE_STUDY_FIELDS');
  for(const f of v.factors)if(new Set(f.levels).size!==f.levels.length||f.levels.some((n,i)=>i>0&&n<=f.levels[i-1]!))issue('LEVELS_MUST_BE_DISTINCT_AND_INCREASING');
  for(const f of v.factors)if(!Number.isFinite(f.levels.at(-1)!-f.levels[0]!))issue('FACTOR_RANGE_TOO_LARGE');
  if(Object.keys(v.control).length!==keys.length||keys.some(k=>v.control[k]===undefined))issue('CONTROL_FACTOR_KEYS_REQUIRED');
  for(const r of v.constraints)if(!Object.keys(r.terms).length||Object.keys(r.terms).some(k=>!keys.includes(k))||r.min===null&&r.max===null||r.min!==null&&r.max!==null&&r.min>r.max)issue('LINEAR_CONSTRAINT_INVALID');
  if(v.response.metric!=='reported'&&v.response.unit!=='MPa')issue('UA8_RESPONSE_REQUIRES_MPA');
});
export type StudyInput=z.infer<typeof studyInput>;
export const studySchema=z.object({id:z.uuid(),projectId:z.uuid(),createdAt:z.iso.datetime(),sha256:sha,input:studyInput});
export type ResearchStudy=z.infer<typeof studySchema>;
export const nextDesignInput=z.strictObject({studyId:z.uuid(),method:z.enum(['factorial','latin-hypercube','bayesian','active-learning']),points:z.number().int().min(1).max(32),seed:z.number().int().min(1).max(4294967295),reason:text});
export type NextDesignInput=z.infer<typeof nextDesignInput>;
export const feedbackInput=z.strictObject({expectedProjectRevision:z.number().int().positive(),designId:z.uuid(),plannedRunId:text,
  outcome:z.enum(['measured','failed','deviated']),actualFactors:z.record(key,z.number().finite()),reviewed:z.boolean(),notes:text,supersedes:z.uuid().nullable(),
  source:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('ua8'),runId:z.uuid(),specimenId:text}),
    z.strictObject({kind:z.literal('reported'),snapshotId:z.uuid(),observationId:text}),
  ]).nullable(),
}).superRefine((v,c)=>{if(v.outcome==='measured'&&!v.source)c.addIssue({code:'custom',message:'MEASUREMENT_REQUIRES_REAL_SOURCE'});});
export type FeedbackInput=z.infer<typeof feedbackInput>;
export const feedbackSchema=z.object({id:z.uuid(),projectId:z.uuid(),studyId:z.uuid(),createdAt:z.iso.datetime(),sha256:sha,input:feedbackInput,
  value:z.number().finite().nullable(),unit:text,sourceSnapshotIds:z.array(z.uuid()),sourceIdentity:text.nullable(),conditions:text,
  evidence:z.array(z.object({snapshotId:z.uuid(),sha256:sha,locator:text})),scientificStatus:z.literal('needs_review'),deviations:z.array(text)});
export type ExperimentFeedback=z.infer<typeof feedbackSchema>;
const finite=z.number().finite(), nonnegative=finite.nonnegative(), factors=z.record(key,finite);
const proposed=z.strictObject({id:text,factors,costCny:finite.positive(),minutes:finite.positive(),prediction:finite.nullable(),sd:nonnegative.nullable(),score:nonnegative.nullable(),uncertaintySource:text,manufacturability:z.literal('needs_review')});
const planned=z.strictObject({id:text,pointId:text,role:z.enum(['control','treatment']),block:text,replicate:z.number().int().positive(),order:z.number().int().positive(),factors,costCny:finite.positive(),minutes:finite.positive(),status:z.literal('planned')});
export const nextDesignResultSchema=z.strictObject({status:z.enum(['planned','blocked']),reasons:z.array(text),points:z.array(proposed).max(126),schedule:z.array(planned).max(400),estimatedCostCny:nonnegative,estimatedMinutes:nonnegative,
  optimization:z.strictObject({enabled:z.boolean(),eligibleRows:z.number().int().nonnegative(),uniqueConditions:z.number().int().nonnegative(),validation:z.record(z.string(),finite).nullable(),reasons:z.array(text)}),
  baselines:z.array(z.strictObject({method:z.enum(['factorial','random']),points:z.number().int().nonnegative(),meanAcquisitionPerCost:nonnegative.nullable(),meaning:text})).max(2),
  limitations:z.array(text),scientificStatus:z.literal('needs_review'),productionApproved:z.literal(false),
}).superRefine((v,c)=>{if(v.status==='planned'&&(!v.schedule.length||v.reasons.length)||v.status==='blocked'&&(!v.reasons.length||v.schedule.length))c.addIssue({code:'custom',message:'DESIGN_STATUS_INCONSISTENT'});});
export type NextDesignResult=z.infer<typeof nextDesignResultSchema>;
export const nextDesignSchema=z.object({id:z.uuid(),projectId:z.uuid(),taskId:z.uuid().nullable(),studyId:z.uuid(),studySha256:sha,createdAt:z.iso.datetime(),
  policyVersion:z.literal('ua9-design-v1'),request:nextDesignInput,feedbackHashes:z.array(z.object({id:z.uuid(),sha256:sha})).max(400),sourceHashes:z.array(z.object({id:z.uuid(),sha256:sha})).max(100),
  result:nextDesignResultSchema,artifacts:z.array(z.object({path:text,sha256:sha,bytes:z.number().int().positive()})).max(12)});
export type NextExperimentDesign=z.infer<typeof nextDesignSchema>;
export interface NextExperimentOverview {projectRevision:number;study:ResearchStudy|null;studies:ResearchStudy[];feedback:ExperimentFeedback[];designs:Array<NextExperimentDesign&{historical:boolean;sourceInvalid:boolean}>}
export interface NextExperimentAPI {
  getNextExperiments(projectId:string):Promise<NextExperimentOverview>;
  saveResearchStudy(projectId:string,input:StudyInput):Promise<ResearchStudy>;
  designNextExperiments(projectId:string,input:NextDesignInput):Promise<NextExperimentDesign>;
  recordExperimentFeedback(projectId:string,input:FeedbackInput):Promise<ExperimentFeedback>;
  previewNextExperiment(projectId:string,designId:string,path:string):Promise<string>;
}
