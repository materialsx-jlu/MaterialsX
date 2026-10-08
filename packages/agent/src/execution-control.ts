import {AgentError,type Permission} from "../../contracts/src/agent.js";
import { z } from 'zod';
import { answerClaimSchema } from '../../contracts/src/capability-awareness.js';
import type { ResearchGoalPlan } from "../../contracts/src/research-goal.js";
export interface ToolExecution { id: string; name: string; args: unknown; permissions: readonly Permission[] }
/** Observation and admission only. The selected engine retains its execution loop. */
export interface ExecutionControl {
  recordRecovery?(fault:import('../../contracts/src/recovery.js').RecoveryFault):boolean;
  recordFailure?(fault:import('../../contracts/src/recovery.js').RecoveryFault):void;
  capabilities?():import('../../contracts/src/capability-awareness.js').CapabilitySnapshot|null;
  checkAnswer?(text:string):import('../../contracts/src/capability-awareness.js').AnswerAssessment;
  sourceRetrievalComplete?():boolean;
  modelCompletionIssue?():string|null;
  verifyBackendSteps?():Promise<string[]>;
  plan(): ResearchGoalPlan | null;
  originalRequest?():string;
  planningContext?(): Pick<import("../../contracts/src/research-goal.js").PlanContext,"interactivePlanning"|"inputVersions"|"evidence"|"methodDescriptions"|"sourceUnits">;
  acceptPlan(plan: ResearchGoalPlan): void;
  summary(): string;
  beforeRequest(payload: any, phase: "interpret" | "execute" | "compact", window: number, maxOutput: number, requestId?: string): { id: string; payload: any };
  firstToken?(id:string):void;
  endRequest(id: string, state: "completed" | "failed" | "unknown", usage?: unknown, noDispatch?: boolean): void;
  authorize(name: string, permissions: readonly Permission[]): void;
  beforeTool(call: ToolExecution): unknown | undefined;
  afterTool(id: string, result: unknown, isError: boolean, jobs?: string[]): void;
  command(input: unknown): Promise<unknown>;
  finish(state: "completed_with_limitations" | "failed" | "cancelled", reason?: string): void;
  canRecoverModelResponse?():boolean;
}
export const controlParameters = { type: "object", properties: {
  action: { type: "string", enum: ["status", "capabilities", "receipt", "validate_answer", "plan", "begin", "complete", "replan"] },
  answer: {type:'string',maxLength:60000}, claims: {type:'array',maxItems:64,items:z.toJSONSchema(answerClaimSchema,{io:'input'})},
  query: {type:'string',maxLength:160}, method:{type:'string',description:'For action=plan, select one exact registered primary backend. Host preserves the existing goal and binds its artifact contract. Mutually exclusive with proposal.'},
  sourceTaskId: {type:"string",format:"uuid",description:"Optional for receipt only: one actual task ID from workingContext.history. Historical evidence never completes this task."},
  stepId: { type: "string" }, receiptIds: { type: "array", items: { type: "string" } },
  expectedRevision: { type: "integer", minimum: 1,description:'Optional optimistic concurrency check for begin, complete and replan; if provided it must match the host current revision.' }, proposal: { type: "object" },
}, required: ["action"], additionalProperties: false };
export const controlDescription = "Research task status, current capabilities, receipt lookup, answer claim validation and step control. capabilities with query=<name> returns up to 16 current facts; registration, installation, permission and readiness are separate. validate_answer takes answer and optional claims: capability claims use the current capability revision; receipt claims use owned successful receiptId and exact JSON pointer into the decoded receipt itself, not its outer result/content/text wrapper (single JSON text output is parsed once; for science use /status, /result/energyEv). A measurement claim binds receiptId,valuePointer,value,unitPointer,unit,sourcePointer,source to one real receipt; no silent unit conversion. Other scalar values/conditions need separate exact claims; this does not validate scientific reasoning. The host automatically binds unique calls and completes fixed backend/read/file contracts using owned receipts and verified artifacts. No begin/complete is needed for those contracts. If several ready steps match, choose a real stepId with begin. Free research acceptance still uses complete with stepId; receiptIds and expectedRevision may be omitted for host-owned binding, or supplied for explicit checks. Never change business job/record IDs. receipt retrieves original owned evidence by receiptIds. For a contextual follow-up, use sourceTaskId from workingContext.history to read listed historical receipts; they remain provenance only, cannot complete current steps, and require current read/export authorization. Read missing or omitted evidence with the original bounded source tools. Resolve actual reference ambiguities before computation; revised or withdrawn evidence requires selection of a new authorized source. Complete requires real receipts and verified files. Replan cannot change user goals, permissions or acceptance. Never executes tools. During exploration only: plan with method=<exact registered name> binds a single backend to the current goal, inputs, constraints and budget without model-authored goal JSON. For dependent multi-step research, plan with no method/proposal returns the full proposal contract; plan with proposal validates the initial interpretation in the same task and budget. It needs no expectedRevision, cannot follow side effects, and cannot reset an already interpreted goal. Simple answers and bounded tasks need no plan call.";

/** Internal completion boundary: no provider request is sent after verified source-only delivery. */
export class VerifiedSourceReady extends AgentError {
  constructor(){super('CONFLICT','VERIFIED_SOURCE_READY: requested source receipts are complete; render original source data in the host.');}
}
