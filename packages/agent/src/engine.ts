import type {
  PermissionGrant,
  TaskCompletion,
  TaskRef,
} from "../../contracts/src/agent.js";
import type { ResearchGoalPlan } from "../../contracts/src/research-goal.js";
import type { EngineKind } from "../../contracts/src/engine-selection.js";
export type { EngineKind } from "../../contracts/src/engine-selection.js";
export interface EngineCapabilities {
  kind: EngineKind;
  tools: ReadonlyMap<string, readonly PermissionGrant["permissions"][number][]>;
  steer: boolean;
  resume: boolean;
  persistentHistory: boolean;
  sandbox: "workspace" | "none";
}
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "plan"; plan: ResearchGoalPlan }
  | {
      type: "receipt";
      receipt: { id: string; kind: string; status: string; exitCode?: number };
    };
export interface AgentRun {
  task: TaskRef;
  projectPath: string;
  content: string;
  grant: PermissionGrant;
  control?: import("./execution-control.js").ExecutionControl;
  onEvent(event: AgentEvent): void;
}
/** Engines own tool execution; this boundary never repeats their calls. */
export interface AgentEngine {
  readonly capabilities: EngineCapabilities;
  run(input: AgentRun): Promise<TaskCompletion>;
  steer(taskId: string, content: string): Promise<void>;
  cancel(taskId: string): Promise<boolean>;
  resume(input: AgentRun, threadId: string): Promise<TaskCompletion>;
  dispose(): Promise<void>;
}
