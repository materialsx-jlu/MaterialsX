import { z } from "zod";
import { permissionGrantSchema, taskRefSchema } from "./agent.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const state = z.enum(["pending", "running", "completed", "failed", "blocked", "unknown", "stale", "cancelled"]);
export const toolAttemptSchema = z.strictObject({
  id: z.string(), stepId: z.string(), method: z.string(), fingerprint: hash,
  planRevision: z.number().int().positive(), state, startedAt: z.number(), endedAt: z.number().nullable(),
  inputRef:z.string().optional(), resultRef: z.string().nullable(), errorFingerprint: hash.nullable(), jobIds: z.array(z.string()),
  jobs: z.array(z.strictObject({ id: z.string(), state: z.string() })),
});
export const executionRequestSchema = z.strictObject({
  id: z.string(), planRevision:z.number().int().nonnegative(), phase: z.enum(["interpret", "execute", "compact"]), firstTokenAt:z.number().nullable(), startedAt: z.number(), endedAt: z.number().nullable(),
  inputUpperBound: z.number().int().nonnegative(), outputLimit: z.number().int().positive(),
  compacted: z.boolean(), state: z.enum(["running", "completed", "failed", "unknown"]),
  usage: z.unknown().nullable(),
});
export const taskExecutionSchema = z.strictObject({
  schemaVersion: z.literal("task-execution-v1"),
  parentTaskId:z.uuid().optional(), continuation: z.strictObject({taskId:z.uuid(),kind:z.literal("handoff")}).optional(), task: taskRefSchema, grant: permissionGrantSchema,
  engine: z.enum(["pi", "codex"]), connectionId: z.string(), accountRef: z.string(),
  version: z.number().int().nonnegative(), sequence: z.number().int().nonnegative(),
  planRevision: z.number().int().nonnegative(), startedAt: z.number(), deadline: z.number(),
  state: z.enum(["running", "completed_with_limitations", "blocked", "failed", "cancelled", "interrupted", "handed_off", "waiting"]),
  waiting:z.strictObject({campaignId:z.uuid(),startedAt:z.number(),until:z.number(),remainingActiveMs:z.number().positive()}).optional(),
  waitingMs:z.number().nonnegative().optional(),
  reason: z.string().nullable(), activeStepId: z.string().nullable(),
  steps: z.array(z.strictObject({ id: z.string(), state, reason: z.string().nullable() })).max(64),
  attempts: z.array(toolAttemptSchema).max(512), requests: z.array(executionRequestSchema).max(64),
});
export type TaskExecution = z.infer<typeof taskExecutionSchema>;
export type ToolAttempt = z.infer<typeof toolAttemptSchema>;
export interface ExecutionEvent {
  taskId: string; sequence: number; at: number; planRevision: number;
  type: "plan" | "step" | "tool" | "request" | "revision" | "cancel" | "terminal";
  id: string; state: string; detail: string | null;
}
