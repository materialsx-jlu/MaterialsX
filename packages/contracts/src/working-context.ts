import {z} from 'zod';
import {boundReferenceSchema} from './task-references.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const text=z.string().max(16000);
export const contextReferenceSchema=boundReferenceSchema.extend({
 status:z.enum(['bound','metadata-only','not-authorized','stale','unreadable']),
 originTaskId:z.uuid().nullable(),assetTaskId:z.uuid().optional(),assetRef:hash.optional(),exportScope:z.enum(['local-only','approved-cloud']),
 readings:z.array(z.strictObject({taskId:z.uuid(),receiptId:z.string(),resultRef:hash,range:z.string().max(500),omitted:z.string().max(500)})).max(32),
});
export type ContextReference=z.infer<typeof contextReferenceSchema>;
export const workingContextSchema=z.strictObject({
 schemaVersion:z.literal('working-context-v1'),revision:z.number().int().positive(),sha256:hash,
 projectId:z.uuid(),conversationId:z.uuid(),accountRef:z.string(),authorizationHash:hash.nullable(),
 references:z.array(contextReferenceSchema).max(128),
 history:z.array(z.strictObject({taskId:z.uuid(),planRevision:z.number().int().nonnegative(),request:text,state:z.string(),
  receipts:z.array(z.strictObject({id:z.string(),method:z.string(),resultRef:hash})).max(32),
  artifacts:z.array(z.strictObject({name:z.string(),path:z.string(),sha256:hash,bytes:z.number().int().nonnegative(),status:z.enum(['verified','stale','unreadable'])})).max(64),
 })).max(8),
 notices:z.array(z.string().max(1200)).max(64),ambiguities:z.array(z.string().max(1200)).max(16),
 omitted:z.strictObject({history:z.number().int().nonnegative(),references:z.number().int().nonnegative(),receipts:z.number().int().nonnegative()}),
});
export type WorkingContext=z.infer<typeof workingContextSchema>;
export const deliveryAssessmentSchema=z.strictObject({
 schemaVersion:z.literal('delivery-assessment-v1'),planRevision:z.number().int().nonnegative(),
 technical:z.enum(['complete','partial','incomplete']),scientific:z.literal('needs_review'),
 verified:z.array(z.string()).max(128),missing:z.array(z.string()).max(128),issues:z.array(z.string().max(1200)).max(64),
});
export type DeliveryAssessment=z.infer<typeof deliveryAssessmentSchema>;
