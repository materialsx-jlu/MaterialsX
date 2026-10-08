import {z} from 'zod';
import {taskCompletionSchema} from './agent.js';

const text=z.string().min(1).max(2000), sha=z.string().regex(/^[a-f0-9]{64}$/);
export const scientificCheckSchema=z.strictObject({
  code:text,status:z.enum(['pass','warning','blocked']),refs:z.array(text).max(500),detail:text,
});
export const fieldRefSchema=z.strictObject({
  snapshotId:z.uuid(),section:z.enum(['observations','ingredients','recipes','processes']),rowId:text,
  field:z.enum(['value','amount','unit','basis','conditions','source_text']),evidenceIds:z.array(text).min(1).max(20),
});
export const scientificClaimSchema=z.strictObject({
  id:text,text,kind:z.enum(['reported','calculated','predicted']),refs:z.array(fieldRefSchema).min(1).max(20),
  quantity:z.strictObject({value:z.number().finite(),unit:text}).optional(),
});
export const qualityAuditInput=z.strictObject({
  snapshotIds:z.array(z.uuid()).min(1).max(20),claims:z.array(scientificClaimSchema).max(100).default([]),
});
export const qualityAuditToolInput=qualityAuditInput.extend({snapshotIds:qualityAuditInput.shape.snapshotIds.optional().describe('Usually omit to audit the explicit frozen task selection. Provide exact owned IDs for a subset; supplied invalid IDs are never replaced.')});
export const qualityReportSchema=z.strictObject({
  id:z.uuid(),projectId:z.uuid(),taskId:z.uuid().nullable(),createdAt:z.iso.datetime(),
  policyVersion:z.literal('ua7-quality-v1'),scientificStatus:taskCompletionSchema.shape.scientificStatus,
  decision:z.enum(['usable-with-limitations','blocked','stale']),
  inputs:z.array(z.strictObject({id:z.uuid(),version:text,sha256:sha})).max(20),
  claims:z.array(scientificClaimSchema).max(100),checks:z.array(scientificCheckSchema).max(600),
  artifacts:z.array(z.strictObject({path:text,sha256:sha,bytes:z.number().int().positive()})).max(4),
});
export type ScientificCheck=z.infer<typeof scientificCheckSchema>;
export type ScientificClaim=z.infer<typeof scientificClaimSchema>;
export type QualityReport=z.infer<typeof qualityReportSchema>;
export const sourceNoticeInput=z.strictObject({
  snapshotId:z.uuid(),kind:z.enum(['updated','corrected','retracted','access-denied']),reason:text,
  replacementSnapshotId:z.uuid().nullable(),
});
export const sourceNoticeSchema=sourceNoticeInput.extend({
  id:z.uuid(),projectId:z.uuid(),at:z.iso.datetime(),origin:z.literal('user'),
});
export type SourceNotice=z.infer<typeof sourceNoticeSchema>;
export interface SourceImpact {
  snapshotIds:string[];deliveryIds:string[];auditIds:string[];analysisIds:string[];
  tasks:Array<{taskId:string;planRevision:number;stepIds:string[]}>;
}
export interface ScientificOverview {
  audits:QualityReport[];notices:SourceNotice[];impact:SourceImpact;
  methods:import('./research-methods.js').MethodDescriptor[];
  assessments:import('./research-methods.js').MethodAssessment[];
  analyses:import('./research-methods.js').MethodAnalysis[];
}
export interface ScientificDesktopAPI {
  getScientificOverview(projectId:string):Promise<ScientificOverview>;
  auditScientificData(projectId:string,input:z.input<typeof qualityAuditInput>):Promise<QualityReport>;
  recordSourceNotice(projectId:string,input:z.input<typeof sourceNoticeInput>):Promise<SourceNotice>;
  assessResearchMethods(projectId:string,input:z.input<typeof methodInput>):Promise<import('./research-methods.js').MethodAssessment>;
  runResearchMethod(projectId:string,input:z.input<typeof methodRunInput>):Promise<import('./research-methods.js').MethodAnalysis>;
  previewScientificArtifact(projectId:string,recordId:string,path:string):Promise<string>;
}
// Runtime imports are one-way: methods use scientificCheckSchema, never this API declaration.
import {methodInput,methodRunInput} from './research-methods.js';
