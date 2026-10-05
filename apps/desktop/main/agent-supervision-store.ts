import type { WorkspaceStore } from './store.js';
import type { ResearchGoalPlan } from '../../../packages/contracts/src/research-goal.js';
import type { ExecutionEvent } from '../../../packages/contracts/src/task-execution.js';
import type { SupervisorOptions } from '../../../packages/agent/src/task-supervisor.js';
/** Plan revision and journal/event are committed together in the existing database. */
export function supervisionStore(store:WorkspaceStore,taskId:string,onEvent?:(event:ExecutionEvent)=>void,mutation?:()=>void):Pick<SupervisorOptions,'persist'|'savePlan'|'saveResult'|'readResult'> {
 let pending:ResearchGoalPlan|undefined;
 return {
  savePlan:plan=>{pending=plan;},
  persist:(state,expected,event)=>{
   const plan=pending;store.agentJournal.save(state,expected,event,plan?()=>{store.saveResearchPlan(plan);mutation?.();}:undefined);
   pending=undefined;onEvent?.(event);
  },
  saveResult:(hash,value)=>store.agentJournal.result(taskId,hash,value),
  readResult:hash=>store.agentJournal.readResult(taskId,hash),
 };
}
