import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceStore} from './store.js';
import {supervisionStore} from './agent-supervision-store.js';
import {DesktopAgentRuntime} from './agent-runtime.js';
import {needsReconciliation} from './agent-recovery.js';
import {cloudRequestReconciliation,originalCloudSnapshot,reconcilePendingConversation} from './cloud-reconciliation.js';
import {TaskSupervisor} from '../../../packages/agent/src/task-supervisor.js';
import {directPlan} from '../../../packages/agent/src/research-planning.js';
import {alphaTaskSchema} from '../../../packages/contracts/src/platform.js';
import {taskRefSchema} from '../../../packages/contracts/src/agent.js';
import {harness} from '../../../packages/agent/src/task-supervisor.fixture.js';
import type {PlatformRunSnapshot} from '../../../packages/pi-adapter/src/platform-session.js';

function snapshot(clientTaskId:string,state='interrupted',count=0):PlatformRunSnapshot {
  return {task:alphaTaskSchema.parse({id:'cloud-original',clientTaskId,modelId:'materials-research',billingMode:'alpha-test',
    budget:{maxRequests:6,maxOutputTokensPerRequest:1024,maxDurationSeconds:180},
    consent:{policyVersion:'cloud-alpha-v1',prompt:true,history:'platform-only',fileCount:0,skillCount:0},
    state,scientificQuality:'not_evaluated',createdAt:new Date().toISOString(),deadline:new Date().toISOString(),requestCount:count}),requests:[]};
}
function pending(){const h=harness({account:'platform'});h.control.acceptPlan(h.plan);
  const request=h.control.beforeRequest({input:[],tools:[]},'execute',131072,1024);h.control.endRequest(request.id,'unknown');return h;}

test('a closed empty original M5 ledger reconciles legacy unknown requests without inventing usage',()=>{
  const h=pending(),state=h.control.snapshot(),actual=snapshot(state.task.taskId);
  const proof=cloudRequestReconciliation(state,actual);h.control.reconcileRequests(proof.records,proof.detail);
  const result=h.control.snapshot();assert(!needsReconciliation(result));assert.equal(result.requests[0]!.state,'failed');
  assert.equal(result.requests[0]!.usage,null);assert.equal(result.requests[0]!.id,state.requests[0]!.id);
  assert.equal(result.deadline,state.deadline);assert.match(h.events.at(-1)!.detail!,/requestCount=0/);
});
test('live empty tasks, nonempty counters and foreign task evidence cannot release old requests',()=>{
  const h=pending(),state=h.control.snapshot();
  for(const [phase,count] of [['created',0],['running',0],['interrupted',1]] as const)
    assert.equal(cloudRequestReconciliation(state,snapshot(state.task.taskId,phase,count)).records.length,0);
  assert.throws(()=>cloudRequestReconciliation(state,snapshot(randomUUID())),/另一轮/);
  assert(needsReconciliation(h.control.snapshot()));
});
test('an empty model ledger does not reconcile unknown tools or calculations',()=>{
  const h=pending();h.control.beforeTool(h.tool('unknown-mutation'));h.control.finish('failed');
  const proof=cloudRequestReconciliation(h.control.snapshot(),snapshot(h.task.taskId));
  h.control.reconcileRequests(proof.records,proof.detail);assert(needsReconciliation(h.control.snapshot()));
  assert.equal(h.control.snapshot().attempts[0]!.state,'unknown');
});
test('automatic and manual reconciliation bind older tasks exactly, persist through restart, and never generate',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mx-cloud-reconciliation-'));let store=new WorkspaceStore(join(dir,'workspace.sqlite'));
  try{
    const project=store.createProject(dir),conversation=store.createConversation(project.id),run=store.addRun(project.id,'fixture','running');
    const task=taskRefSchema.parse({taskId:run.id,projectId:project.id,conversationId:conversation.id});
    const grant={grantId:randomUUID(),projectId:project.id,conversationId:conversation.id,permissions:['read'] as const,
      approvedBy:'native-dialog' as const,maxCredits:'500',maxSeconds:180};
    const context={task,grant:{...grant,permissions:[...grant.permissions]},methods:new Map<string,readonly any[]>([['engine.execute',[]]])};
    const control=new TaskSupervisor({context,engine:'codex',connectionId:'fixture',accountRef:'platform',projectPath:dir,...supervisionStore(store,run.id)});
    control.acceptPlan(directPlan('Read fixture',context));const request=control.beforeRequest({input:[],tools:[]},'execute',131072,1024);
    control.endRequest(request.id,'unknown');control.finish('failed');
    store.saveCloudTask('platform',conversation.id,'cloud-original');store.saveCloudTask('platform',conversation.id,'cloud-newer');
    store.saveCloudTask('other-account',conversation.id,'cloud-foreign');
    const calls:string[]=[];
    const platform={async readSnapshot(id:string){calls.push(id);assert.notEqual(id,'cloud-foreign');
      return id==='cloud-original'?snapshot(run.id):{...snapshot(randomUUID()),task:{...snapshot(randomUUID()).task,id:'cloud-newer'}};}} as any;
    const runtime=new DesktopAgentRuntime(store,{} as any,platform,dir);
    const reconcile=(id:string,account:string)=>runtime.reconcile(id,account);
    assert.equal(await reconcilePendingConversation(store,conversation.id,undefined,reconcile),true);assert.equal(calls.length,0);
    assert.equal(await reconcilePendingConversation(store,conversation.id,'other-account',reconcile),true);assert.equal(calls.length,0);
    await assert.rejects(originalCloudSnapshot(store,platform,control.snapshot(),'other-account'),/原平台账户/);
    assert.equal(await reconcilePendingConversation(store,conversation.id,'platform',reconcile),false);
    assert(calls.includes('cloud-original'));const reconciled=store.agentJournal.read(run.id)!;
    assert.equal(reconciled.requests[0]!.usage,null);assert.equal(reconciled.requests[0]!.id,request.id);
    const count=calls.length;assert.equal(await reconcilePendingConversation(store,conversation.id,'platform',reconcile),false);assert.equal(calls.length,count);
    store.close();store=new WorkspaceStore(join(dir,'workspace.sqlite'));assert(!needsReconciliation(store.agentJournal.read(run.id)!));
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('offline reconciliation cannot make an unknown paid operation safe to repeat',async()=>{
  const h=pending(),store={cloudTaskIds:()=>['cloud-original']} as any;
  await assert.rejects(originalCloudSnapshot(store,{readSnapshot:async()=>{throw Error('offline')}} as any,h.control.snapshot(),'platform'),/offline/);
  assert(needsReconciliation(h.control.snapshot()));
});
