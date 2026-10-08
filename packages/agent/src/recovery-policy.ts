import type {TaskExecution} from '../../contracts/src/task-execution.js';
import type {RecoveryFault} from '../../contracts/src/recovery.js';
import {digest} from './execution-context.js';
import {recoveryError,failureFor} from './recovery-failures.js';
import type {ExecutionControl} from './execution-control.js';
export const correctiveKinds=new Set<RecoveryFault['kind']>(['arguments','protocol','source','acceptance','step-selection','plan-required','receipt-exists']);
/** A rejected MCP call continues the original engine loop, using the SAME persistent correction budget. */
export function rejectedFailure(error:unknown,control?:ExecutionControl){
 const fault=failureFor(error);
 if(correctiveKinds.has(fault.kind)&&fault.phase==='rejected'&&control?.recordRecovery&&!control.recordRecovery(fault))
  return recoveryError('EXECUTION_FAILED','有限恢复预算已用尽；请检查原回执 / Recovery budget exhausted','budget');
 return error;
}
/** Host-verified deliverables only. Reads, model claims and revision changes cannot reset the budget. */
export function recoveryProgress(state:TaskExecution){
 return state.steps.filter(s=>s.state==='completed').flatMap(s=>(s.artifacts??[]).filter(a=>a.verified).map(a=>digest({path:a.path,sha256:a.sha256,bytes:a.bytes}))).slice(0,64);
}
export function admitCorrection(state:TaskExecution,fault:RecoveryFault){
 const progress=recoveryProgress(state),previous=state.recovery,advanced=progress.some(p=>!previous?.progress.includes(p));
 const corrections=advanced?0:previous?.corrections??0,total=previous?.total??0;
 state.recovery={corrections,total,progress:[...new Set([...(previous?.progress??[]),...progress])].slice(-64),lastFault:fault};
 if(corrections>=2||total>=8||!correctiveKinds.has(fault.kind)||!['rejected','completed'].includes(fault.phase))return false;
 state.recovery.corrections++;state.recovery.total++;return true;
}
export function requireFailureBudget(state:TaskExecution){
 // All historical failures count, including attempts marked stale by a replan.
 const barrier=state.steps.flatMap(s=>s.state==='completed'&&s.artifacts?.length?[...s.artifacts].map(()=>s.id):[]);
 let latestProgress=-1;state.attempts.forEach((a,i)=>{if(a.state==='completed'&&barrier.includes(a.stepId))latestProgress=i;});
 const failed=state.attempts.slice(latestProgress+1).filter(a=>a.errorFingerprint!==null);
 if(failed.length>=3||state.attempts.filter(a=>a.errorFingerprint!==null).length>=8)
  throw recoveryError('EXECUTION_FAILED','初始执行及两次纠错仍失败；有限修复预算已用尽，保留原回执和产物，不因只读查询或重规划重新试算 / Recovery budget exhausted; inspect existing evidence or stop','budget');
}
export function recoveryInstructions(fault:RecoveryFault){
 const instructions:Record<RecoveryFault['next'],string>={
  'correct-arguments':'Read the exact runtime schema and issue paths. Submit a complete object. Preserve business fields; never guess missing IDs/values or silently discard fields. No rejected call executed.',
  'repair-response':'Repair only the response format in this same session. Use advertised functions and complete JSON. Never replay a successful mutation.',
  'inspect-script':'Read the owned stderr/exit receipt and scoped script before editing. Make an authorized change, then run the relevant check and inspect real output files. Never repeat the identical failed command without diagnosis.',
  'check-environment':'Call environment_check before environment_repair. Repair only an authorized MaterialsX managed environment and fixed locked dependencies. Preserve the old pointer on failure; do not use system/user Codex Python or arbitrary pip/npm installs.',
  'supplement-source':'Read current approved source choices and actual IDs. Fetch/read missing evidence within the existing grant or state the gap; never invent density, source pages or recipes.',
  'discover-capability':'Inspect current capability facts and find_tools. Registration is not installation or scientific qualification; do not fabricate an adapter or install without authority.',
  'query-original':'Use pendingJobs.nextCall with the exact owned ID to query or cancel the existing job. Never submit a second job while it is unresolved.',
  reconcile:'Stop model/write replay. Reconcile the original M5 request or owned operation with its existing IDs and ledger before resuming; do not release unknown reservations.',
  stop:'Stop at the current permission, budget, cancellation or scientific boundary. Keep actual receipts and outputs. Never expand the grant, deadline or physical scope.',
  'verify-delivery':'Complete only the actual missing planned action, inspect real artifacts and owned receipts, and correct unsupported claims. Do not rerun completed operations.',
  'select-step':'Use the host current ready candidates; select only an actual step with satisfied dependencies.',
  plan:'Bind the original task to an actual registered backend using task_control. Preserve goals, input versions, constraints and acceptance.',
  'inspect-receipt':'Retrieve the original owned successful receipt, verify actual output and continue; the completed mutation was not replayed.',
 };
 return instructions[fault.next];
}
