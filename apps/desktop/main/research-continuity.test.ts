import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WorkspaceStore} from './store.js';
import {runtimeWorkingContext,restoreContextFiles} from './runtime-working-context.js';
import {createWorkingContext,verifyWorkingContext,readHistoricalReceipts} from './research-continuity.js';
import {taskRefSchema} from '../../../packages/contracts/src/agent.js';
import {TaskSupervisor} from '../../../packages/agent/src/task-supervisor.js';
import {directPlan} from '../../../packages/agent/src/research-planning.js';
import {supervisionStore} from './agent-supervision-store.js';
import {selectedAssetTools} from '../../../packages/agent/src/selected-assets.js';
import {sourceHash} from '../../../packages/agent/src/data-source-router.js';
import type {BoundReference} from '../../../packages/contracts/src/task-references.js';
const sha='a'.repeat(64);
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'mx-ap5-context-'));let store=new WorkspaceStore(join(dir,'state.sqlite'));
 const project=store.createProject(dir),conversation=store.createConversation(project.id),methods=new Map<string,readonly any[]>([['engine.execute',[]],['read_material_file',['read']],['write',['patch']]]);
 const asset={id:'frozen-input',name:'input.txt',text:'Source p.2: Si; temperature 300 K\nNo experimental validation.',sha256:createHash('sha256').update('Source p.2: Si; temperature 300 K\nNo experimental validation.').digest('hex')};
 const start=(request:string,files=[asset],bindings:BoundReference[]=[],account='local',recovery?:any)=>{
  const run=recovery?{id:recovery.task.taskId}:store.addRun(project.id,request,'running'),task=taskRefSchema.parse({taskId:run.id,projectId:project.id,conversationId:conversation.id});
  const grant=recovery?.grant??{grantId:randomUUID(),projectId:project.id,conversationId:conversation.id,permissions:['read','patch'],approvedBy:'local-user' as const,maxCredits:null,maxSeconds:600};
  const context={task,grant,methods};const options=runtimeWorkingContext(store,undefined,task,account,request,dir,bindings,{files,skills:[]},account!=='local',recovery?.workingContext);
  const control=new TaskSupervisor({context,engine:'codex',connectionId:'fixture',accountRef:account,projectPath:dir,...options,...(recovery?{previous:recovery,previousPlan:store.researchPlan(run.id)!}:{}),...supervisionStore(store,run.id)});
  if(!recovery)control.acceptPlan(directPlan(request,context));return {run,task,control,context,options};
 };
 return {dir,project,conversation,asset,start,get store(){return store;},restart:()=>{store.close();store=new WorkspaceStore(join(dir,'state.sqlite'));},close:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('three follow-up tasks bind real prior inputs and exact read receipts; restart preserves lineage without replay or old grants',async()=>{
 const f=fixture();try{
  const first=f.start('读取附件，给出证据范围');first.control.beforeTool({id:'original-read',name:'read_material_file',args:{fileId:f.asset.id},permissions:['read']});
  const actual=await selectedAssetTools({files:[f.asset],skills:[]})[0]!.execute({fileId:f.asset.id},new AbortController().signal);
  first.control.afterTool('original-read',actual,false);first.control.finish('completed_with_limitations');
  assert.equal(first.control.snapshot().workingContext!.references[0]!.readings[0]!.range,'lines 1–2');
  const second=f.start('基于这个文件，只解释 300 K 的含义，不创建文件',[]);
  assert.equal(second.control.snapshot().workingContext!.references[0]!.id,f.asset.id);
  const receipt=await second.control.command({action:'receipt',sourceTaskId:first.run.id,receiptIds:['original-read']}) as any;
  assert.equal(receipt.receipts[0].result.content[0].text,(actual as any).content[0].text);
  assert.equal(second.control.snapshot().attempts.length,0,'historical read is not a new tool execution or step completion');
  second.control.finish('completed_with_limitations');f.restart();
  const third=f.start('继续使用这个文件，改为列出缺失条件，不运行',[]);
  const c=third.control.snapshot().workingContext!;assert.equal(c.references[0]!.sha256,f.asset.sha256);assert(c.history.some(h=>h.taskId===first.run.id));assert(c.history.some(h=>h.taskId===second.run.id));
  const before=third.control.snapshot();f.restart();const saved=f.store.agentJournal.read(third.run.id)!;assert.equal(saved.state,'interrupted');
  assert.equal(restoreContextFiles(f.store,third.task,'继续使用这个文件',null,saved.workingContext)[0]!.text,f.asset.text);
  assert.equal(restoreContextFiles(f.store,third.task,'@file:frozen-input 读取第2行',null)[0]!.sha256,f.asset.sha256);
  assert.equal(restoreContextFiles(f.store,third.task,'讨论别的问题',null).length,0);
  const resumed=f.start('继续使用这个文件，改为列出缺失条件，不运行',[],[], 'local',saved);
  assert.equal(resumed.control.snapshot().workingContext!.sha256,before.workingContext!.sha256);assert.deepEqual(resumed.control.snapshot().grant,before.grant);
  resumed.control.resume();assert.equal(resumed.control.snapshot().attempts.length,0);assert.equal(resumed.control.snapshot().requests.length,0);
  await resumed.control.command({action:'receipt',sourceTaskId:first.run.id,receiptIds:['original-read']});
  resumed.control.finish('completed_with_limitations');assert.equal(resumed.control.snapshot().deliveryAssessment!.technical,'complete');
 }finally{f.close();}
});
test('unrelated tasks, projects, conversations, accounts and changed team authorization cannot import historical evidence',()=>{
 const f=fixture();try{
  const first=f.start('绑定真实输入');first.control.finish('completed_with_limitations');
  const make=(task:any,account='local',key:string|null=null,request='继续')=>createWorkingContext(f.store,task,account,key,request,[],false);
  const task=taskRefSchema.parse({...first.task,taskId:randomUUID()});
  assert.equal(make(task,'another-account').history.length,0);assert.equal(make(task,'local',sha).history.length,0);
  const otherConversation=f.store.createConversation(f.project.id);assert.equal(make({...task,conversationId:otherConversation.id}).history.length,0);
  const otherProject=f.store.createProject(join(f.dir,'other'));assert.equal(make({...task,projectId:otherProject.id}).history.length,0);
  assert.equal(make(task,'local',null,'讲解热力学').history.length,0);
  const cloud=make(task,'platform-user');assert.equal(cloud.history.length,0);
  assert.throws(()=>createWorkingContext(f.store,task,'other',null,'继续',[],false,first.control.snapshot().workingContext),/SCOPE_CHANGED/);
 }finally{f.close();}
});
test('multiple singular references ask for an exact object; explicit selection resolves ambiguity',()=>{
 const f=fixture();try{
  const refs=['structure-a','structure-b'].map(id=>({kind:'structure' as const,id,label:id,projectId:f.project.id,version:sha,sha256:sha,status:'bound' as const,range:'immutable imported structure'}));
  // Generic store-level builder; actual runtime additionally verifies owned structures through AtomisticRuntime.
  const first=f.start('说明所选结构',[],refs);first.control.finish('completed_with_limitations');
  const task=taskRefSchema.parse({...first.task,taskId:randomUUID()});
  const c=createWorkingContext(f.store,task,'local',null,'这个结构继续分析',[],false);assert.equal(c.ambiguities.length,1);assert.equal(c.references.length,2);
  const selected=createWorkingContext(f.store,task,'local',null,'这个结构继续分析',[refs[0]!],false);assert.equal(selected.ambiguities.length,0);assert.equal(selected.references.length,1);
 }finally{f.close();}
});
test('source revision/withdrawal signals impacts, blocks historical reuse and never silently substitutes a new version',()=>{
 const f=fixture();try{
  const data={observations:[{id:'o1',value:4,unit:'g'}]},s=f.store.research.saveSnapshot({id:randomUUID(),projectId:f.project.id,origin:'project',title:'source',ref:null,sha256:sourceHash(data),version:'1',retrievedAt:new Date().toISOString(),reviewStatus:'unreviewed',evidence:[],data,receipts:[]});
  const run=f.start('选择来源',[],[{kind:'recipe',id:s.id,label:s.title,projectId:f.project.id,version:s.version,sha256:s.sha256,status:'bound',range:'selected metadata'}]);run.control.finish('completed_with_limitations');
  const task=taskRefSchema.parse({...run.task,taskId:randomUUID()}),c=createWorkingContext(f.store,task,'local',null,'上述配方继续分析',[],false);
  const p=f.store.research.project(f.project.id);f.store.research.saveProject({...p,revision:p.revision+1,withdrawn:[s.id]},p.revision);
  const stale=verifyWorkingContext(f.store,c,f.dir);assert.equal(stale.references[0]!.version,'1');assert.equal(stale.references[0]!.status,'stale');assert(stale.notices.length);
  assert.throws(()=>readHistoricalReceipts(f.store,stale,run.run.id,[],false),/EVIDENCE_CHANGED/);
 }finally{f.close();}
});
test('current cloud export selection never imports local-only context or raw prior receipts',()=>{
 const f=fixture();try{
  const first=f.start('已批准的云输入', [f.asset],[],'platform-user');first.control.finish('completed_with_limitations');
  const task=taskRefSchema.parse({...first.task,taskId:randomUUID()}),c=createWorkingContext(f.store,task,'platform-user',null,'继续使用这个文件',[],true);
  assert.equal(c.references.length,0);assert(c.notices.length);assert.equal(c.history[0]!.receipts.length,0);assert.equal(c.history[0]!.artifacts.length,0);
  assert.throws(()=>readHistoricalReceipts(f.store,c,first.run.id,[],true),/NOT_AUTHORIZED/);
 }finally{f.close();}
});

test('cloud recipe follow-up binds an actually read identical reapproved attachment without inventing a recipe object',async()=>{
 const f=fixture();try{
  const first=f.start('读取本轮批准的配方附件',[f.asset],[],'platform-user');
  first.control.beforeTool({id:'read-source',name:'read_material_file',args:{fileId:f.asset.id},permissions:['read']});
  first.control.afterTool('read-source',await selectedAssetTools({files:[f.asset],skills:[]})[0]!.execute({fileId:f.asset.id},new AbortController().signal),false);
  first.control.finish('completed_with_limitations');f.restart();
  const second=f.start('基于上述配方，生成建议工艺',[f.asset],[],'platform-user');
  const c=second.control.snapshot().workingContext!;assert.deepEqual(c.ambiguities,[]);
  assert.equal(c.references[0]!.kind,'file');assert.equal(c.references[0]!.originTaskId,first.run.id);
  assert.equal(c.history[0]!.receipts.length,0);assert.equal(second.control.snapshot().attempts.length,0);
  const absent=f.start('基于上述配方，生成建议工艺',[],[],'platform-user');assert(absent.control.snapshot().workingContext!.ambiguities.length);
  const changed=f.start('基于上述配方，生成建议工艺',[{...f.asset,text:'changed',sha256:sha}],[],'platform-user');assert(changed.control.snapshot().workingContext!.ambiguities.length);
  const otherAccount=f.start('基于上述配方，生成建议工艺',[f.asset],[],'other-account');assert(otherAccount.control.snapshot().workingContext!.ambiguities.length);
 }finally{f.close();}
});
test('an unread selected attachment cannot resolve a recipe follow-up',()=>{
 const f=fixture();try{
  const first=f.start('选择配方附件',[f.asset],[],'platform-user');first.control.finish('completed_with_limitations');
  const next=f.start('基于上述配方生成建议',[f.asset],[],'platform-user');assert(next.control.snapshot().workingContext!.ambiguities.length);
 }finally{f.close();}
});

test('multiple current attachments in a singular follow-up require selection before writing; genuine reads stay permitted',()=>{
 const f=fixture();try{
  const first=f.start('这个文件用于分析',[f.asset,{...f.asset,id:'another-file',name:'another.txt'}]);
  assert.equal(first.control.snapshot().workingContext!.ambiguities.length,1);
  assert.throws(()=>first.control.beforeTool({id:'write-with-ambiguous-input',name:'write',args:{path:'report.json'},permissions:['patch']}),/Multiple file/);
  assert.equal(first.control.snapshot().attempts.length,0);
  first.control.beforeTool({id:'inspect-first',name:'read_material_file',args:{fileId:f.asset.id},permissions:['read']});
  first.control.afterTool('inspect-first',{id:f.asset.id,sha256:f.asset.sha256},false);first.control.finish('completed_with_limitations');
  assert.equal(first.control.snapshot().state,'blocked','reads alone cannot resolve an actual ambiguous user selection');
 }finally{f.close();}
});
