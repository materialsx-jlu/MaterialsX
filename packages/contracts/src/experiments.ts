import {z} from 'zod';
const text=z.string().trim().min(1).max(2000),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const experimentConfigInput=z.strictObject({
  datasetId:z.uuid(),expectedRevision:z.number().int().nonnegative(),specimenId:text,
  mode:z.enum(['stress-strain','force-displacement']),xColumn:text,yColumn:text,
  xUnit:z.enum(['1','%','mm','m']),yUnit:z.enum(['Pa','MPa','GPa','N','kN']),
  areaMm2:z.number().finite().positive().max(1e9),gaugeLengthMm:z.number().finite().positive().max(1e7).nullable(),
  strainSource:z.enum(['extensometer','dic','crosshead','reported']),conditions:text,
  acquisition:z.enum(['measured','digitized']),digitizationUncertainty:text.nullable(),
  elasticRegionConfirmed:z.boolean(),fitRange:z.tuple([z.number().finite().nonnegative(),z.number().finite().positive()]),
  exclusions:z.array(z.strictObject({row:z.number().int().min(2).max(100002),reason:text})).max(1000),
}).superRefine((v,c)=>{
  const issue=(message:string)=>c.addIssue({code:'custom',message});
  if(v.fitRange[0]>=v.fitRange[1])issue('FIT_RANGE_INVALID / 拟合区间必须递增，使用无量纲应变');
  if(v.xColumn===v.yColumn)issue('DISTINCT_COLUMNS_REQUIRED');
  if(new Set(v.exclusions.map(r=>r.row)).size!==v.exclusions.length)issue('DUPLICATE_EXCLUSION');
  if(v.mode==='stress-strain'&&(!['1','%'].includes(v.xUnit)||!['Pa','MPa','GPa'].includes(v.yUnit)))issue('STRESS_STRAIN_UNITS_REQUIRED');
  if(v.mode==='force-displacement'&&(!['mm','m'].includes(v.xUnit)||!['N','kN'].includes(v.yUnit)||!v.gaugeLengthMm))issue('FORCE_DISPLACEMENT_UNITS_AND_GAUGE_REQUIRED');
  if(v.mode==='force-displacement'&&v.strainSource==='reported')issue('DISPLACEMENT_MEASUREMENT_SOURCE_REQUIRED');
  if(v.acquisition==='digitized'&&!v.digitizationUncertainty)issue('DIGITIZATION_UNCERTAINTY_REQUIRED');
});
export type ExperimentConfigInput=z.infer<typeof experimentConfigInput>;
export const experimentConfigSchema=z.object({id:z.uuid(),projectId:z.uuid(),revision:z.number().int().positive(),createdAt:z.iso.datetime(),sha256:sha,input:experimentConfigInput});
export type ExperimentConfig=z.infer<typeof experimentConfigSchema>;
export const experimentDatasetSchema=z.strictObject({id:z.uuid(),projectId:z.uuid(),title:text,format:z.enum(['csv','xlsx']),sheet:z.string().nullable(),
  createdAt:z.iso.datetime(),columns:z.array(text).min(2).max(64),rows:z.number().int().min(3).max(10000),
  original:z.strictObject({path:text,sha256:sha,bytes:z.number().int().positive()}),
  table:z.strictObject({path:text,sha256:sha,bytes:z.number().int().positive()}),preview:z.array(z.strictObject({row:z.number().int().positive(),values:z.record(z.string(),z.string())})).max(8)});
export type ExperimentDataset=z.infer<typeof experimentDatasetSchema>;
export const experimentRunInput=z.strictObject({configurationIds:z.array(z.uuid()).min(1).max(20),independentReplicates:z.boolean(),reason:text})
  .superRefine((v,c)=>{if(new Set(v.configurationIds).size!==v.configurationIds.length)c.addIssue({code:'custom',message:'Duplicate configuration IDs'});});
export type ExperimentRunInput=z.infer<typeof experimentRunInput>;
export const experimentRunSchema=z.object({id:z.uuid(),projectId:z.uuid(),taskId:z.uuid().nullable(),createdAt:z.iso.datetime(),
  policyVersion:z.literal('ua8-tensile-v1'),scientificStatus:z.literal('needs_review'),productionApproved:z.literal(false),
  status:z.enum(['completed','stale']),request:experimentRunInput,configurationHashes:z.array(z.strictObject({id:z.uuid(),sha256:sha})),
  inputHashes:z.array(z.strictObject({id:z.uuid(),sha256:sha})),algorithmSha256:sha,result:z.record(z.string(),z.unknown()),
  artifacts:z.array(z.strictObject({path:text,sha256:sha,bytes:z.number().int().positive()})).max(12)});
export type ExperimentRun=z.infer<typeof experimentRunSchema>;
export interface ExperimentOverview {datasets:ExperimentDataset[];configurations:ExperimentConfig[];runs:ExperimentRun[]}
export interface ExperimentDesktopAPI {
  getExperiments(projectId:string):Promise<ExperimentOverview>;
  importExperiment(projectId:string):Promise<ExperimentDataset|null>;
  configureExperiment(projectId:string,input:ExperimentConfigInput):Promise<ExperimentConfig>;
  runExperiment(projectId:string,input:ExperimentRunInput):Promise<ExperimentRun>;
  previewExperiment(projectId:string,runId:string,path:string):Promise<string>;
}
