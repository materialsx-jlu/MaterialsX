import { z } from 'zod';
const id = z.string().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const capabilityFactSchema = z.strictObject({
  id, label: z.strictObject({ zh: z.string().max(256), en: z.string().max(256) }),
  kind: z.enum(['tool', 'host-action', 'resource', 'service']),
  registered: z.boolean(), configured: z.boolean().nullable(), installed: z.boolean().nullable(),
  authorization: z.enum(['allowed', 'denied', 'requires-user-command', 'not-applicable']),
  readiness: z.enum(['verified', 'blocked', 'unverified', 'not-applicable']),
  evidence: z.array(id).max(16), detail: z.string().max(1200),
});
export type CapabilityFact = z.infer<typeof capabilityFactSchema>;
export const capabilitySnapshotSchema = z.strictObject({
  schemaVersion: z.literal('capabilities-v1'), revision: z.number().int().positive(), digest: hash,
  facts: z.array(capabilityFactSchema).max(512),
});
export type CapabilitySnapshot = z.infer<typeof capabilitySnapshotSchema>;
export const knowledgeFactSchema = z.strictObject({
  key: id, value: z.union([z.string().max(512), z.number(), z.boolean(), z.null()]),
  revision: z.number().int().positive(), source: id, sourceHash: hash, planRevision: z.number().int().nonnegative(),
});
export type KnowledgeFact = z.infer<typeof knowledgeFactSchema>;
export const awarenessSchema = z.strictObject({
  capabilities: capabilitySnapshotSchema.nullable(), knowledgeRevision: z.number().int().nonnegative(),
  facts: z.array(knowledgeFactSchema).max(512),
  corrections: z.array(z.strictObject({ key: id, previousSource: id, source: id, revision: z.number().int().positive() })).max(64),
});
export const answerClaimSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('capability'), id, dimension: z.enum(['registered','configured','installed','authorization','readiness']), value: z.union([z.boolean(), z.string(), z.null()]), revision: z.number().int().positive() }),
  z.strictObject({kind:z.literal('measurement'),receiptId:id,valuePointer:z.string().max(512),value:z.number(),unitPointer:z.string().max(512),unit:z.string().min(1).max(128),sourcePointer:z.string().max(512),source:z.string().min(1).max(512)}),
  z.strictObject({ kind: z.literal('receipt'), receiptId: id, pointer: z.string().max(512), value: z.union([z.string().max(512), z.number(), z.boolean(), z.null()]) }),
]);
export type AnswerClaim = z.infer<typeof answerClaimSchema>;
export const answerAssessmentSchema = z.strictObject({
  schemaVersion: z.literal('answer-assessment-v1'), answerHash: hash, planRevision: z.number().int().nonnegative(),
  capabilityRevision: z.number().int().nonnegative(), knowledgeRevision: z.number().int().nonnegative(),
  status: z.enum(['claims_verified', 'needs_review', 'blocked']),
  claims: z.array(answerClaimSchema).max(64), issues: z.array(z.string().max(1200)).max(64),
  scope: z.literal('structured-claims-and-known-contradictions; narrative-and-scientific-validity-require-review'),
});
export type AnswerAssessment = z.infer<typeof answerAssessmentSchema>;
