import { AgentError } from "../../../packages/contracts/src/agent.js";
import type { TaskExecution } from "../../../packages/contracts/src/task-execution.js";
export function needsReconciliation(state: TaskExecution) {
  const jobs=new Map<string,string>();
  for(const a of state.attempts.filter(a=>a.state!=="stale"))for(const job of a.jobs)jobs.set(job.id,job.state);
  return state.attempts.some(a=>["running","unknown"].includes(a.state)) || [...jobs.values()].some(s=>!["completed","failed","cancelled","interrupted"].includes(s)) ||
    state.accountRef!=="local"&&state.requests.some(r=>["running","unknown"].includes(r.state));
}
export function recoveryDeadline(state:TaskExecution,now=Date.now()){
  return state.state==='waiting'&&state.waiting?Math.min(state.waiting.until,now+state.waiting.remainingActiveMs):state.deadline;
}
export function requireRecoverable(state: TaskExecution) {
  if(["handed_off","completed_with_limitations"].includes(state.state))throw new AgentError("CONFLICT","任务已结束或已交接；请查看交接后的任务");
  if(needsReconciliation(state))throw new AgentError("RECONCILIATION_REQUIRED","原任务或计算仍待核对，请先查询回执；不会再次提交或扣费");
  if(recoveryDeadline(state)<=Date.now())throw new AgentError("BUDGET_EXCEEDED","原任务时间预算已耗尽，恢复不重置时间和请求预算");
}

/** Cross-engine handoff never reinterprets a partly executed mutation as a fresh operation. */
export function requireHandoffCheckpoint(state:TaskExecution) {
  requireRecoverable(state);
  if(state.waiting)throw new AgentError('RECONCILIATION_REQUIRED','先恢复原引擎并核实计算步骤，再交接；不迁移等待预算或在途作业');
  const mutating=(method:string)=>["bash","write","edit","exec_command","apply_patch","engine.execute","materials_science","research_delivery","campaign_job"].includes(method)||/^(?:run_|relax_|cancel_)/.test(method);
  if(state.attempts.some(a=>a.state==="completed"&&mutating(a.method)&&state.steps.find(s=>s.id===a.stepId)?.state!=="completed"))
    throw new AgentError("RECONCILIATION_REQUIRED","步骤已执行部分操作但尚未验收；先在原引擎读取回执并完成步骤，再交接，避免重复执行");
}
