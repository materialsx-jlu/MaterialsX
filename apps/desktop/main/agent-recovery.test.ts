import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from './store.js';
import { supervisionStore } from './agent-supervision-store.js';
import { TaskSupervisor } from '../../../packages/agent/src/task-supervisor.js';
import { directPlan } from '../../../packages/agent/src/research-planning.js';
import { taskRefSchema, permissionGrantSchema } from '../../../packages/contracts/src/agent.js';
import { requireRecoverable, requireHandoffCheckpoint,needsReconciliation } from './agent-recovery.js';
import {harness} from '../../../packages/agent/src/task-supervisor.fixture.js';
test('plan and journal revisions roll back together; stale callback cannot replace current goal',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-ua3-atomic-'));const store=new WorkspaceStore(join(dir,'workspace.sqlite'));
 try{
 const p=store.createProject(dir),c=store.createConversation(p.id),r=store.addRun(p.id,'test','running');
 const task=taskRefSchema.parse({taskId:r.id,projectId:p.id,conversationId:c.id}),grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId:p.id,conversationId:c.id,permissions:['read','terminal'],approvedBy:'local-user',maxCredits:null,maxSeconds:60});
 const context={task,grant,methods:new Map<string,readonly any[]>([['engine.execute',[]]])};
 const ctl=new TaskSupervisor({context,engine:'pi',connectionId:'fixture',accountRef:'local',projectPath:dir,...supervisionStore(store,r.id)});ctl.acceptPlan(directPlan('显示内容',context));
 const old=ctl.snapshot(),nextPlan=structuredClone(ctl.plan()!);nextPlan.planRevision++;nextPlan.goalRevision++;nextPlan.goal.problemType='new';nextPlan.originalRequest='new';
 const next={...old,version:old.version+1,sequence:old.sequence+1,planRevision:2};
 const event={taskId:r.id,sequence:next.sequence,at:Date.now(),planRevision:2,type:'revision' as const,id:'test',state:'accepted',detail:null};
 assert.throws(()=>store.agentJournal.save(next,old.version,event,()=>{store.saveResearchPlan(nextPlan);throw new Error('simulate crash');}),/simulate crash/);
 assert.equal(store.researchPlan(r.id)?.planRevision,1);assert.equal(store.agentJournal.read(r.id)?.version,old.version);
 ctl.revise(nextPlan,1,'user');assert.equal(store.researchPlan(r.id)?.planRevision,2);assert.equal(store.agentJournal.read(r.id)?.planRevision,2);
 assert.throws(()=>store.agentJournal.save(next,old.version,event,()=>store.saveResearchPlan(nextPlan)),/版本/);
 ctl.beforeTool({id:'mutation',name:'bash',args:{command:'fixture'},permissions:['terminal']});ctl.afterTool('mutation',{actual:true},false);
 const partial=ctl.snapshot();partial.state='failed';assert.throws(()=>requireHandoffCheckpoint(partial),/部分操作/);
 await ctl.command({action:'complete',stepId:nextPlan.steps[0]!.id,expectedRevision:2,receiptIds:['mutation']});
 const accepted=ctl.snapshot();accepted.state='failed';requireHandoffCheckpoint(accepted);
 const state=ctl.snapshot();state.state='handed_off';assert.throws(()=>requireRecoverable(state),/交接/);
 state.state='interrupted';state.deadline=Date.now()-1;assert.throws(()=>requireRecoverable(state),/预算/);
 const exhausted=ctl.snapshot();exhausted.state='failed';exhausted.deadline=Date.now()+60000;
 exhausted.recovery={corrections:2,total:2,progress:[],lastFault:{kind:'budget',phase:'rejected',next:'stop'}};
 assert.throws(()=>requireRecoverable(exhausted),/有限恢复预算/);
 assert.throws(()=>requireHandoffCheckpoint(exhausted),/有限恢复预算/);
 const unknown=structuredClone(exhausted);unknown.attempts[0]!.state='unknown';
 assert.throws(()=>requireRecoverable(unknown),/先查询回执/);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('a failed paid generation is blocked until its original M5 settlement is explicitly reconciled',()=>{
 const h=harness({account:'platform'});h.control.acceptPlan(h.plan);
 const request=h.control.beforeRequest({input:[],tools:[]},'execute',131072,128);h.control.endRequest(request.id,'failed');
 assert(needsReconciliation(h.control.snapshot()));assert.throws(()=>requireRecoverable(h.control.snapshot()),/先查询回执/);
 h.control.reconcileRequests([{id:'foreign',state:'failed',usage:null}]);assert(needsReconciliation(h.control.snapshot()));
 h.control.reconcileRequests([{id:request.id,state:'failed',usage:null}]);const state=h.control.snapshot();
 assert(!needsReconciliation(state));assert.equal(state.requests.length,1);assert.equal(state.requests[0]!.id,request.id);assert.equal(state.requests[0]!.state,'failed');assert.equal(state.requests[0]!.reconciledAt,state.startedAt);
 assert(!h.control.canRecoverModelResponse()); // Settlement confirmation alone cannot authorize a model retry.
});
