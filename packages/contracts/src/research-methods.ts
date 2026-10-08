import {z} from 'zod';
import {selectionRequestSchema} from './potential-physics.js';
import {methodPackagePin} from './method-packages.js';
const text=z.string().min(1).max(2000),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const methodIds=['descriptive-summary','linear-fit','grouped-linear-validation','atomistic-screening'] as const;
export const observationRef=z.strictObject({snapshotId:z.uuid(),observationId:text});
const methodFields={
  question:text,task:z.enum(['summarize','fit','validate','atomistic']),
  samples:z.array(z.strictObject({id:text,y:observationRef,x:observationRef.optional(),split:z.enum(['train','validation','test']).optional()})).max(300).default([]),
  atomic:z.strictObject({structureId:text,domain:selectionRequestSchema.shape.domain,
    task:z.enum(['singlepoint','relaxation','md']),mode:z.enum(['exploratory','production']),
    interaction:z.enum(['short-range','long-range-required','dispersion-required','spin-required','field-required','delta-required','multi-head-required']).optional(),
  }).optional(),
};
const checkMethod=(v:{task:string;atomic?:unknown;samples:Array<{id:string}>},c:z.RefinementCtx)=>{
  if((v.task==='atomistic')!==!!v.atomic)c.addIssue({code:'custom',message:'Atomistic task requires atomic input only'});
  if(v.task==='atomistic'&&v.samples.length)c.addIssue({code:'custom',message:'Atomistic assessment uses existing structure IDs'});
  if(v.task!=='atomistic'&&!v.samples.length)c.addIssue({code:'custom',message:'Owned source observations required'});
  if(new Set(v.samples.map(s=>s.id)).size!==v.samples.length)c.addIssue({code:'custom',message:'Duplicate sample IDs'});
};
export const methodInput=z.strictObject(methodFields).superRefine(checkMethod);
/** Omitted question means the exact frozen user request, never an inferred research goal. */
export const methodToolInput=z.strictObject({...methodFields,question:text.optional().describe('May be omitted to use the exact original user request already frozen in this task. Supplied questions remain explicit and must be nonempty; task and owned sample references are still required.')}).superRefine(checkMethod);
export const methodRunInput=z.strictObject({assessmentId:z.uuid().describe('Copy id from the actual owned research_methods action=assess receipt. This is not a snapshotId or observationId.'),methodId:z.enum(methodIds).describe('Copy an eligible candidates[].methodId from that same assessment; excluded methods cannot run.'),reason:text.describe('Required nonempty explanation for choosing this eligible method for the original task and its limits.')});
/** Engine tools may use the already-bound task only when the eligible choice is unique. Domain API remains explicit. */
export const methodRunToolInput=methodRunInput.extend({assessmentId:methodRunInput.shape.assessmentId.optional().describe('Usually omit for the one eligible assessment already bound to this task. If supplied, it must be an exact owned UUID; an invalid ID is never replaced.'),methodId:methodRunInput.shape.methodId.optional().describe('Omit only when the task has exactly one eligible fixed method. Supply a candidate methodId to disambiguate; no guessing or fallback.')});
export const methodDescriptorSchema=z.strictObject({
  id:z.enum(methodIds),name:z.strictObject({zh:text,en:text}),description:z.strictObject({zh:text,en:text}),
  qualification:z.enum(['fixed-algorithm','delegated-m6']),scope:z.array(text),requiredInputs:z.array(text),
  tool:text,productionApproved:z.literal(false),
});
export type MethodDescriptor=z.infer<typeof methodDescriptorSchema>;
export const methodAssessmentSchema=z.strictObject({
  id:z.uuid(),projectId:z.uuid(),taskId:z.uuid().nullable(),createdAt:z.iso.datetime(),registryVersion:z.literal('ua7-methods-v1'),
  request:methodInput,inputHashes:z.array(z.strictObject({id:z.uuid(),sha256:sha,version:text})).max(20),
  candidates:z.array(z.strictObject({methodId:z.enum(methodIds),evidenceIds:z.array(text),limitations:z.array(text)})),
  exclusions:z.array(z.strictObject({methodId:z.enum(methodIds),reasons:z.array(text)})),
  atomicReceipt:z.unknown().nullable(),
  packagePins:z.array(methodPackagePin).max(2).optional(),
});
export type MethodAssessment=z.infer<typeof methodAssessmentSchema>;
export const methodAnalysisSchema=z.strictObject({
  id:z.uuid(),assessmentId:z.uuid(),projectId:z.uuid(),taskId:z.uuid().nullable(),methodId:z.enum(methodIds),
  createdAt:z.iso.datetime(),reason:text,status:z.enum(['completed','stale']),scientificStatus:z.literal('needs_review'),
  productionApproved:z.literal(false),result:z.record(z.string(),z.unknown()),limitations:z.array(text),
  methodPackage:methodPackagePin.optional(),referenceReceipt:z.uuid().optional(),
  artifacts:z.array(z.strictObject({path:text,sha256:sha,bytes:z.number().int().positive()})).max(4),
});
export type MethodAnalysis=z.infer<typeof methodAnalysisSchema>;
export type MethodRequest=z.infer<typeof methodInput>;
