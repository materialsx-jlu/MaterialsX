import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from './store.js';
import { TaskSupervisor } from '../../../packages/agent/src/task-supervisor.js';
import { directPlan } from '../../../packages/agent/src/research-planning.js';
import { taskRefSchema, permissionGrantSchema } from '../../../packages/contracts/src/agent.js';
import { needsReconciliation } from './agent-recovery.js';
test('journal CAS, ordered events, original budgets and unknown attempts survive real SQLite restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ua3-store-'));let store=new WorkspaceStore(join(dir,'workspace.sqlite'));
 try{
 const project=store.createProject(dir),conversation=store.createConversation(project.id),run=store.addRun(project.id,'test','running');
 const task=taskRefSchema.parse({taskId:run.id,projectId:project.id,conversationId:conversation.id}),grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId:project.id,conversationId:conversation.id,permissions:['terminal'],approvedBy:'local-user',maxCredits:null,maxSeconds:60});
 const context={task,grant,methods:new Map<string,readonly any[]>([['engine.execute',[]]])};
 const control=new TaskSupervisor({context,engine:'pi',connectionId:'fixture',accountRef:'local',projectPath:dir,
 persist:(s,v,e)=>store.agentJournal.save(s,v,e),savePlan:p=>store.saveResearchPlan(p),saveResult:(h,v)=>store.agentJournal.result(run.id,h,v),readResult:h=>store.agentJournal.readResult(run.id,h)});
 control.acceptPlan(directPlan('显示测试',context));control.beforeTool({id:'actual-call',name:'bash',args:{command:'test'},permissions:['terminal']});
 const before=control.snapshot();store.close();store=new WorkspaceStore(join(dir,'workspace.sqlite'));const after=store.agentJournal.read(run.id)!;
 assert.equal(after.startedAt,before.startedAt);assert.equal(after.deadline,before.deadline);assert.equal(after.state,'interrupted');assert.equal(after.attempts[0]?.state,'unknown');assert(needsReconciliation(after));
 assert.equal(store.agentJournal.events(run.id).length,after.sequence);
 const event={taskId:run.id,sequence:after.sequence+1,at:Date.now(),planRevision:after.planRevision,type:'step' as const,id:'test',state:'test',detail:null};
 const next={...after,sequence:after.sequence+1,version:after.version+1};assert.throws(()=>store.agentJournal.save(next,before.version,event),/版本/);
 assert.throws(()=>store.agentJournal.save({...next,engine:'codex'},after.version,event),/身份/);
 store.agentJournal.save(next,after.version,event);assert.equal(store.agentJournal.read(run.id)?.sequence,event.sequence);
 // Receipt schema is covered by existing native tests; result store independently preserves one real payload.
 store.agentJournal.result(run.id,'abc',{actual:true});store.agentJournal.result(run.id,'abc',{actual:true});assert.deepEqual(store.agentJournal.readResult(run.id,'abc'),{actual:true});
 assert.throws(()=>store.agentJournal.readResult(run.id,'missing'),/回执缺失/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
