import { z } from 'zod';
import { evidenceRefSchema } from './agent.js';
const text = z.string().min(1).max(16000), sha = z.string().regex(/^[a-f0-9]{64}$/);
export const moosRefSchema = z.strictObject({
  connectionId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), sourceId: z.number().int().positive(),
  packageImportId: z.number().int().positive(), experimentId: z.number().int().positive(), generation: z.number().int().positive(),
  packageSha256: sha, projectionSha256: sha, reviewScope: z.enum(['verified','include-unreviewed']),
  reviewStatus: z.enum(['verified','pending_review','unreviewed','needs_review']),
});
export type MoosRef = z.infer<typeof moosRefSchema>;
export const deliveryContractSchema = z.strictObject({
  kind: z.enum(['comparison','recipe-process','simulation-gaps']),
  required: z.array(z.enum(['table','chart','report','image'])).min(1).max(4),
  optional: z.array(z.enum(['table','chart','report','image'])).max(4),
  checks: z.array(z.strictObject({ property: text, unit: text, condition: text, expected: z.number().finite(), tolerance: z.number().finite().nonnegative() })).max(32),
  requireEvidence: z.boolean(), requireReviewed: z.boolean(), allowedLimitations: z.array(z.enum(['unreviewed','missing-unit','missing-condition','not-comparable','simulation-not-executed','no-image'])).max(6),
}).superRefine((d,c)=>{if(new Set([...d.required,...d.optional]).size!==d.required.length+d.optional.length)c.addIssue({code:'custom',message:'Duplicate artifact criteria'});});
export type DeliveryContract = z.infer<typeof deliveryContractSchema>;
export function defaultDeliveryContract(kind: DeliveryContract['kind'] = 'comparison'): DeliveryContract {
  return {kind,required:['table','chart','report'],optional:['image'],checks:[],requireEvidence:true,requireReviewed:false,
    allowedLimitations:['unreviewed','missing-unit','missing-condition','not-comparable','simulation-not-executed','no-image']};
}
export const researchProjectSchema = z.strictObject({
  schemaVersion:z.literal('research-project-v1'),projectId:z.uuid(),revision:z.number().int().positive(),
  materialSystem:z.string().max(300),conditions:z.array(text).max(32),samples:z.array(z.strictObject({id:text,label:text,snapshotId:z.uuid().nullable()})).max(100),
  activeStudyId:z.uuid().nullable().optional(),selected:z.array(z.uuid()).max(100),withdrawn:z.array(z.uuid()).max(100),
  decisions:z.array(z.strictObject({at:z.string(),text,origin:z.enum(['user','source'])})).max(200),
  delivery:deliveryContractSchema,updatedAt:z.string(),
});
export type ResearchProject = z.infer<typeof researchProjectSchema>;
export const researchSnapshotSchema = z.strictObject({
  id:z.uuid(),projectId:z.uuid(),origin:z.enum(['project','moos']),title:text,ref:moosRefSchema.nullable(),
  sha256:sha,version:text,retrievedAt:z.string(),reviewStatus:z.enum(['verified','pending_review','unreviewed','needs_review']),
  evidence:z.array(evidenceRefSchema).max(200),data:z.record(z.string(),z.unknown()),receipts:z.array(z.unknown()).max(1000),
});
export type ResearchSnapshot=z.infer<typeof researchSnapshotSchema>;
export const researchBindingSchema=z.strictObject({
  taskId:z.uuid(),projectId:z.uuid(),projectRevision:z.number().int().positive(),locale:z.enum(['zh','en']),
  conditions:z.array(text),materialSystem:z.string(),samples:researchProjectSchema.shape.samples.default([]),delivery:deliveryContractSchema,snapshotIds:z.array(z.uuid()).max(100),
  approvedInputs:z.array(z.strictObject({id:text,version:text,sha256:sha})),createdAt:z.string(),
});
export type ResearchBinding=z.infer<typeof researchBindingSchema>;
export const sourceReceiptSchema=z.strictObject({
  id:z.uuid(),projectId:z.uuid(),taskId:z.uuid().nullable(),tool:text,args:z.unknown(),origin:z.enum(['project','moos']),
  outcome:z.enum(['matched','no_match','filtered_page','unavailable','denied','stale','invalid','cancelled']),
  at:z.string(),sha256:sha.nullable(),detail:z.string(),
});
export type SourceReceipt=z.infer<typeof sourceReceiptSchema>;
export const deliveryRecordSchema=z.strictObject({
  id:z.uuid(),projectId:z.uuid(),taskId:z.uuid(),planRevision:z.number().int().positive(),contractSha256:sha,
  snapshotIds:z.array(z.uuid()),stepIds:z.array(z.string()).max(64),createdAt:z.string(),scientificStatus:z.literal('needs_review'),
  status:z.enum(['accepted-with-limitations','blocked','stale']),limitations:z.array(z.string()),
  checks:z.array(z.strictObject({id:text,status:z.enum(['pass','fail','missing','allowed']),detail:text})),
  artifacts:z.array(z.strictObject({kind:z.enum(['table','chart','report','image']),path:text,sha256:sha,bytes:z.number().int().nonnegative()})),
  sourceResult:z.unknown(),
});
export type DeliveryRecord=z.infer<typeof deliveryRecordSchema>;
export interface ResearchOverview {
  project:ResearchProject;snapshots:ResearchSnapshot[];receipts:SourceReceipt[];deliveries:DeliveryRecord[];
  bindings:ResearchBinding[];projectHistory:ResearchProject[];planHistory:import('./research-goal.js').ResearchGoalPlan[];
}
export interface ResearchDesktopAPI {
  listResearchDeliveries(projectId:string):Promise<DeliveryRecord[]>;
  getResearchRevisionInputs(taskId:string):Promise<ResearchBinding>;
  getResearchProject(projectId:string):Promise<ResearchOverview>;
  previewResearchArtifact(projectId:string,deliveryId:string,kind:'table'|'chart'|'report'):Promise<string>;
}
