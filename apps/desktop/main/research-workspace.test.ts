import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceStore} from './store.js';
import {ResearchService} from './research-service.js';
import {sourceHash,DataSourceRouter,SourceFailure} from '../../../packages/agent/src/data-source-router.js';
import {writeResearchDelivery,assessDelivery,researchRows} from '../../../packages/agent/src/research-delivery.js';
import {TaskSupervisor} from '../../../packages/agent/src/task-supervisor.js';
import {supervisionStore} from './agent-supervision-store.js';
import {directPlan} from '../../../packages/agent/src/research-planning.js';
import type {ResearchSnapshot,MoosRef} from '../../../packages/contracts/src/research-project.js';
const ref:MoosRef={connectionId:'fixture',sourceId:1,packageImportId:2,experimentId:3,generation:1,packageSha256:'a'.repeat(64),projectionSha256:'b'.repeat(64),reviewScope:'include-unreviewed',reviewStatus:'pending_review'};
async function setup(){const dir=await mkdtemp(join(tmpdir(),'mx-ua4-')),db=join(dir,'workspace.sqlite'),store=new WorkspaceStore(db),project=store.createProject(dir),conversation=store.createConversation(project.id),run=store.addRun(project.id,'research','running'),service=new ResearchService(store,{client:null});return {dir,db,store,project,conversation,run,service,close:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};}
function snapshot(projectId:string):ResearchSnapshot {const data={observations:[{id:'obs',property:'reflectance',value:0.9,unit:'1',conditions:{temperature:'300 K'},evidence_ids:['ev']}],readEvidence:[{id:'ev',evidence_text:'reported 0.9'}]};return {id:randomUUID(),projectId,origin:'moos',title:'PVDF',ref,sha256:sourceHash(data),version:'1',retrievedAt:new Date().toISOString(),reviewStatus:'pending_review',evidence:[{sourceId:'1',generation:'1',locator:'ev',sha256:'c'.repeat(64)}],data,receipts:[]};}
function context(s:Awaited<ReturnType<typeof setup>>){return {task:{taskId:s.run.id,projectId:s.project.id,conversationId:s.conversation.id} as any,grant:{grantId:randomUUID(),projectId:s.project.id,conversationId:s.conversation.id,permissions:['read','search','patch'] as any,approvedBy:'local-user' as const,maxCredits:null,maxSeconds:600},methods:new Map<string,readonly any[]>([['engine.execute',[]],['research_data',['read','search']],['research_delivery',['read','patch']]])};}
test('RPSME input under a MOOS directory does not require an unrelated comparison delivery; explicit CSV/MOOS delivery still does',async()=>{const s=await setup();try{
 const pdf='/Users/user/Code/MOOS/papers/approved.pdf',request='@materials-literature-rpsme-json 提取 '+pdf+'，输出 RPSME JSON、中文摘要和校验报告。';
 s.service.begin(s.run.id,s.project.id,request);const plan=directPlan(request,context(s));s.store.saveResearchPlan(plan);
 assert.equal(s.service.deliveryIssue(s.run.id),null);
 const revised=structuredClone(plan);revised.planRevision=2;revised.originalRequest+=' 同时比较选定 MOOS 数据，导出 CSV 和 SVG。';s.store.saveResearchPlan(revised);
 assert.match(s.service.deliveryIssue(s.run.id)!,/尚未生成/);
 }finally{await s.close();}});
test('research state survives restart, scoped snapshots and frozen contracts reject replacement',async()=>{const s=await setup();try{
 const a=s.store.research.saveSnapshot(snapshot(s.project.id)),p=s.store.research.project(s.project.id);s.service.save({...p,revision:2,selected:[a.id],materialSystem:'PVDF',conditions:['300 K']},1);
 const b=s.service.begin(s.run.id,s.project.id,'比较 PVDF'),other=s.store.createProject(join(s.dir,'other'));
 assert.throws(()=>s.store.research.snapshot(other.id,a.id),/another project/);assert.throws(()=>s.store.research.saveBinding({...b,delivery:{...b.delivery,requireEvidence:false}}),/frozen/);
 assert.throws(()=>s.store.research.saveProject({...p,revision:2},1),/revision/);
 s.store.close();const restored=new WorkspaceStore(s.db);assert.equal(restored.research.project(s.project.id).materialSystem,'PVDF');assert.equal(restored.research.binding(s.run.id)?.approvedInputs[1]?.sha256,a.sha256);restored.close();
 }finally{await s.close().catch(()=>rm(s.dir,{recursive:true,force:true}));}});
test('router prioritizes project inputs, distinguishes no match, denial, stale and unavailable',async()=>{const s=await setup();try{
 const a=s.store.research.saveSnapshot({...snapshot(s.project.id),origin:'project',ref:null}),p=s.store.research.project(s.project.id);s.service.save({...p,revision:2,selected:[a.id]},1);
 const result=await s.service.router.search(s.project.id,null,{query:'PVDF',reviewScope:'include-unreviewed'});assert.equal(result.origin,'project');
 await assert.rejects(s.service.router.search(s.project.id,null,{query:'missing',reviewScope:'verified'}),e=>e instanceof SourceFailure&&e.outcome==='unavailable');
 for(const [code,outcome]of [['unauthorized','denied'],['stale_version','stale']]){
 const router=new DataSourceRouter(s.store.research,{call:async()=>({isError:true,content:[{type:'text',text:JSON.stringify({error:{code}})}]}) as any,readResource:async()=>({contents:[]})});
 await assert.rejects(router.moos(s.project.id,null,'moos_status',{}),e=>e instanceof SourceFailure&&e.outcome===outcome);}
 assert(s.service.overview(s.project.id).receipts.some(r=>r.outcome==='no_match'));assert(s.service.overview(s.project.id).receipts.some(r=>r.outcome==='stale'));
 }finally{await s.close();}});
test('acceptance uses frozen units, evidence, conditions and tolerances; genuine artifacts are hashed and tampering rejected',async()=>{const s=await setup();try{
 const a=s.store.research.saveSnapshot(snapshot(s.project.id)),p=s.store.research.project(s.project.id);s.service.save({...p,revision:2,selected:[a.id]},1);
 const b=s.service.begin(s.run.id,s.project.id,'compare'),result={assessments:[{state:'not_comparable'}]},rows=researchRows([a],'comparison',result);
 assert.equal(assessDelivery(b,[a],rows,result).status,'accepted-with-limitations');
 const strict={...b,delivery:{...b.delivery,requireReviewed:true,checks:[{property:'reflectance',unit:'%',condition:JSON.stringify({temperature:'300 K'}),expected:90,tolerance:1}]}};
 assert.equal(assessDelivery(strict,[a],rows,result).status,'blocked');
 const equivalent={...b,delivery:{...b.delivery,checks:[{property:'reflectance',unit:'1',condition:'{ \"temperature\" : \"300 K\" }',expected:0.9,tolerance:0}]}};assert.equal(assessDelivery(equivalent,[a],rows,result).status,'accepted-with-limitations');
 assert.equal(assessDelivery(b,[{...a,evidence:[]}],rows,result).status,'blocked');
 const d=await writeResearchDelivery(s.dir,b,1,[a],result);s.store.research.delivery(d);assert.equal(d.artifacts.length,3);assert((await s.service.preview(s.project.id,d.id,'report')).includes('needs')||d.scientificStatus==='needs_review');
 await writeFile(join(s.dir,d.artifacts[0]!.path),'changed');await assert.rejects(s.service.preview(s.project.id,d.id,'table'),/CHANGED/);
 const next=s.store.research.project(s.project.id);s.service.save({...next,revision:3,selected:[],withdrawn:[a.id]},2);assert.equal(s.service.overview(s.project.id).deliveries[0]?.status,'stale');
 }finally{await s.close();}});
test('source snapshot hash mismatch, required image absence and symlink output are not accepted',async()=>{const s=await setup();try{
 const a=snapshot(s.project.id);await assert.rejects(s.service.router.verify({...a,origin:'project',ref:null,sha256:'d'.repeat(64)},null),/changed/);
 s.store.research.saveSnapshot(a);const b=s.service.begin(s.run.id,s.project.id,'show');
 const required={...b,delivery:{...b.delivery,required:['table','image'] as any,optional:[]}};const d=await writeResearchDelivery(s.dir,required,1,[a],{assessments:[{state:'comparable'}]});assert.equal(d.status,'blocked');assert(d.checks.some(c=>c.id==='artifact:image'&&c.status==='missing'));
 const outside=join(s.dir,'outside');await mkdir(outside);const root=join(s.dir,'symlink-project');await mkdir(root);await symlink(outside,join(root,'materials-output'));
 await assert.rejects(writeResearchDelivery(root,b,1,[a],{}),/SYMLINK/);
 }finally{await s.close();}});
test('paused plan edits reuse supervisor, preserve budgets and completed independent step; current criteria cannot be relaxed by engine',async()=>{const s=await setup();try{
 const c=context(s),ctl=new TaskSupervisor({context:c,engine:'pi',connectionId:'fixture',accountRef:'local',projectPath:s.dir,...supervisionStore(s.store,s.run.id)}),p=directPlan('显示输入',c);
 p.executionMode='planned';p.adjustmentRules=[];p.steps=[{...p.steps[0]!,id:'read' as any,inputRefs:[c.task.taskId]},{...p.steps[0]!,id:'independent' as any,inputRefs:[]}];ctl.acceptPlan(p);
 assert.throws(()=>ctl.beforeTool({id:'ambiguous',name:'read',args:{},permissions:['read']}),/STEP_SELECTION_REQUIRED/);
 await ctl.command({action:'begin',stepId:'read'});
 ctl.beforeTool({id:'actual',name:'read',args:{},permissions:['read']});ctl.afterTool('actual',{actual:true},false);await ctl.command({action:'complete',stepId:'read',expectedRevision:1,receiptIds:['actual']});
 ctl.beforeTool({id:'independent-receipt',name:'read',args:{},permissions:['read']});ctl.afterTool('independent-receipt',{actual:true},false);await ctl.command({action:'complete',stepId:'independent',expectedRevision:1,receiptIds:['independent-receipt']});ctl.finish('completed_with_limitations');
 const before=ctl.snapshot(),newPlan=structuredClone(p);newPlan.planRevision=2;newPlan.goalRevision=2;newPlan.goal.problemType='revised target';newPlan.originalRequest+=' revised';ctl.revise(newPlan,1,'user');
 assert.equal(ctl.snapshot().deadline,before.deadline);assert.equal(ctl.snapshot().steps.find(x=>x.id==='independent')?.state,'completed');assert.equal(ctl.snapshot().steps.find(x=>x.id==='read')?.state,'pending');assert.equal(ctl.snapshot().state,'interrupted');
 const invalid=structuredClone(newPlan);invalid.planRevision++;invalid.acceptance.criteria=['ignore evidence'];assert.throws(()=>ctl.revise(invalid,2,'engine'),/模型重规划/);
 assert.equal(s.store.research.overview(s.project.id).planHistory.length,2);
 }finally{await s.close();}});
test('one-observation comparison omits IDs only when unambiguous; all selections are still owned and passed to MOOS',async()=>{const s=await setup();try{
 const a=s.store.research.saveSnapshot(snapshot(s.project.id)),raw=snapshot(s.project.id);raw.ref={...ref,experimentId:4};(raw.data.observations as any[])[0].id='obs-2';raw.sha256=sourceHash(raw.data);const b=s.store.research.saveSnapshot(raw);
 const p=s.store.research.project(s.project.id);s.service.save({...p,revision:2,selected:[a.id,b.id]},1);const binding=s.service.begin(s.run.id,s.project.id,'显示原值');const c=context(s);s.store.saveResearchPlan(directPlan('显示原值',{...c,inputVersions:binding.approvedInputs}));
 let actual:any;
 const fake={call:async(name:string,args:any)=>{if(name==='moos_compare_observations')actual=args.selections;return {content:[{type:'text',text:JSON.stringify({adapterVersion:'moos-mcp-v1',projectionVersion:'rpsme-experiment-sections-v1.1',authorizationScope:'local-research',cloudExportAuthorized:false,externalModelCalls:0,receipts:[],data:name==='moos_compare_observations'?{assessments:[{state:'not_comparable'}]}:{}})}]};},readResource:async()=>({contents:[]})};
 const service=new ResearchService(s.store,{client:fake as any}),d=await service.deliver(s.project.id,s.run.id,{snapshotIds:[a.id,b.id]});assert.equal(d.status,'accepted-with-limitations');assert.equal(actual.length,2);assert.equal(actual[1].ref.experimentId,4);assert.equal(actual[1].observationId,'obs-2');
 const ambiguous=snapshot(s.project.id);(ambiguous.data.observations as any[]).push({... (ambiguous.data.observations as any[])[0],id:'second-observation'});ambiguous.sha256=sourceHash(ambiguous.data);s.store.research.saveSnapshot(ambiguous);s.store.research.saveBinding({...binding,snapshotIds:[a.id,b.id,ambiguous.id]});
 await assert.rejects(service.deliver(s.project.id,s.run.id,{snapshotIds:[a.id,ambiguous.id]}),/REQUIRES_OBSERVATION_IDS/);
 }finally{await s.close();}});
test('paused source update and plan revision commit together, stale writes preserve original binding',async()=>{const s=await setup();try{
 const a=s.store.research.saveSnapshot(snapshot(s.project.id)),p=s.store.research.project(s.project.id);s.service.save({...p,revision:2,selected:[a.id]},1);
 const binding=s.service.begin(s.run.id,s.project.id,'显示数据'),c={...context(s),inputVersions:binding.approvedInputs};
 const ctl=new TaskSupervisor({context:c,engine:'pi',connectionId:'fixture',accountRef:'local',projectPath:s.dir,...supervisionStore(s.store,s.run.id)}),plan=directPlan('显示数据',c);plan.steps[0]!.inputRefs=[a.id];ctl.acceptPlan(plan);ctl.finish('failed');
 const b=snapshot(s.project.id);b.ref={...ref,generation:2};b.version='2';s.store.research.saveSnapshot(b);const latest=s.store.research.project(s.project.id);s.service.save({...latest,revision:3,selected:[b.id],withdrawn:[a.id]},2);
 const revised=structuredClone(plan);revised.planRevision=2;revised.inputVersionRefs=s.service.revisionBinding(s.run.id).approvedInputs;revised.steps[0]!.inputRefs=[b.id];revised.revisionReason='User selected new source version';
 const {DesktopAgentRuntime}=await import('./agent-runtime.js');const runtime=new DesktopAgentRuntime(s.store,{toolCapabilities:()=>c.methods} as any,{} as any,s.dir,{},undefined,s.service);
 assert.throws(()=>runtime.revise(s.run.id,99,revised),/版本/);assert.deepEqual(s.store.research.binding(s.run.id)!.approvedInputs,binding.approvedInputs);
 runtime.revise(s.run.id,1,revised);assert.deepEqual(s.store.research.binding(s.run.id)!.approvedInputs,revised.inputVersionRefs);assert.equal(s.store.agentJournal.read(s.run.id)!.planRevision,2);assert.equal(s.store.agentJournal.read(s.run.id)!.deadline,ctl.snapshot().deadline);
 }finally{await s.close();}});
test('upstream stale receipt invalidates registered delivery; general text cannot satisfy a requested research delivery',async()=>{const s=await setup();try{
 const a=s.store.research.saveSnapshot(snapshot(s.project.id)),p=s.store.research.project(s.project.id);s.service.save({...p,revision:2,selected:[a.id]},1);const binding=s.service.begin(s.run.id,s.project.id,'@materials-research-workbench 显示表格'),c=context(s);s.store.saveResearchPlan(directPlan('@materials-research-workbench 显示表格',{...c,inputVersions:binding.approvedInputs}));
 assert.match(s.service.deliveryIssue(s.run.id)!,/尚未生成/);
 const d=await writeResearchDelivery(s.dir,binding,1,[a],{assessments:[{state:'comparable'}]});s.store.research.delivery(d);assert.equal(s.service.deliveryIssue(s.run.id),null);
 s.store.research.receipt({id:randomUUID(),projectId:s.project.id,taskId:null,tool:'moos_get_experiment',args:{ref:a.ref},origin:'moos',outcome:'stale',sha256:null,at:new Date().toISOString(),detail:'Source generation changed'});
 assert.equal(s.service.deliveries(s.project.id)[0]?.status,'stale');assert.match(s.service.deliveryIssue(s.run.id)!,/失效/);
 }finally{await s.close();}});

test('CSV preserves signed scientific numbers, escapes formula strings and chart declares its row limit',async()=>{const s=await setup();try{
 const a=snapshot(s.project.id);a.data.observations=Array.from({length:41},(_,i)=>({id:'obs-'+i,property:'=unsafe spreadsheet formula',value:-0.9,unit:'1',conditions:{temperature:'300 K'},evidence_ids:['ev']}));a.sha256=sourceHash(a.data);s.store.research.saveSnapshot(a);
 const b=s.service.begin(s.run.id,s.project.id,'显示原始数据'),d=await writeResearchDelivery(s.dir,b,1,[a],{assessments:[{state:'comparable'}]});s.store.research.delivery(d);
 const csv=await s.service.preview(s.project.id,d.id,'table');assert(csv.includes('"-0.9"'));assert(!csv.includes('"\'-0.9"'));assert(csv.includes('"\'=unsafe spreadsheet formula"'));
 const svg=await s.service.preview(s.project.id,d.id,'chart');assert(svg.includes('40/41'));assert.equal((svg.match(/<rect x="20"/g)||[]).length,40);
 }finally{await s.close();}});
test('MOOS short candidate selection uses the searched version and retains pending review opt-in',async()=>{const s=await setup();try{
 const request='搜索水性涂料，允许本次读取待复核记录';s.service.begin(s.run.id,s.project.id,request);s.store.saveResearchPlan(directPlan(request,context(s)));
 const calls:Array<{name:string;args:any}>=[],fake={close:async()=>{},call:async(name:string,args:any)=>{
  calls.push({name,args});const data=name==='moos_search'?{items:[{ref,title:'WCP',reviewStatus:'pending_review'}],outcome:'matched',nextCursor:null}:{ref,data:{recipes:[{id:'recipe'}],ingredients:[{id:'ingredient',amount:{original_value:10,original_unit:'g'}}],evidence:[]},identity:{label:'WCP'},nextCursor:null};
  return {content:[{type:'text',text:JSON.stringify({adapterVersion:'moos-mcp-v1',projectionVersion:'rpsme-experiment-sections-v1.1',authorizationScope:'local-research',cloudExportAuthorized:false,externalModelCalls:0,receipts:[],retrievedAt:new Date().toISOString(),data})}]};},readResource:async()=>({contents:[]})};
 const service=new ResearchService(s.store,{client:fake as any});
 const result=await service.data(s.project.id,s.run.id,{action:'search',query:'水性',reviewScope:'include-unreviewed'}) as any;
 assert.equal(result.items[0].ref,undefined);assert.match(result.items[0].candidateId,/^moos-[a-f0-9]{24}$/);
 const selected=await service.data(s.project.id,s.run.id,{action:'select',candidateId:result.items[0].candidateId}) as any;
 assert.equal(selected.reviewStatus,'pending_review');assert.deepEqual(calls.find(c=>c.name==='moos_get_experiment')?.args.ref,ref);
 assert.equal(s.store.research.snapshot(s.project.id,selected.snapshotId).data.ingredients instanceof Array,true);
 await assert.rejects(service.data(s.project.id,s.run.id,{action:'select',candidateId:'moos-'+'0'.repeat(24)}),/NOT_IN_TASK/);
 await service.close();
 }finally{await s.close();}});
