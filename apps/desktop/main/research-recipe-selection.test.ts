import {buildRecipeProposal,recipeProposalGuidance,acceptedRecipeProposals} from './research-recipe-proposal.js';
import {taskRefSchema} from '../../../packages/contracts/src/agent.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceStore} from './store.js';
import {ResearchService} from './research-service.js';
import {TaskSupervisor} from '../../../packages/agent/src/task-supervisor.js';
import {supervisionStore} from './agent-supervision-store.js';
import {directPlan} from '../../../packages/agent/src/research-planning.js';
import {sourceHash} from '../../../packages/agent/src/data-source-router.js';
import {recipeSnapshots,requestedRecipeCount} from './research-recipe-view.js';
import type {MoosRef} from '../../../packages/contracts/src/research-project.js';
const request='搜索 MOOS 中的水性辐射制冷涂料配方，允许本次读取待复核记录，列出组分、原始用量、制备步骤及证据页码。并最终形成 3个实验配方';
const ref:MoosRef={connectionId:'moos-local',sourceId:1,packageImportId:2,experimentId:3,generation:2,packageSha256:'a'.repeat(64),projectionSha256:'b'.repeat(64),reviewScope:'include-unreviewed',reviewStatus:'pending_review'};
async function setup(){
 const dir=await mkdtemp(join(tmpdir(),'mx-recipe-selection-')),store=new WorkspaceStore(join(dir,'state.sqlite')),project=store.createProject(dir),conversation=store.createConversation(project.id),run=store.addRun(project.id,request,'running');
 const calls:Array<{name:string;args:any}>=[];
 const client={close:async()=>{},call:async(name:string,args:any)=>{calls.push({name,args});return {content:[{type:'text',text:JSON.stringify({adapterVersion:'moos-mcp-v1',projectionVersion:'rpsme-experiment-sections-v1.1',authorizationScope:'local-research',cloudExportAuthorized:false,externalModelCalls:0,receipts:[],retrievedAt:new Date().toISOString(),data:name==='moos_search'?{items:[{label:'水性',ref}],nextCursor:null}:{} })}]};},readResource:async()=>({contents:[]})};
 const service=new ResearchService(store,{client:client as any});
 const snapshots=[3,4,5].map(experimentId=>{const data={recipes:[{id:'recipe'}],ingredients:[{material_id:'BaSO4',amount:{original_value:experimentId,original_unit:'g'},evidence_ids:['e1']},...(experimentId===3?[{material_id:'binder',amount:{original_value:1,original_unit:'mL'},evidence_ids:['e1']}]:[])],processes:[{source_text:'Mix',evidence_ids:['e1']}],readEvidence:[{id:'e1',locator:{pdf_page:2},evidence_text:'actual recipe'}]};return store.research.saveSnapshot({id:randomUUID(),projectId:project.id,origin:'moos',title:'水性辐射制冷涂料 WCP-'+experimentId,ref:{...ref,experimentId},sha256:sourceHash(data),version:'2',retrievedAt:new Date().toISOString(),reviewStatus:'pending_review',evidence:[],data,receipts:[]});});
 const p=store.research.project(project.id);store.research.saveProject({...p,revision:2,selected:snapshots.map(s=>s.id)},1);service.begin(run.id,project.id,request);
 const context={task:{taskId:run.id,projectId:project.id,conversationId:conversation.id} as any,grant:{grantId:randomUUID(),projectId:project.id,conversationId:conversation.id,permissions:['read','search'] as any,approvedBy:'local-user' as const,maxCredits:null,maxSeconds:600},methods:new Map<string,readonly any[]>([['engine.execute',[]],['research_data',['read','search']]])};
 const control=new TaskSupervisor({context,engine:'codex',connectionId:'local',accountRef:'local',projectPath:dir,sourceRetrievalComplete:()=>service.deliveryIssue(run.id)===null,modelCompletionIssue:()=>service.recipeRetrievalIssue(run.id),...supervisionStore(store,run.id)});control.acceptPlan(directPlan(request,context));
 let seq=0;
 const call=async(args:any)=>{const id='call-'+ ++seq;control.beforeTool({id,name:'research_data',args,permissions:['read','search']});const result=await service.data(project.id,run.id,args);control.afterTool(id,{content:[{type:'text',text:JSON.stringify(result)}]},false);return result as any;};
 return {dir,store,project,conversation,run,service,calls,snapshots,control,call,close:async()=>{await service.close();store.close();await rm(dir,{recursive:true,force:true});}};
}
test('project search returns the same scoped candidate handle interface as whole MOOS search',async()=>{
 const s=await setup();try{
  const result=await s.call({action:'search',query:'水性',reviewScope:'include-unreviewed'});assert.equal(result.origin,'project');assert.equal(result.items.length,3);
  const candidate=result.items.find((i:any)=>i.title===s.snapshots[0]!.title);assert.match(candidate.candidateId,/^moos-[a-f0-9]{24}$/);assert.equal(candidate.ref,undefined);assert.equal(candidate.snapshotId,undefined);
  const selected=await s.call({action:'select',candidateId:candidate.candidateId});assert.equal(selected.snapshotId,s.snapshots[0]!.id);
  assert.match(s.service.recipeRetrievalIssue(s.run.id)!,/0\/3/);assert.equal(s.control.sourceRetrievalComplete(),false); // selecting metadata is not reading
  const source=await s.call({action:'read',snapshotId:selected.snapshotId,section:'recipe'});assert.equal(source.rows.ingredients[0].amount.original_value,3);assert.equal(source.rows.readEvidence[0].locator.pdf_page,2);
  assert.match(s.service.recipeRetrievalIssue(s.run.id)!,/1\/3/);
  await assert.rejects(s.control.command({action:'complete',stepId:s.control.snapshot().activeStepId,expectedRevision:1,receiptIds:[s.control.snapshot().attempts.at(-1)!.id]}),/Incomplete source retrieval/);
  assert(s.control.canRecoverModelResponse());
  await s.call({action:'read',snapshotId:selected.snapshotId,section:'recipe'});assert.equal(recipeSnapshots(s.store,s.run.id).length,1);
  for(const snapshot of s.snapshots.slice(1))await s.call({action:'read',snapshotId:snapshot.id,section:'recipe'});
  assert.equal(s.service.recipeRetrievalIssue(s.run.id),null);assert.equal(s.control.modelCompletionIssue(),null);assert.equal(s.control.sourceRetrievalComplete(),true);
  const requests=s.control.snapshot().requests.length;assert.throws(()=>s.control.beforeRequest({messages:[{role:'user',content:'x'.repeat(500000)}]},'execute',1000,800),/VERIFIED_SOURCE_READY/);assert.equal(s.control.snapshot().requests.length,requests);
  const text=await s.service.sourceAnswer(s.run.id);assert.match(text!,/已读取 3 个/);assert.match(text!,/实验配方候选 3/);assert.match(text!,/组分记录不完整/);
  await assert.rejects(s.service.data(s.project.id,s.run.id,{action:'select',candidateId:selected.snapshotId}),/Invalid string/);
  await assert.rejects(s.service.data(s.project.id,'other-task',{action:'select',candidateId:candidate.candidateId}),/TASK_MISSING/);
  const whole=await s.call({action:'search',query:'水性',source:'moos',reviewScope:'include-unreviewed'});assert.equal(whole.origin,'moos');assert(s.calls.some(c=>c.name==='moos_search'));assert.equal(s.calls.find(c=>c.name==='moos_search')!.args.source,undefined);
  const before=s.store.research.snapshot(s.project.id,selected.snapshotId);assert.throws(()=>s.store.research.saveSnapshot({...before,version:'3'}),/Immutable/);
  const original=s.store.research.snapshot.bind(s.store.research);s.store.research.snapshot=(projectId,id)=>({...original(projectId,id),version:'3'});
  await assert.rejects(s.service.data(s.project.id,s.run.id,{action:'select',candidateId:candidate.candidateId}),/SNAPSHOT_CHANGED/);
 }finally{await s.close();}
});
test('read sections qualify only as an actual complete recipe group, never just a search or ingredients',async()=>{
 const s=await setup();try{
  const id=s.snapshots[0]!.id;
  await s.call({action:'read',snapshotId:id,section:'ingredients'});assert.equal(recipeSnapshots(s.store,s.run.id).length,0);
  await s.call({action:'read',snapshotId:id,section:'processes'});assert.equal(recipeSnapshots(s.store,s.run.id).length,0);
  await s.call({action:'read',snapshotId:id,section:'readEvidence'});assert.equal(recipeSnapshots(s.store,s.run.id).length,1);
 }finally{await s.close();}
});
test('recipe counts recognize Chinese and English requests and do not silently cap the requested count',()=>{
 for(const [text,count] of [['3个实验配方',3],['三套配方',3],['12 recipes',12],['二十三个配方',23],['recipe search',1]] as const)assert.equal(requestedRecipeCount(text),count);
});
test('one bounded recipe batch reads exact searched records and cannot invent or duplicate handles',async()=>{
 const s=await setup();try{
  const found=await s.call({action:'search',query:'水性',reviewScope:'include-unreviewed'}),candidateIds=found.items.map((i:any)=>i.candidateId);
  const result=await s.call({action:'read_recipes',candidateIds});assert.equal(result.snapshots.length,3);assert(result.snapshots.every((r:any)=>r.section==='recipe'&&r.rows.ingredients.length&&r.rows.readEvidence.length));
  assert.equal(recipeSnapshots(s.store,s.run.id).length,3);assert.equal(s.service.recipeRetrievalIssue(s.run.id),null);
  await assert.rejects(s.service.data(s.project.id,s.run.id,{action:'read_recipes',candidateIds:[candidateIds[0],candidateIds[0]]}),/Duplicate/);
  await assert.rejects(s.service.data(s.project.id,s.run.id,{action:'read_recipes',candidateIds:['moos-'+'0'.repeat(24)]}),/NOT_IN_TASK/);
 }finally{await s.close();}
});

test('recipe suggestions carry all actually read previous sources only within the same conversation',async()=>{
 const s=await setup();try{
  for(const snapshot of s.snapshots)await s.call({action:'read',snapshotId:snapshot.id,section:'recipe'});
  s.control.finish('completed_with_limitations');
  const p=s.store.research.project(s.project.id);s.store.research.saveProject({...p,revision:3,selected:s.snapshots.slice(0,2).map(v=>v.id)},2);
  const request='基于上述配方，生成你建议的配方工艺',run=s.store.addRun(s.project.id,request,'running');
  const binding=s.service.begin(run.id,s.project.id,request,s.conversation.id);
  assert.deepEqual(binding.snapshotIds,s.snapshots.map(v=>v.id));assert.equal(binding.approvedInputs.filter(i=>s.snapshots.some(v=>v.id===i.id)).length,3);
  const context={...s.control.planningContext(),grant:s.control.snapshot().grant,methods:new Map<string,readonly any[]>([['engine.execute',[]],['research_data',['read','search']],['recipe_proposal',['read']]]),task:taskRefSchema.parse({...s.control.snapshot().task,taskId:run.id})};
  const control=new TaskSupervisor({context,engine:'codex',connectionId:'local',accountRef:'local',projectPath:s.dir,...supervisionStore(s.store,run.id)});
  control.acceptPlan(directPlan(request,context));assert.match(s.service.recipeRetrievalIssue(run.id)!,/read_current_recipes/);
  assert.match(s.service.context(run.id)!.guidance,/recipeProposal/);
  await assert.rejects(s.service.data(s.project.id,run.id,{action:'read_current_recipes',value:[]} ),/Unrecognized key/);
  await assert.rejects(s.service.data(s.project.id,run.id,{action:'read_current_recipes',snapshotId:s.snapshots[0]!.id}),/ACTION_ONLY/);
  await assert.rejects(s.service.data(s.project.id,run.id,{action:'search',query:'new pending recipes',source:'moos',reviewScope:'include-unreviewed'}),/USER_OPT_IN/);
  control.beforeTool({id:'source-read',name:'research_data',args:{action:'read_current_recipes'},permissions:['read','search']});
  const result=await s.service.data(s.project.id,run.id,{action:'read_current_recipes'}) as any;
  control.afterTool('source-read',{content:[{type:'text',text:JSON.stringify(result)}]},false);
  assert.equal(result.snapshots.length,3);assert.equal(JSON.parse(s.service.context(run.id)!.guidance).recipeProposal.readCall,null);assert.equal(recipeSnapshots(s.store,run.id).length,3);assert.match(s.service.recipeRetrievalIssue(run.id)!,/recipe_proposal/);
  assert.equal(await s.service.sourceAnswer(run.id),null,'no draft can be claimed from model narrative alone');
  assert.equal(control.sourceRetrievalComplete(),false,'proposal must still reach the model after source reads');
  assert.deepEqual(recipeProposalGuidance(s.store,run.id,()=>false)!.baselines,[],'revoked source quantities must not enter proposal guidance');
  const proposed={name:'Candidate',changes:[{component:1,amount:2,unit:'g',reason:'Proposed exploratory change'}],preparation:['follow_source','check_viscosity'],checks:['composition','repeatability'],gaps:['Solids unknown']};
  assert.throws(()=>buildRecipeProposal(s.store,run.id,{...proposed,baselineSnapshotId:s.snapshots[1]!.id}),/BASELINE/);
  assert.throws(()=>buildRecipeProposal(s.store,run.id,{...proposed,changes:[{...proposed.changes[0]!,unit:'mL'}]}),/UNIT_MISMATCH/);
  assert.throws(()=>buildRecipeProposal(s.store,run.id,{...proposed,changes:[proposed.changes[0]!,proposed.changes[0]!]}),/DUPLICATE/);
  control.beforeTool({id:'proposal',name:'recipe_proposal',args:proposed,permissions:['read']});
  assert.throws(()=>buildRecipeProposal(s.store,run.id,{...proposed,preparation:['Mix in 200 mL water and apply 5 kV']}),/Invalid option/);
  const draft=buildRecipeProposal(s.store,run.id,proposed);control.afterTool('proposal',{content:[{type:'text',text:JSON.stringify(draft)}]},false);
  assert.equal(s.service.recipeRetrievalIssue(run.id),null);assert.equal(draft.materials[0]!.originalAmount,3);assert.equal(draft.materials[0]!.proposedAmount,2);assert.equal(draft.status,'draft_unverified');
  assert.match((await s.service.sourceAnswer(run.id))!,/来源原值/);assert.match(draft.text,/PDF p.2/);assert.match(draft.text,/未执行、未验证/);

  const other=s.store.createConversation(s.project.id),otherRun=s.store.addRun(s.project.id,request,'running');
  assert.equal(s.service.begin(otherRun.id,s.project.id,request,other.id).snapshotIds.length,2,'no previous third source leaks across conversations');
  const source=s.snapshots[0]!;const current=s.store.research.project(s.project.id);s.store.research.saveProject({...current,revision:4,selected:[],withdrawn:[source.id]},3);
  await assert.rejects(s.service.data(s.project.id,run.id,{action:'read_current_recipes'}),/WITHDRAWN|STALE_OR_RETRACTED/);
  const withdrawnRun=s.store.addRun(s.project.id,request,'running');assert.throws(()=>s.service.begin(withdrawnRun.id,s.project.id,request,s.conversation.id),/WITHDRAWN|STALE_OR_RETRACTED/);
 }finally{await s.close();}
});

test('three source-grounded suggestions require distinct named, receipted variants; one draft and renamed duplicates cannot complete',async()=>{
 const s=await setup();try{
  for(const snapshot of s.snapshots)await s.call({action:'read',snapshotId:snapshot.id,section:'recipe'});
  s.control.finish('completed_with_limitations');
  const request='基于上述配方，提出三个不同的建议方案，不运行模拟，不创建文件',run=s.store.addRun(s.project.id,request,'running');s.service.begin(run.id,s.project.id,request,s.conversation.id);
  const context={...s.control.planningContext(),task:taskRefSchema.parse({...s.control.snapshot().task,taskId:run.id}),grant:s.control.snapshot().grant,
   methods:new Map<string,readonly any[]>([['engine.execute',[]],['research_data',['read','search']],['recipe_proposal',['read']]])};
  const control=new TaskSupervisor({context,engine:'codex',connectionId:'local',accountRef:'local',projectPath:s.dir,deliveryIssue:()=>s.service.recipeRetrievalIssue(run.id),...supervisionStore(s.store,run.id)});
  control.acceptPlan(directPlan(request,context));
  const record=async(id:string,name:string,amount:number)=>{
   const input={name,changes:[{component:1,amount,unit:'g',reason:'Candidate change, not measured'}],preparation:['follow_source'],checks:['composition'],gaps:['Density and solids require confirmation']};
   control.beforeTool({id,name:'recipe_proposal',args:input,permissions:['read']});
   control.afterTool(id,{content:[{type:'text',text:JSON.stringify(buildRecipeProposal(s.store,run.id,input))}]},false);
  };
  assert.throws(()=>buildRecipeProposal(s.store,run.id,{name:'Imagined draft',changes:[],preparation:['follow_source'],checks:['composition'],gaps:['missing']}),/READ_FROZEN/);
  control.beforeTool({id:'sources',name:'research_data',args:{action:'read_current_recipes'},permissions:['read','search']});
  control.afterTool('sources',{content:[{type:'text',text:JSON.stringify(await s.service.data(s.project.id,run.id,{action:'read_current_recipes'}))}]},false);
  await record('one','方案一',2);assert.match(s.service.recipeRetrievalIssue(run.id)!,/3 个具名建议，当前 1 个/);
  await record('copy','方案二',2);await record('copy-again','方案三',2);assert.match(s.service.recipeRetrievalIssue(run.id)!,/当前 1 个/);
  control.finish('completed_with_limitations');assert.equal(control.snapshot().state,'blocked');control.resume();
  await record('two','方案二',4);assert.match(s.service.recipeRetrievalIssue(run.id)!,/当前 2 个/);
  await record('three','方案三',5);assert.equal(s.service.recipeRetrievalIssue(run.id),null);
  control.finish('completed_with_limitations');assert.equal(control.snapshot().state,'completed_with_limitations');
  assert.equal(acceptedRecipeProposals(s.store,run.id).length,3);
  const answer=await s.service.sourceAnswer(run.id);assert.equal((answer!.match(/### /g)??[]).length,3);assert.match(answer!,/PDF p.2/);assert.match(answer!,/未执行、未验证/);
 }finally{await s.close();}
});
