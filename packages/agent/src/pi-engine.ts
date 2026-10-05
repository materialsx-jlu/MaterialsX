import {
  AgentError,
  taskCompletionSchema,
  type TaskCompletion,
} from "../../contracts/src/agent.js";
import type { AgentEngine, AgentRun, EngineCapabilities } from "./engine.js";
import { prepareResearchPlan } from "./research-planning.js";
export interface PiEngineOptions {
  capabilities: EngineCapabilities;
  preparesInPrompt?: boolean;
  prompt(input: AgentRun): Promise<string>;
  interpret(prompt: string, signal: AbortSignal): Promise<string>;
  cancel(conversationId: string): Promise<boolean> | boolean;
  steer?(conversationId: string, content: string): Promise<void>;
}
/** Delegates execution to the existing Pi session/workflows, never runs a second tool loop. */
export class PiEngine implements AgentEngine {
  readonly capabilities: EngineCapabilities;
  private active: { input: AgentRun; controller: AbortController } | null =
    null;
  constructor(private options: PiEngineOptions) {
    this.capabilities = options.capabilities;
  }
  async run(input: AgentRun): Promise<TaskCompletion> {
    if (this.active) throw new AgentError("CONFLICT", "此对话已有任务正在运行");
    const controller = new AbortController();
    this.active = { input, controller };
    const timer = setTimeout(() => {
      void this.cancel(input.task.taskId);
    }, input.grant.maxSeconds * 1000);
    try {
      let executionInput = input;
      if (!this.options.preparesInPrompt) {
        const plan = input.control?.plan() ?? await prepareResearchPlan(
          input.content,
          {
            task: input.task,
            grant: input.grant,
            methods: this.capabilities.tools,
            ...input.control?.planningContext?.(),
          },
          (prompt) => this.options.interpret(prompt, controller.signal),
        );
        input.onEvent({ type: "plan", plan });
        controller.signal.throwIfAborted();
        if (!input.control && (
          plan.cognition.conflicts.length ||
          plan.cognition.missing.some((m) => m.blocks.length)
        ))
          return taskCompletionSchema.parse({
            task: input.task,
            state: "blocked",
            scientificStatus: "not_assessed",
            text:
              "需要补充：" +
              [
                ...plan.cognition.conflicts,
                ...plan.cognition.missing
                  .filter((m) => m.blocks.length)
                  .map((m) => m.question),
              ].join("；"),
            artifacts: [],
            evidence: [],
            limitation: "研究条件尚未确定",
          });
        if (plan.executionMode === "planned" || input.control)
          executionInput = {
            ...input,
            content: `${input.content}\n\nValidated research plan (host scope cannot be expanded): ${input.control?'Follow the authoritative MaterialsX current task state attached by the host to each request; prior tool results do not revise it.':JSON.stringify(plan)}`,
          };
      }
      if (input.control && planIsUnavailable(input.control.summary())) return taskCompletionSchema.parse({ task: input.task, state: "blocked", scientificStatus: "not_assessed", text: "没有条件和依赖均满足的步骤，请补充研究条件。", artifacts: [], evidence: [], limitation: "等待必要输入" });
      const text = await this.options.prompt(executionInput);
      controller.signal.throwIfAborted();
      return taskCompletionSchema.parse({
        task: input.task,
        state: "completed_with_limitations",
        scientificStatus: "needs_review",
        text,
        artifacts: [],
        evidence: [],
        limitation: "科学结论与任务产物需独立验收",
      });
    } finally {
      clearTimeout(timer);
      this.active = null;
    }
  }
  async resume(input: AgentRun, conversationId: string) {
    if (
      !this.capabilities.resume ||
      conversationId !== input.task.conversationId
    )
      throw new AgentError("CONFLICT", "恢复引用与当前会话不匹配");
    return this.run(input);
  }
  async steer(taskId: string, content: string) {
    if (!this.active || this.active.input.task.taskId !== taskId)
      throw new AgentError("CONFLICT", "没有执行中的任务");
    if (!this.options.steer)
      throw new AgentError("UNAVAILABLE", "当前 Pi 模式不支持持续输入");
    await this.options.steer(this.active.input.task.conversationId, content);
  }
  async cancel(taskId: string) {
    if (!this.active || this.active.input.task.taskId !== taskId) return false;
    this.active.controller.abort();
    await this.options.cancel(this.active.input.task.conversationId);
    return true;
  }
  async dispose() {
    if (this.active) await this.cancel(this.active.input.task.taskId);
  }
}

function planIsUnavailable(summary: string) { const s=JSON.parse(summary); return s.goal && !s.execution.readySteps.length && s.execution.steps.some((x: any)=>x.state!=="completed"); }
