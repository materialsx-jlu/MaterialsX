import type {ResearchGoalPlan} from '../../contracts/src/research-goal.js';
import type {TaskExecution,ToolAttempt} from '../../contracts/src/task-execution.js';
import {methodAssessmentSchema} from '../../contracts/src/research-methods.js';
import {nextDesignSchema} from '../../contracts/src/next-experiment.js';
import {atomicArtifactRoles} from './bounded-atomic-plan.js';
import {methodArtifactRoles} from './research-artifact-roles.js';
import {receiptClaimData} from './answer-assessment.js';
import {isMutableTool} from './task-understanding.js';
import type {Permission} from '../../contracts/src/agent.js';

/** Closed, deterministic completion contracts only. Free research still needs explicit acceptance. */
const readMethods=new Set(['read','ls','find','grep','rg','read_skill','read_material_file','skill_capabilities','potential_search','skill_search','research_data','paper_search','paper_get','paper_read','experiment_data','next_experiment_data','method_package_search','environment_check']);
export function acceptedDesignReceipt(attempt:ToolAttempt|undefined,read:(ref:string)=>unknown,taskId:string,projectId:string){
 const parsed=nextDesignSchema.safeParse(attempt?.resultRef?receiptClaimData(read(attempt.resultRef)):null);
 return parsed.success&&parsed.data.taskId===taskId&&parsed.data.projectId===projectId&&parsed.data.result.status==='planned';
}
export function completionReceipts(plan:ResearchGoalPlan,state:TaskExecution,step:ResearchGoalPlan['steps'][number],read:(ref:string)=>unknown,methods:ReadonlyMap<string,readonly Permission[]>):string[]|null{
 const attempts=state.attempts.filter(a=>a.stepId===step.id&&a.planRevision===state.planRevision&&a.state!=='stale');
 if(attempts.some(a=>['running','unknown'].includes(a.state)))return null;
 const jobs=new Map<string,string>();for(const a of attempts)for(const j of a.jobs)jobs.set(j.id,j.state);
 if([...jobs.values()].some(s=>s!=='completed'))return null;
 const good=attempts.filter(a=>a.state==='completed'&&a.resultRef);
 const primary=good.filter(a=>a.method===step.method);
 if(step.method==='research_methods'&&!step.expectedArtifacts.length){
  const assessment=primary.find(a=>{
   const input=a.inputRef?read(a.inputRef) as any:null;if(input?.args?.action!=='assess')return false;
   const parsed=methodAssessmentSchema.safeParse(receiptClaimData(read(a.resultRef!)));if(!parsed.success)return false;
   const v=parsed.data;return v.taskId===state.task.taskId&&v.projectId===state.task.projectId&&v.inputHashes.every(h=>plan.inputVersionRefs.some(i=>i.id===h.id&&i.sha256===h.sha256&&i.version===h.version));
  });return assessment?[assessment.id]:null;
 }
 if(step.method==='engine.execute'){
  if(!step.expectedArtifacts.length||!step.expectedArtifacts.every(n=>/\.[a-z0-9]+$/i.test(n)))return null;
  if(!good.some(a=>{const input=a.inputRef?read(a.inputRef) as any:null;return input&&isMutableTool({name:a.method,args:input.args,permissions:methods.get(a.method)??[]});}))return null;
 }else if(readMethods.has(step.method)&&!step.expectedArtifacts.length){
  if(!primary.length)return null;
 }else{
  const roles=step.method==='materials_science'?atomicArtifactRoles:methodArtifactRoles[step.method];
  if(!roles?.length||!roles.every(r=>step.expectedArtifacts.includes(r))||!primary.length)return null;
  if(step.method==='materials_science'&&(!jobs.size||!primary.some(a=>a.jobs.length)))return null;
  if(step.method==='campaign_job'&&!primary.some(a=>a.jobs.length&&a.jobs.every(j=>j.state==='completed')))return null;
  if(step.method==='next_experiment_design'&&!acceptedDesignReceipt(primary.at(-1),read,state.task.taskId,state.task.projectId))return null;
 }
 return good.map(a=>a.id);
}
