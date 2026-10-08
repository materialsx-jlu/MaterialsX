import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {TaskSupervisor,type SupervisorOptions} from './task-supervisor.js';
import {directPlan} from './research-planning.js';
import {taskRefSchema,permissionGrantSchema} from '../../contracts/src/agent.js';
import type {TaskExecution,ExecutionEvent} from '../../contracts/src/task-execution.js';
import type {ResearchGoalPlan} from '../../contracts/src/research-goal.js';
export function harness(options:{previous?:TaskExecution;plan?:ResearchGoalPlan;root?:string;account?:string;resolveArtifact?:SupervisorOptions['resolveArtifact'];deferJobs?:SupervisorOptions['deferJobs'];capabilityFacts?:SupervisorOptions['capabilityFacts']}={}) {
 const task=options.previous?.task??taskRefSchema.parse({taskId:randomUUID(),projectId:randomUUID(),conversationId:randomUUID()});
 const grant=options.previous?.grant??permissionGrantSchema.parse({grantId:randomUUID(),projectId:task.projectId,conversationId:task.conversationId,permissions:['read','search','terminal','patch','science'],approvedBy:'local-user',maxCredits:null,maxSeconds:60});
 const context={task,grant,methods:new Map<string,readonly any[]>([['engine.execute',[]],['read',['read']],['bash',['terminal']],['write',['patch']],['materials_science',['science']]])};
 let now=options.previous?.startedAt??1000,state:TaskExecution|undefined=options.previous;
 const results=new Map<string,unknown>(),events:ExecutionEvent[]=[];
 const control=new TaskSupervisor({context,engine:options.previous?.engine??'pi',connectionId:'fixture',accountRef:options.account??'local',projectPath:options.root??tmpdir(),...(options.previous?{previous:options.previous}:{}),...(options.plan?{previousPlan:options.plan}:{}),now:()=>now,...(options.deferJobs?{deferJobs:options.deferJobs}:{}),...(options.capabilityFacts?{capabilityFacts:options.capabilityFacts}:{}),
 ...(options.resolveArtifact?{resolveArtifact:options.resolveArtifact}:{}),
 persist:(next,expected,event)=>{assert.equal(state?.version??null,expected);state=next;events.push(event);},savePlan:()=>{},saveResult:(hash,value)=>{results.set(hash,value);return hash;},readResult:ref=>results.get(ref)});
 const plan=options.plan??directPlan('显示文件',context);
 const tool=(id:string,name='bash',args:unknown={command:'fixture'})=>({id,name,args,permissions:name==='bash'?['terminal'] as const:name==='read'?['read'] as const:name==='materials_science'?['science'] as const:['patch'] as const});
 return {control,plan,task,context,results,events,tool,tick:(ms:number)=>{now+=ms;}};
}
