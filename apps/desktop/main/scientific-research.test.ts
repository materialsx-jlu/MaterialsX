import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceStore} from './store.js';
import {ResearchService} from './research-service.js';
import {scientificFixture} from '../../../tests/fixtures/agent/ua7-source.js';
import {directPlan} from '../../../packages/agent/src/research-planning.js';
import {TaskSupervisor} from '../../../packages/agent/src/task-supervisor.js';
import {supervisionStore} from './agent-supervision-store.js';
import {writeScientificArtifacts} from '../../../packages/agent/src/scientific-artifacts.js';
async function setup(){
  const path=await mkdtemp(join(tmpdir(),'mx-ua7-')),db=join(path,'state.sqlite'),store=new WorkspaceStore(db);
  const project=store.createProject(path),service=new ResearchService(store,{client:null});
  const sources=Array.from({length:7},(_,i)=>store.research.saveSnapshot(scientificFixture(project.id,i)));
  const p=store.research.project(project.id);service.save({...p,revision:2,selected:sources.map(s=>s.id)},1);
  return {path,db,store,project,service,sources,close:async()=>{try{store.close();}catch(e){if((e as any).code!=='ERR_INVALID_STATE')throw e;}await rm(path,{recursive:true,force:true});}};
}
test('fixed methods write real hashed artifacts, persist across restart and reject cross-project/mutated inputs',async()=>{
  const s=await setup();try{
    const a=await s.service.scientific.assess(s.project.id,null,{question:'fixed source fit',task:'fit',samples:s.sources.map((v,i)=>({id:'s'+i,x:{snapshotId:v.id,observationId:'x'},y:{snapshotId:v.id,observationId:'y'}}))});
    const result=await s.service.scientific.run(s.project.id,null,{assessmentId:a.id,methodId:'linear-fit',reason:'Same original units and synthetic condition; explore linear relation'});
    assert.equal(result.result.slope,2);assert.equal(result.result.intercept,3);assert.equal(result.productionApproved,false);assert.equal(result.scientificStatus,'needs_review');
    assert((await s.service.scientific.preview(s.project.id,result.id,result.artifacts[1]!.path)).includes('needs_review'));
    const other=s.store.createProject(join(s.path,'other'));
    await assert.rejects(s.service.scientific.run(other.id,null,{assessmentId:a.id,methodId:'linear-fit',reason:'Cannot cross projects'}),/NOT_OWNED/);
    const audit=await s.service.scientific.audit(s.project.id,null,{snapshotIds:[s.sources[0]!.id]});assert.equal(audit.decision,'usable-with-limitations');
    s.store.close();const restored=new WorkspaceStore(s.db),research=new ResearchService(restored,{client:null});
    assert.equal(research.scientific.overview(s.project.id).analyses[0]?.result.slope,2);restored.close();
    await writeFile(join(s.path,result.artifacts[0]!.path),'tampered');
    const reopened=new WorkspaceStore(s.db);try{
      await assert.rejects(new ResearchService(reopened,{client:null}).scientific.preview(s.project.id,result.id,result.artifacts[0]!.path),/CHANGED/);
    }finally{reopened.close();}
  }finally{await s.close();}
});
test('source change propagates transitively, preserves independent steps/history and never automatically reruns',async()=>{
  const s=await setup();try{
    const c=s.store.createConversation(s.project.id),run=s.store.addRun(s.project.id,'fixture','running');
    s.service.begin(run.id,s.project.id,'compare sources');
    const plan=directPlan('compare sources',{task:{projectId:s.project.id,conversationId:c.id,taskId:run.id} as any,
      grant:{grantId:randomUUID(),projectId:s.project.id,conversationId:c.id,permissions:['read','science','patch'],approvedBy:'local-user',maxCredits:null,maxSeconds:120} as any,
      methods:new Map([['engine.execute',[]]])});
    plan.executionMode='planned';
    plan.steps=[{...plan.steps[0]!,id:'read' as any,inputRefs:[s.sources[0]!.id]},
      {...plan.steps[0]!,id:'fit' as any,inputRefs:[],dependsOn:['read' as any]},
      {...plan.steps[0]!,id:'independent' as any,inputRefs:[s.sources[6]!.id]}];s.store.saveResearchPlan(plan);
    const a=await s.service.scientific.assess(s.project.id,null,{question:'summary',task:'summarize',samples:[{id:'s',y:{snapshotId:s.sources[0]!.id,observationId:'y'}}]});
    const result=await s.service.scientific.run(s.project.id,null,{assessmentId:a.id,methodId:'descriptive-summary',reason:'Read original value'});
    s.service.scientific.notice(s.project.id,{snapshotId:s.sources[0]!.id,kind:'corrected',replacementSnapshotId:s.sources[1]!.id,reason:'Synthetic source correction for test'});
    const overview=s.service.scientific.overview(s.project.id);
    assert.deepEqual(overview.impact.tasks[0]?.stepIds,['read','fit']);assert.equal(overview.analyses[0]?.status,'stale');
    assert.equal(s.store.research.methodAnalyses(s.project.id)[0]?.status,'completed');
    assert.equal(s.store.researchPlan(run.id)!.planRevision,1);assert.equal(s.store.research.methodAnalyses(s.project.id).length,1);
    await assert.rejects(s.service.scientific.run(s.project.id,null,{assessmentId:a.id,methodId:'descriptive-summary',reason:'Stale cannot rerun'}),/STALE/);
    assert.match(s.service.deliveryIssue(run.id)!,/来源/);
    s.service.scientific.notice(s.project.id,{snapshotId:s.sources[0]!.id,kind:'access-denied',replacementSnapshotId:null,reason:'Synthetic revocation'});
    assert.deepEqual(s.service.overview(s.project.id).snapshots.find(v=>v.id===s.sources[0]!.id)!.data,{accessDenied:true});
    assert.equal(s.service.scientific.overview(s.project.id).analyses[0]!.artifacts.length,0);
    await assert.rejects(s.service.scientific.preview(s.project.id,result.id,result.artifacts[0]!.path),/NOT_OWNED/);
  }finally{await s.close();}
});
test('local import hashes its real evidence rows, and output writer refuses symlink directories',async()=>{
  const s=await setup();try{
    const source=s.sources[0]!,file=join(s.path,'input.json');await writeFile(file,JSON.stringify({title:'Synthetic imported data',data:source.data}));
    const imported=await s.service.import(s.project.id,file);assert.equal(imported.reviewStatus,'unreviewed');assert.equal(imported.evidence.length,1);
    assert.equal(imported.evidence[0]!.locator,'ev');assert(imported.evidence[0]!.sha256.length===64);
    const root=join(s.path,'unsafe'),outside=join(s.path,'outside');await mkdir(root);await mkdir(outside);await symlink(outside,join(root,'materials-output'));
    await assert.rejects(writeScientificArtifacts(root,randomUUID(),{test:true},'report'),/SYMLINK/);
    assert((await readFile(file,'utf8')).includes('Synthetic'));
  }finally{await s.close();}
});
test('method registry delegates structural qualification to M6 without elevating a custom script',async()=>{
  const s=await setup();try{
    let actual:any;s.service.scientific.atomistic={assess:async input=>{actual=input;return {id:'existing-m6-assessment',selection:{candidates:[],exclusions:[{potentialId:'unknown',reasonCodes:['VERIFIED_RUNTIME_UNAVAILABLE']}]}} as any;}};
    const a=await s.service.scientific.assess(s.project.id,null,{question:'inspect structure',task:'atomistic',atomic:{structureId:'owned-structure',domain:'inorganic-crystals',task:'singlepoint',mode:'exploratory'}});
    assert.equal(actual.projectId,s.project.id);assert.equal(actual.structureId,'owned-structure');assert(!a.candidates.length);
    assert(a.exclusions.some(e=>e.reasons.includes('NO_M6_ELIGIBLE_POTENTIAL')));
    await assert.rejects(s.service.scientific.run(s.project.id,null,{assessmentId:a.id,methodId:'atomistic-screening',reason:'Excluded'}),/EXCLUDED/);
    await assert.rejects(s.service.scientific.assess(s.project.id,null,{question:'custom script',task:'python-script',code:'print(1)'}));
  }finally{await s.close();}
});

test('numeric JSON/report delivery satisfies its own task, while explicit CSV/SVG and stale sources remain gated',async()=>{
  const s=await setup();try{
    const c=s.store.createConversation(s.project.id),run=s.store.addRun(s.project.id,'numeric fixture','running');
    s.service.begin(run.id,s.project.id,'显示平均数并生成报告');
    const context={task:{projectId:s.project.id,conversationId:c.id,taskId:run.id},grant:{grantId:randomUUID(),projectId:s.project.id,conversationId:c.id,permissions:['read','science','patch'],approvedBy:'local-user',maxCredits:null,maxSeconds:120},methods:new Map([['engine.execute',[]]])} as any;
    s.store.saveResearchPlan(directPlan('显示平均数并生成 JSON 和报告',context));
    assert.match(s.service.deliveryIssue(run.id)!,/尚未生成/);
    const a=await s.service.scientific.assess(s.project.id,run.id,{question:'synthetic mean',task:'summarize',samples:s.sources.slice(0,3).map((v,i)=>({id:'s'+i,y:{snapshotId:v.id,observationId:'y'}}))});
    await s.service.scientific.run(s.project.id,run.id,{assessmentId:a.id,methodId:'descriptive-summary',reason:'Original observations only'});
    await s.service.scientific.verifyTaskArtifacts(run.id);assert.equal(s.service.deliveryIssue(run.id),null);
    assert.match(s.service.deliveryText(run.id),/实际计算结果/);assert.match(s.service.deliveryText(run.id),/均值 \| 5 \| MPa/);
    const first=s.store.researchPlan(run.id)!;
    s.store.saveResearchPlan({...first,goalRevision:2,planRevision:2,originalRequest:'显示平均数并生成 CSV 和 SVG 报告'});
    assert.match(s.service.deliveryIssue(run.id)!,/尚未生成/);
    s.store.saveResearchPlan({...first,goalRevision:3,planRevision:3});
    s.service.scientific.notice(s.project.id,{snapshotId:s.sources[0]!.id,kind:'retracted',replacementSnapshotId:null,reason:'Synthetic withdrawal'});
    assert.match(s.service.deliveryIssue(run.id)!,/来源/);
  }finally{await s.close();}
});

test('planned analysis artifact roles require same-step backend receipts and unchanged actual files',async()=>{
  const s=await setup();try{
    const c=s.store.createConversation(s.project.id),run=s.store.addRun(s.project.id,'artifact fixture','running');
    const context={task:{projectId:s.project.id,conversationId:c.id,taskId:run.id},grant:{grantId:randomUUID(),projectId:s.project.id,conversationId:c.id,permissions:['read','science','patch'],approvedBy:'local-user',maxCredits:null,maxSeconds:120},methods:new Map([['engine.execute',[]]])} as any;
    s.service.begin(run.id,s.project.id,'显示平均数并生成报告');
    const control=new TaskSupervisor({context,engine:'pi',connectionId:'fixture',accountRef:'local',projectPath:s.path,...supervisionStore(s.store,run.id),resolveArtifact:(step,name)=>s.service.scientific.resolveTaskArtifact(run.id,step,name)});
    context.methods.set('research_method_run',['read','patch','science']);
    const plan=directPlan('显示平均数并生成 JSON 和报告',context);plan.executionMode='planned';plan.steps[0]!.method='research_method_run';plan.steps[0]!.expectedArtifacts=['JSON','报告'];control.acceptPlan(plan);
    const a=await s.service.scientific.assess(s.project.id,run.id,{question:'synthetic mean',task:'summarize',samples:s.sources.slice(0,3).map((v,i)=>({id:'s'+i,y:{snapshotId:v.id,observationId:'y'}}))});
    const args={assessmentId:a.id,methodId:'descriptive-summary',reason:'Original observations only'};
    const analysis=await s.service.scientific.run(s.project.id,run.id,args);
    assert.equal(await s.service.scientific.resolveTaskArtifact(run.id,'execute','JSON'),null);
    control.beforeTool({id:'actual-analysis',name:'research_method_run',args,permissions:['read','patch','science']});
    control.afterTool('actual-analysis',{content:[{type:'text',text:JSON.stringify(analysis)}]},false);
    assert.equal(await s.service.scientific.resolveTaskArtifact(run.id,'other-step','JSON'),null);
    assert.equal(await s.service.scientific.resolveTaskArtifact(run.id,'execute','invented.json'),null);
    assert.equal(await s.service.scientific.resolveTaskArtifact(run.id,'execute','JSON'),join(s.path,analysis.artifacts[0]!.path));
    const original=await readFile(join(s.path,analysis.artifacts[0]!.path));
    await writeFile(join(s.path,analysis.artifacts[0]!.path),'tampered before verification');
    await assert.rejects(control.verifyBackendSteps(),/CHANGED/);assert.notEqual(control.snapshot().steps[0]?.state,'completed');
    await writeFile(join(s.path,analysis.artifacts[0]!.path),original);
    assert.deepEqual(await control.verifyBackendSteps(),['execute']);
    assert.equal(control.snapshot().steps[0]?.state,'completed');
    await writeFile(join(s.path,analysis.artifacts[0]!.path),'tampered');
    await assert.rejects(s.service.scientific.resolveTaskArtifact(run.id,'execute','JSON'),/CHANGED/);
  }finally{await s.close();}
});
