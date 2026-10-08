import { z } from "zod";
import {recoveryFaultSchema,type RecoveryFault} from './recovery.js';

export const projectIdSchema = z.uuid().brand<"ProjectId">();
export const conversationIdSchema = z.uuid().brand<"ConversationId">();
export const taskIdSchema = z.uuid().brand<"TaskId">();
export const goalIdSchema = z.uuid().brand<"GoalId">();
export const stepIdSchema = z
  .string()
  .regex(/^[a-zA-Z][\w.-]{0,63}$/)
  .brand<"StepId">();
export const evidenceRefSchema = z.strictObject({
  sourceId: z.string().min(1),
  generation: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  locator: z.string().min(1),
});
export const artifactRefSchema = z.strictObject({
  taskId: taskIdSchema,
  artifactId: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const taskRefSchema = z.strictObject({
  taskId: taskIdSchema,
  projectId: projectIdSchema,
  conversationId: conversationIdSchema,
});
export const permissionSchema = z.enum([
  "read",
  "search",
  "terminal",
  "patch",
  "network",
  "science",
]);
export const permissionGrantSchema = z.strictObject({
  grantId: z.uuid(),
  projectId: projectIdSchema,
  conversationId: conversationIdSchema,
  permissions: z.array(permissionSchema).max(6),
  approvedBy: z.enum(["local-user", "native-dialog"]),
  maxCredits: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .nullable(),
  maxSeconds: z.number().int().positive(),
});
export const engineErrorSchema = z.strictObject({
  code: z.enum([
    "INVALID_PLAN",
    "PERMISSION_DENIED",
    "UNKNOWN_METHOD",
    "CONFLICT",
    "UNAVAILABLE",
    "PROTOCOL_ERROR",
    "CANCELLED",
    "EXECUTION_FAILED",
    "BUDGET_EXCEEDED",
    "RECONCILIATION_REQUIRED",
  ]),
  message: z.string().min(1),
  retryable: z.boolean(),
  taskId: taskIdSchema.optional(),
  recovery:recoveryFaultSchema.optional(),
});
export type AgentErrorCode = z.infer<typeof engineErrorSchema>["code"];
export class AgentError extends Error {
  constructor(
    public code: AgentErrorCode,
    message: string,
    public retryable = false,
    public recovery?:RecoveryFault,
  ) {
    super(message);
    this.name = "AgentError";
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.recovery?{recovery:this.recovery}:{}),
    };
  }
}
export type Permission = z.infer<typeof permissionSchema>;
export type PermissionGrant = z.infer<typeof permissionGrantSchema>;
export type TaskRef = z.infer<typeof taskRefSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export const taskCompletionSchema = z.strictObject({
  task: taskRefSchema,
  state: z.enum([
    "completed",
    "completed_with_limitations",
    "blocked",
    "failed",
    "cancelled",
  ]),
  scientificStatus: z.enum(["not_assessed", "needs_review", "validated"]),
  text: z.string(),
  artifacts: z.array(artifactRefSchema),
  evidence: z.array(evidenceRefSchema),
  limitation: z.string().nullable(),
});
export type TaskCompletion = z.infer<typeof taskCompletionSchema>;
