import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {WorkspaceStore} from './store.js';
import {ResearchService} from './research-service.js';
import {studyFixture,designFixture} from '../../../tests/fixtures/agent/ua9-study.js';
import {tensileFixture,fixtureCsv} from '../../../tests/fixtures/agent/ua8-tensile.js';
import {latinHypercube} from '../../../experiments/next-design.mjs';
import {PiLocalSessionService} from '../../../packages/pi-adapter/src/local-session.js';
import {HostMcp} from '../../../packages/agent/src/host-mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {TaskSupervisor} from '../../../packages/agent/src/task-supervisor.js';
import {supervisionStore} from './agent-supervision-store.js';
import {directPlan} from '../../../packages/agent/src/research-planning.js';
import {methodArtifactRoles} from '../../../packages/agent/src/research-artifact-roles.js';
const exec=promisify(execFile);
async function setup(){const temp=await mkdtemp(join(tmpdir(),'ua9-')),store=new WorkspaceStore(join(temp,'db.sqlite')),p=store.createProject(temp),service=new ResearchService(store,{client:null});return {temp,store,p,service,close:async()=>{store.close();await rm(temp,{recursive:true,force:true});}};}
test('source-linked feedback updates the same project, corrections preserve history, qualified next design and replay are real files',async()=>{
  const s=await setup();try{
    const fixture=studyFixture(),q={...designFixture(),method:'latin-hypercube' as const,points:24},coordinates=latinHypercube(fixture,24,q.seed);
    const path=join(s.temp,'synthetic.json');await writeFile(path,JSON.stringify({title:'Synthetic validation, not real measurements',data:{readEvidence:[{id:'synthetic-evidence',text:'Synthetic engineering validation only'}],observations:coordinates.map((f,i)=>({id:'obs-'+i,property:fixture.response.property,unit:'MPa',value:100+20*Math.sin(3*f.temperature!),conditions:fixture.measurementConditions,factors:f}))}}));
    const source=await s.service.import(s.p.id,path),study=s.service.nextExperiments.saveStudy(s.p.id,{...fixture,expectedProjectRevision:2,snapshotIds:[source.id]});
    const initial=await s.service.nextExperiments.design(s.p.id,null,{...q,studyId:study.id});assert.equal(initial.result.status,'planned');assert.equal(initial.artifacts.length,10);
    const denied=await s.service.nextExperiments.design(s.p.id,null,{...q,studyId:study.id,method:'bayesian'});assert.equal(denied.result.status,'blocked');
    for(let i=0;i<24;i++){const point=coordinates[i]!,row=initial.result.schedule.find(r=>r.factors.temperature===point.temperature)!;await s.service.nextExperiments.feedback(s.p.id,{expectedProjectRevision:s.store.research.project(s.p.id).revision,designId:initial.id,plannedRunId:row.id,outcome:'measured',actualFactors:point,reviewed:true,notes:'Synthetic explicit data review, not scientific qualification',supersedes:null,source:{kind:'reported',snapshotId:source.id,observationId:'obs-'+i}});}
    assert.equal(s.store.research.project(s.p.id).revision,27);assert.equal(s.store.research.feedback(s.p.id).length,24);
    const before=s.service.nextExperiments.overview(s.p.id);assert(before.designs.every(d=>d.historical));
    const optimized=await s.service.nextExperiments.design(s.p.id,null,{...q,studyId:study.id,method:'bayesian',points:4});assert.equal(optimized.result.status,'planned');assert.equal(optimized.result.optimization.enabled,true);
    const folder=dirname(join(s.temp,optimized.artifacts[0]!.path));await exec(process.execPath,[join(folder,'replay.mjs')]);assert.deepEqual(JSON.parse(await readFile(join(folder,'replay-result.json'),'utf8')),optimized.result);
    const first=before.feedback[0]!,revision=s.store.research.project(s.p.id).revision;
    await assert.rejects(s.service.nextExperiments.feedback(s.p.id,{...first.input,expectedProjectRevision:revision,supersedes:null}),/CORRECTION|SOURCE_ALREADY/);assert.equal(s.store.research.project(s.p.id).revision,revision);
    const corrected=await s.service.nextExperiments.feedback(s.p.id,{...first.input,expectedProjectRevision:revision,supersedes:first.id,reviewed:false,notes:'Synthetic correction: withdraw human review'});assert.equal(corrected.input.supersedes,first.id);assert.equal(s.store.research.feedback(s.p.id).length,25);assert.equal(s.service.nextExperiments.overview(s.p.id).designs.find(d=>d.id===optimized.id)!.historical,true);
    await writeFile(join(folder,'input.json'),'{}');await assert.rejects(exec(process.execPath,[join(folder,'replay.mjs')]),/REPLAY_INPUT_CHANGED/);
    s.service.scientific.notice(s.p.id,{snapshotId:source.id,kind:'access-denied',reason:'Synthetic revocation',replacementSnapshotId:null});const revoked=s.service.nextExperiments.overview(s.p.id);assert.equal(revoked.feedback.length,0);assert.equal(revoked.designs.length,0);assert.equal(revoked.study,null);
    await assert.rejects(s.service.nextExperiments.design(s.p.id,null,{...q,studyId:study.id}),/STALE|REVOKED/);
  }finally{await s.close();}
});
test('real UA8 measured curves supply feedback; source reuse, invalid values, deviations, stale revisions and cross-project IDs cannot become data',async()=>{
  const s=await setup();try{
    const f=tensileFixture(),path=join(s.temp,'curve.csv');await writeFile(path,fixtureCsv(f.table));const ds=await s.service.experiments.importFile(s.p.id,path),c=await s.service.experiments.configure(s.p.id,{...f.config,datasetId:ds.id}),run=await s.service.experiments.run(s.p.id,null,{configurationIds:[c.id],independentReplicates:false,reason:'Synthetic actual-file calculation'});
    const study=s.service.nextExperiments.saveStudy(s.p.id,{...studyFixture(),expectedProjectRevision:s.store.research.project(s.p.id).revision,response:{metric:'fitSlopeMPa',property:'fitted_slope',unit:'MPa',direction:'maximize',target:null},measurementConditions:f.config.conditions});
    const d=await s.service.nextExperiments.design(s.p.id,null,{...designFixture(),studyId:study.id}),row=d.result.schedule.find(r=>r.role==='treatment')!;
    const q={expectedProjectRevision:s.store.research.project(s.p.id).revision,designId:d.id,plannedRunId:row.id,outcome:'measured',actualFactors:row.factors,reviewed:true,notes:'Synthetic source linkage only',supersedes:null,source:{kind:'ua8',runId:run.id,specimenId:f.config.specimenId}};
    await assert.rejects(s.service.nextExperiments.feedback(s.p.id,{...q,value:999}),/Unrecognized/);
    const feedback=await s.service.nextExperiments.feedback(s.p.id,q);assert(Math.abs(feedback.value!-1000)<1e-7);
    const repeated=d.result.schedule.find(r=>r.role==='treatment'&&r.id!==row.id)!;await assert.rejects(s.service.nextExperiments.feedback(s.p.id,{...q,expectedProjectRevision:q.expectedProjectRevision+1,plannedRunId:repeated.id}),/SOURCE_ALREADY/);
    const revision=s.store.research.project(s.p.id).revision;await assert.rejects(s.service.nextExperiments.feedback(s.p.id,{...q,expectedProjectRevision:1,supersedes:feedback.id}),/revision conflict/);assert.equal(s.store.research.project(s.p.id).revision,revision);assert.equal(s.store.research.feedback(s.p.id).length,1);
    await assert.rejects(s.service.nextExperiments.feedback(s.p.id,{...q,expectedProjectRevision:revision,supersedes:feedback.id,actualFactors:{temperature:.5}}),/DEVIATED/);
    const failed=await s.service.nextExperiments.feedback(s.p.id,{...q,expectedProjectRevision:revision,supersedes:feedback.id,outcome:'failed',source:null,reviewed:false,notes:'Synthetic fixture test failure'});assert.equal(failed.value,null);
    const other=s.store.createProject(join(s.temp,'other'));await assert.rejects(s.service.nextExperiments.design(other.id,null,{...designFixture(),studyId:study.id}),/NOT_OWNED/);await assert.rejects(s.service.nextExperiments.preview(other.id,d.id,d.artifacts[0]!.path),/NOT_OWNED/);
    const cancelled=new AbortController();cancelled.abort();await assert.rejects(s.service.nextExperiments.design(s.p.id,null,{...designFixture(),studyId:study.id},cancelled.signal));
    const history=s.store.research.studies(s.p.id).length;assert.throws(()=>s.service.nextExperiments.saveStudy(s.p.id,{...study.input,expectedProjectRevision:1}),/revision conflict/);assert.equal(s.store.research.studies(s.p.id).length,history);
    const oldProject=s.store.research.project(s.p.id);s.service.save({...oldProject,revision:oldProject.revision+1,materialSystem:'Different synthetic material'},oldProject.revision);assert(s.service.nextExperiments.overview(s.p.id).designs.every(d=>d.historical));await assert.rejects(s.service.nextExperiments.design(s.p.id,null,{...designFixture(),studyId:study.id}),/MATERIAL_CHANGED/);
  }finally{await s.close();}
});
test('Pi tools and real host MCP reuse study hashes, grants, fixed backend receipts and actual artifact completion',async()=>{
  const s=await setup(),client=new Client({name:'ua9-test',version:'1'});let mcp:HostMcp|undefined,pi:PiLocalSessionService|undefined;
  try{
    const study=s.service.nextExperiments.saveStudy(s.p.id,studyFixture()),conversation=s.store.createConversation(s.p.id),run=s.store.addRun(s.p.id,'UA9 synthetic','running');s.service.begin(run.id,s.p.id,'@materials-next-experiment 下一轮实验方案');
    pi=new PiLocalSessionService(process.cwd(),s.temp,(_p,id)=>s.service.tools(s.p.id,id));const task={taskId:run.id,projectId:s.p.id,conversationId:conversation.id} as any,grant={grantId:randomUUID(),projectId:s.p.id,conversationId:conversation.id,permissions:['read','science','patch'],approvedBy:'local-user',maxCredits:null,maxSeconds:120} as any,context={task,grant,methods:pi.toolCapabilities(s.temp,conversation.id)};
    const control=new TaskSupervisor({context,engine:'codex',connectionId:'fixture',accountRef:'local',projectPath:s.temp,resolveArtifact:(step,name)=>s.service.nextExperiments.resolveTaskArtifact(run.id,step,name),...supervisionStore(s.store,run.id)}),plan=directPlan('Design next experiments',context);plan.executionMode='planned';plan.steps[0]!.method='next_experiment_design';plan.steps[0]!.permissions=grant.permissions;plan.steps[0]!.expectedArtifacts=[...methodArtifactRoles.next_experiment_design!];plan.acceptance.requiredArtifacts=plan.steps[0]!.expectedArtifacts;control.acceptPlan(plan);
    assert(!(await pi.hostTools(s.temp,conversation.id,['read'])).some(t=>t.name==='next_experiment_design'));const tools=await pi.hostTools(s.temp,conversation.id,grant.permissions);mcp=new HostMcp({files:[],skills:[]},undefined,{tools,permissions:grant.permissions,signal:new AbortController().signal},control);await mcp.start();await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:{Authorization:'Bearer '+mcp.token}}}) as any);
    const call=async(name:string,args:Record<string,unknown>)=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r.content));return JSON.parse((r.content as Array<{text:string}>)[0]!.text);};
    assert.equal((await call('next_experiment_data',{})).study.id,study.id);assert(s.store.research.binding(run.id)!.approvedInputs.some(h=>h.id==='research-study:'+study.id));assert.throws(()=>s.service.nextExperiments.saveStudy(s.p.id,{...study.input,expectedProjectRevision:2}),/STOP_RESEARCH/);
    const blocked=await call('next_experiment_design',{...designFixture(),studyId:study.id,method:'bayesian'});assert.equal(blocked.result.status,'blocked');assert(!JSON.parse(control.summary()).execution.controlCandidates.some((c:any)=>c.action==='complete'));assert.notEqual(s.service.deliveryIssue(run.id),null);await assert.rejects(s.service.nextExperiments.verifyTask(run.id),/BLOCKED/);
    const result=await call('next_experiment_design',{...designFixture(),studyId:study.id});assert.equal(result.artifacts.length,10);await s.service.nextExperiments.verifyTask(run.id);assert(await s.service.nextExperiments.resolveTaskArtifact(run.id,plan.steps[0]!.id,'实验方案报告'));
    await control.verifyBackendSteps();assert.equal(control.snapshot().steps[0]!.state,'completed');assert.equal(s.service.deliveryIssue(run.id),null);assert(s.service.deliveryText(run.id).includes('schedule.csv'));
    const wrong=await client.callTool({name:'next_experiment_design',arguments:{...designFixture(),studyId:randomUUID()}});assert(wrong.isError);assert.equal(s.store.research.nextDesigns(s.p.id).length,2);
    await writeFile(join(s.temp,result.artifacts[0].path),'tampered');await assert.rejects(s.service.nextExperiments.verifyTask(run.id),/CHANGED/);control.finish('completed_with_limitations');
  }finally{await client.close();await mcp?.close();pi?.dispose();await s.close();}
});
