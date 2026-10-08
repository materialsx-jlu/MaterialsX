import { z } from "zod";
import {
  AgentError,
  evidenceRefSchema,
  goalIdSchema,
  permissionGrantSchema,
  permissionSchema,
  stepIdSchema,
  taskRefSchema,
} from "./agent.js";

const boundedText = z.string().min(1).max(16000);
const metric = z.strictObject({
  name: boundedText,
  value: z.number().nullable(),
  unit: boundedText.nullable(),
  condition: boundedText.nullable(),
  priority: z.number().int().nonnegative(),
  origin: z.enum(["user", "evidence"]),
});
const statement = z.strictObject({
  text: boundedText,
  evidence: z.array(evidenceRefSchema),
  confirmed: z.boolean(),
});
export const researchGoalPlanSchema = z.strictObject({
  schemaVersion: z.literal("research-goal-plan-v1"),
  goalId: goalIdSchema,
  goalRevision: z.number().int().positive(),
  planRevision: z.number().int().positive(),
  task: taskRefSchema,
  executionMode: z.enum(["direct", "planned"]),
  /** Absent on legacy plans; exploration may be interpreted once before side effects. */
  planningStage: z.enum(['exploration', 'validated']).optional(),
  userMessageRefs: z.array(z.string().min(1)).min(1),
  inputVersionRefs: z.array(
    z.strictObject({
      id: boundedText,
      version: boundedText,
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
  revisionReason: boundedText,
  originalRequest: boundedText,
  goal: z.strictObject({
    materialSystem: boundedText.nullable(),
    problemType: boundedText,
    metrics: z.array(metric),
    priorities: z.array(boundedText),
  }),
  constraints: z.strictObject({
    process: z.array(boundedText),
    dataSources: z.array(boundedText),
    grantId: z.uuid(),
    permissions: z.array(permissionSchema),
    maxCredits: z
      .string()
      .regex(/^\d+(\.\d{1,4})?$/)
      .nullable(),
    maxSeconds: z.number().int().positive(),
  }),
  cognition: z.strictObject({
    facts: z.array(statement),
    missing: z.array(
      z.strictObject({
        id: stepIdSchema,
        question: boundedText,
        blocks: z.array(stepIdSchema),
      }),
    ),
    assumptions: z.array(statement),
    conflicts: z.array(boundedText),
    conflictScopes: z.array(z.strictObject({conflictIndex:z.number().int().nonnegative(),blocks:z.array(stepIdSchema).min(1)})).optional(),
  }),
  steps: z
    .array(
      z.strictObject({
        id: stepIdSchema,
        inputRefs: z.array(boundedText),
        method: boundedText,
        dependsOn: z.array(stepIdSchema),
        permissions: z.array(permissionSchema),
        expectedArtifacts: z.array(boundedText),
        completionCriteria: z.array(boundedText).min(1),
      }),
    )
    .min(1)
    .max(64),
  adjustmentRules: z.array(
    z.strictObject({
      trigger: boundedText,
      action: z.enum(["request_data", "change_method", "recompute", "stop"]),
      affectedSteps: z.array(stepIdSchema),
      maxRetries: z.number().int().min(0).max(2),
    }),
  ),
  acceptance: z.strictObject({
    requiredArtifacts: z.array(boundedText),
    criteria: z.array(boundedText).min(1),
    requiredEvidence: z.array(boundedText),
    allowedLimitations: z.array(boundedText),
  }),
});
export type ResearchGoalPlan = z.infer<typeof researchGoalPlanSchema>;
export interface PlanContext {
  interactivePlanning?: boolean;
  task: ResearchGoalPlan["task"];
  grant: z.input<typeof permissionGrantSchema>;
  methods: ReadonlyMap<string, readonly z.infer<typeof permissionSchema>[]>;
  methodDescriptions?:ReadonlyMap<string,string>;
  sourceUnits?:readonly string[];
  previous?: ResearchGoalPlan;
  inputVersions?: ResearchGoalPlan["inputVersionRefs"];
  evidence?: z.infer<typeof evidenceRefSchema>[];
}
/** Host-owned references and grants are checked independently of the model's proposal. */
export function validateResearchPlan(
  input: unknown,
  context: PlanContext,
): ResearchGoalPlan {
  const parsed = researchGoalPlanSchema.safeParse(input);
  if (!parsed.success)
    throw new AgentError(
      "INVALID_PLAN",
      `研究计划字段不完整：${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  const p = parsed.data,
    grant = permissionGrantSchema.parse(context.grant);
  const fail = (message: string): never => {
    throw new AgentError("INVALID_PLAN", message);
  };
  if (
    p.task.taskId !== context.task.taskId ||
    p.task.projectId !== context.task.projectId ||
    p.task.conversationId !== context.task.conversationId ||
    grant.projectId !== p.task.projectId ||
    grant.conversationId !== p.task.conversationId
  )
    fail("研究计划与本轮项目或任务不匹配");
  if (
    p.constraints.grantId !== grant.grantId ||
    p.constraints.permissions.some((v) => !grant.permissions.includes(v)) ||
    p.constraints.maxSeconds > grant.maxSeconds ||
    (grant.maxCredits !== null &&
      (p.constraints.maxCredits === null ||
        Number(p.constraints.maxCredits) > Number(grant.maxCredits)))
  )
    throw new AgentError("PERMISSION_DENIED", "研究计划超出本轮授权");
  for (const statement of [...p.cognition.facts, ...p.cognition.assumptions])
    for (const ref of statement.evidence)
      if (
        !(context.evidence ?? []).some(
          (known) => JSON.stringify(known) === JSON.stringify(ref),
        )
      )
        fail("计划使用了尚未取得的证据引用");
  const previous = context.previous;
  if (
    JSON.stringify(p.inputVersionRefs) !==
    JSON.stringify(context.inputVersions ?? [])
  )
    fail("输入版本不属于本轮批准的快照");
  if (
    p.userMessageRefs.some(
      (id) =>
        id !== context.task.taskId && !previous?.userMessageRefs.includes(id),
    )
  )
    fail("用户消息引用不属于本轮任务");
  if (
    previous &&
    (p.goalId !== previous.goalId ||
      p.goalRevision < previous.goalRevision ||
      p.goalRevision > previous.goalRevision + 1 ||
      p.planRevision !== previous.planRevision + 1)
  )
    fail("研究计划版本冲突");
  if (
    previous &&
    p.goalRevision === previous.goalRevision &&
    (p.originalRequest !== previous.originalRequest ||
      JSON.stringify(p.goal) !== JSON.stringify(previous.goal))
  )
    fail("目标已改变但未增加目标版本");
  const ids = new Set(p.steps.map((s) => s.id));
  const inputIds = new Set([
    ...p.userMessageRefs,
    ...p.inputVersionRefs.map((i) => i.id),
    ...ids,
  ]);
  if (p.steps.some((s) => s.inputRefs.some((id) => !inputIds.has(id))))
    fail("步骤引用了未知输入");
  if (ids.size !== p.steps.length) fail("步骤编号重复");
  const completed = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) fail("研究计划存在循环依赖");
    if (completed.has(id)) return;
    const step = p.steps.find((s) => s.id === id);
    if (!step) fail(`缺少依赖步骤：${id}`);
    visiting.add(id);
    for (const dep of step!.dependsOn) visit(dep);
    visiting.delete(id);
    completed.add(id);
  };
  for (const step of p.steps) {
    const required = context.methods.get(step.method);
    if (!required)
      throw new AgentError(
        "UNKNOWN_METHOD",
        inputIds.has(step.method)
          ? `输入版本不能作为执行方法：${step.method}；请选择已注册的工具名称 / Frozen input IDs are data, not executable methods`
          : `当前引擎没有方法：${step.method}`,
      );
    if (
      step.permissions.some((v) => !p.constraints.permissions.includes(v)) ||
      required.some((v) => !step.permissions.includes(v))
    )
      throw new AgentError("PERMISSION_DENIED", `步骤权限不匹配：${step.id}`);
    if (
      step.inputRefs.some(
        (id) =>
          ids.has(id as typeof step.id) &&
          (!step.dependsOn.includes(id as typeof step.id) || id === step.id),
      )
    )
      fail(`步骤 ${step.id} 输入引用了自己或未声明依赖：${step.inputRefs.filter(id=>ids.has(id as typeof step.id)&&(!step.dependsOn.includes(id as typeof step.id)||id===step.id)).join(', ')}；源输入使用 taskId/真实来源 ID，不能使用本步骤 ID`);
    visit(step.id);
  }
  if(p.cognition.conflictScopes?.some(s=>s.conflictIndex>=p.cognition.conflicts.length))fail("条件冲突索引不存在");
  for (const item of [
    ...(p.cognition.conflictScopes ?? []).map(s=>s.blocks),
    ...p.cognition.missing.map((m) => m.blocks),
    ...p.adjustmentRules.map((r) => r.affectedSteps),
  ])
    if (item.some((id) => !ids.has(id))) fail(`调整或缺项引用了不存在的步骤：${item.filter(id=>!ids.has(id)).join(', ')}；已声明步骤：${[...ids].join(', ')}`);
  if (
    p.cognition.assumptions.some((a) => a.confirmed && a.evidence.length === 0)
  )
    fail("未经证据确认的假设不能标记为事实");
  if (p.executionMode === "direct" && p.steps.length !== 1)
    fail("直接执行仅允许一个步骤");
  return p;
}
