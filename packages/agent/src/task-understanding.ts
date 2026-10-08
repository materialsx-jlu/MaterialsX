import { AgentError } from '../../contracts/src/agent.js';
import type { ResearchGoalPlan } from '../../contracts/src/research-goal.js';
import type { TaskExecution } from '../../contracts/src/task-execution.js';
import type { ToolExecution } from './execution-control.js';

/** Decide in the original model/tool loop; this guidance does not classify or execute. */
export const taskUnderstandingGuidance = [
  'Understand the current user goal using the message, relevant conversation history, approved input references, host capabilities and actual tool results. Do not classify by a single keyword or insist on a formal plan for every request.',
  'Choose the next action: answer, retrieve evidence, execute a bounded task, ask for a necessary missing condition, or submit a complex plan. These actions can be combined. A capability question ("can you install a Skill?") needs current facts, not installation or an invented permission denial. If the relevant current host fact already states verified configuration and its authorization boundary, answer directly from it; do not query the same capability again. Query only genuinely missing dimensions or task-specific runtime readiness. An explicit install/execute instruction needs action under the actual grant, not just advice. A design discussion, including numerical targets, can receive bounded advice without claiming a calculation. Respect negated operations; a search request still needs real search results. Numbers, file names and @Skills alone do not prove complexity or grant permission.',
  'For a simple task, reply or use necessary tools directly, without a separate classification/interpretation request. Read an explicitly selected @Skill before following it. Use relevant history and current approved objects to resolve "above/this/continue"; never invent a record ID or treat old model prose as measured evidence. If the reference is ambiguous, inspect approved objects first, then ask only for the condition that truly blocks the next action. Do not search again instead of reading the user selected source.',
  'For dependent research calculations, long-running/high-cost work, multi-stage deliverables or delegated work, first inspect inputs using read-only tools. For one registered backend use task_control {"action":"plan","method":"<exact registered primary method>"}; the host preserves the original contract and required artifacts. For dependent multi-step research call task_control {"action":"plan"} to obtain the existing proposal contract if needed; submit task_control {"action":"plan","proposal":<proposal object>} before side effects. This is the SAME task, grant, budget, model and engine, not a new Agent. Preserve all requested outputs, priorities, prohibitions, uncertainty and source evidence. Do not plan unrelated statistics for a design discussion or invent missing densities, structures, file contents or numerical thresholds. Native result units label unknown outputs, not target values.',
  'Plan requests return exact registered methods and current input references. Already inspected data remain evidence; do not rerun a known operation merely to get another receipt. A missing quantitative input blocks its calculation, not independent reading or a truthful partial answer. Explain assumptions and candidate suggestions separately from validated performance. For file/script work, inspect the actual error and source, perform the requested change, run necessary checks, and read back actual requested artifacts. Stop on unavailable capabilities, permissions, exhausted budgets or unknown mutations; never silently switch routes or fabricate completion.',
].join('\n');

export function isMutableTool(call: Pick<ToolExecution, 'name' | 'args' | 'permissions'>): boolean {
  if(call.name==="write_stdin"&&!((call.args as any)?.chars))return false;
  const action = (call.args as any)?.action;
  return call.name === 'research_subtask' ||
    (call.name !== 'research_browser' || ['download', 'inspect_image'].includes(action)) &&
    call.permissions.some(p => ['terminal', 'patch', 'science'].includes(p)) &&
    !['get', 'auto_get', 'select', 'auto_plan', 'inspect', 'list', 'status', 'search'].includes(action) &&
    !/^(?:get_|inspect_|list_)|_(?:get|search|status)$/.test(call.name);
}

export function requiresResearchPlan(call: Pick<ToolExecution, 'name' | 'args'>): boolean {
  if (['research_subtask', 'research_method_run', 'experiment_analyze', 'next_experiment_design'].includes(call.name)) return true;
  const action = (call.args as any)?.action;
  return call.name === 'materials_science' && ['singlepoint', 'relaxation', 'md', 'auto_run'].includes(action) ||
    call.name === 'campaign_job' && ['submit', 'start', 'run'].includes(action);
}

/** Initial interpretation may refine a placeholder, never replay writes or erase outputs. */
export function initialInterpretation(
  current: ResearchGoalPlan, next: ResearchGoalPlan, state: TaskExecution,
  permissions: ReadonlyMap<string, readonly ToolExecution['permissions'][number][]>,
  readResult: (ref: string) => unknown,
): boolean {
  if (current.planningStage !== 'exploration' || next.planningStage !== 'validated') return false;
  const fail = (message: string): never => { throw new AgentError('PERMISSION_DENIED', message); };
  if (state.attempts.some(a => {
    const input = a.inputRef ? readResult(a.inputRef) as any : null;
    return !input || !permissions.has(a.method) && !['find_tools','task_control'].includes(a.method) ||
      isMutableTool({ name: a.method, args: input?.args, permissions: permissions.get(a.method) ?? [] });
  })) fail('执行过可能有副作用的操作，不能重新解释目标；保留原计划和回执 / Cannot reinterpret after side effects');
  if (next.originalRequest !== current.originalRequest ||
    next.constraints.grantId !== current.constraints.grantId ||
    JSON.stringify(next.constraints.permissions) !== JSON.stringify(current.constraints.permissions) ||
    next.constraints.maxCredits !== current.constraints.maxCredits ||
    next.constraints.maxSeconds !== current.constraints.maxSeconds)
    fail('初始解释不能改变原始请求、权限、预算或截止范围');
  if (JSON.stringify(next.inputVersionRefs) !== JSON.stringify(current.inputVersionRefs)) fail('初始解释不能改变批准的输入版本');
  if (current.acceptance.requiredArtifacts.some(name => !next.acceptance.requiredArtifacts.includes(name))) fail('初始解释不能删除已有验收产物');
  if (current.goal.metrics.some(m => !next.goal.metrics.some(n => JSON.stringify(n) === JSON.stringify(m))) ||
    current.goal.priorities.some(p => !next.goal.priorities.includes(p))) fail('初始解释不能删除已有目标指标或优先级');
  if (current.cognition.facts.some(f => !next.cognition.facts.some(n => JSON.stringify(n) === JSON.stringify(f))) ||
    next.cognition.facts.some(f => f.confirmed && !f.evidence.length && !current.cognition.facts.some(n => JSON.stringify(n) === JSON.stringify(f))))
    fail('初始解释不能改写已确认事实或将无证据陈述确认为事实');
  return true;
}

/** Replanning may narrow a host contract, but cannot silently relax existing constraints. */
export function preserveConstraints(current: ResearchGoalPlan, next: ResearchGoalPlan): void {
  if (next.constraints.permissions.some(p => !current.constraints.permissions.includes(p)) ||
    next.constraints.maxSeconds > current.constraints.maxSeconds ||
    current.constraints.maxCredits !== null && (next.constraints.maxCredits === null || Number(next.constraints.maxCredits) > Number(current.constraints.maxCredits)) ||
    current.constraints.process.some(p => !next.constraints.process.includes(p)) ||
    current.constraints.dataSources.some(p => !next.constraints.dataSources.includes(p)))
    throw new AgentError('PERMISSION_DENIED', '模型不能放宽原计划的权限、费用、时间、工艺或数据来源约束');
}
