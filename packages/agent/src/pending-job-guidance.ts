import type {TaskExecution} from '../../contracts/src/task-execution.js';
import {receiptClaimData} from './answer-assessment.js';
import {scienceActionSchema} from '../../contracts/src/science-action.js';
/** Observational hints derived only from owned receipts. No scheduler, execution or ID translation. */
export function pendingJobGuidance(state:TaskExecution,read:(ref:string)=>unknown){
 const latest=new Map<string,{stepId:string;method:string;jobId:string;state:string;input:any;receipt:any}>();
 for(const attempt of state.attempts.filter(a=>a.state!=='stale'&&a.planRevision===state.planRevision)){
  const input=attempt.inputRef?read(attempt.inputRef) as any:null;
  for(const job of attempt.jobs)latest.set(job.id,{stepId:attempt.stepId,method:attempt.method,jobId:job.id,state:job.state,input:input?.args,receipt:attempt.resultRef?receiptClaimData(read(attempt.resultRef)):null});
 }
 return [...latest.values()].filter(j=>!['completed','failed','cancelled','interrupted'].includes(j.state)).slice(0,8).map(({input,receipt,...job})=>{
  if(job.jobId.startsWith('native-session:')){
   const session=Number(job.jobId.slice('native-session:'.length));
   return {...job,...(Number.isInteger(session)?{nextCall:{name:'write_stdin',arguments:{session_id:session}}}:{})};
  }
  if(job.method==='materials_science'&&typeof input?.action==='string'){
   // Workflow and child run IDs share one receipt, but are not interchangeable.
   if(input.action.startsWith('auto_')&&receipt?.workflowId!==job.jobId)return job;
   const args={...input,action:input.action.startsWith('auto_')?'auto_get':'get',targetId:job.jobId,secondaryId:null,potentialId:null,evidenceIds:[]};
   const parsed=scienceActionSchema.safeParse(args);
   if(parsed.success)return {...job,nextCall:{name:'materials_science',arguments:parsed.data}};
  }
  return job;
 });
}
