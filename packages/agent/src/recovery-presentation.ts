import type {TaskExecution} from '../../contracts/src/task-execution.js';
import {hasUnresolvedPaidRequests} from '../../contracts/src/task-execution.js';
import {failureFor,recoveryFault} from './recovery-failures.js';
import {recoveryInstructions} from './recovery-policy.js';
import type {RecoveryFault} from '../../contracts/src/recovery.js';
import {recoveryLabels} from '../../contracts/src/recovery.js';
export const recoveryNotice=(fault:RecoveryFault)=>recoveryLabels[fault.kind].zh+'；保留已完成的操作，按真实回执继续。';
export function recoveryFailureMessage(error:unknown,state?:TaskExecution|null){
 let fault=failureFor(error);const saved=state?.steps.flatMap(s=>s.artifacts??[])??[];
 if(fault.kind!=='cancelled'&&state&&(state.attempts.some(a=>a.state==='unknown')||hasUnresolvedPaidRequests(state)))fault=recoveryFault('operation-unknown','unknown');
 const action:Partial<Record<RecoveryFault['kind'],string>>={'job-pending':'查询原任务后继续，不重复提交。','operation-unknown':'先核对原请求或作业回执，不再次扣费或重放操作。',permission:'请调整任务范围或由用户另行授权。',budget:'原时间与费用上限不变，请查看已完成结果。','science-scope':'请选用满足当前物理范围的方法。',environment:'检查 MaterialsX 受管环境；只修复锁定依赖。',script:'查看真实退出码和 stderr，修正后重新核验。'};
 return recoveryLabels[fault.kind].zh+'：'+(error instanceof Error?error.message:String(error))+'\n'+(action[fault.kind]??'查看运行记录中的具体原因和回执。')+
  (saved.length?'\n已保留产物：'+saved.map(a=>a.path).join('、'):'');
}
export function failureGuidance(fault:RecoveryFault){return {failure:fault,instruction:recoveryInstructions(fault)};}
