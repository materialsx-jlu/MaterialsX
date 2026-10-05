import type { Permission } from "../../contracts/src/agent.js";
import type { ResearchGoalPlan } from "../../contracts/src/research-goal.js";
export interface ToolExecution { id: string; name: string; args: unknown; permissions: readonly Permission[] }
/** Observation and admission only. The selected engine retains its execution loop. */
export interface ExecutionControl {
  verifyBackendSteps?():Promise<string[]>;
  plan(): ResearchGoalPlan | null;
  originalRequest?():string;
  planningContext?(): Pick<import("../../contracts/src/research-goal.js").PlanContext,"inputVersions"|"evidence"|"methodDescriptions"|"sourceUnits">;
  acceptPlan(plan: ResearchGoalPlan): void;
  summary(): string;
  beforeRequest(payload: any, phase: "interpret" | "execute" | "compact", window: number, maxOutput: number, requestId?: string): { id: string; payload: any };
  firstToken?(id:string):void;
  endRequest(id: string, state: "completed" | "failed" | "unknown", usage?: unknown): void;
  authorize(name: string, permissions: readonly Permission[]): void;
  beforeTool(call: ToolExecution): unknown | undefined;
  afterTool(id: string, result: unknown, isError: boolean, jobs?: string[]): void;
  command(input: unknown): Promise<unknown>;
  finish(state: "completed_with_limitations" | "failed" | "cancelled", reason?: string): void;
  canRecoverModelResponse?():boolean;
}
export const controlParameters = { type: "object", properties: {
  action: { type: "string", enum: ["status", "receipt", "begin", "complete", "replan"] },
  stepId: { type: "string" }, receiptIds: { type: "array", items: { type: "string" } },
  expectedRevision: { type: "integer", minimum: 1,description:'REQUIRED for begin, complete and replan. Copy the current planRevision from the host state or controlCandidates.' }, proposal: { type: "object" },
}, required: ["action"], additionalProperties: false };
export const controlDescription = "Research task status, receipt lookup and step control. For begin/complete/replan, ALWAYS include expectedRevision copied from host planRevision; begin/complete also need stepId. Prefer the complete literal controlCandidates object. Use action=receipt with actual receiptIds to retrieve owned evidence omitted from context. Complete requires actual receipt IDs and verified files. Fixed scientific backend steps are verified by the host when their owned receipts/files are available; read the latest state instead of repeating them. Replan cannot change user goals, permissions or acceptance. Never executes tools.";
