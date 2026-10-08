import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {WorkspaceStore} from './store.js';
import {ResearchService} from './research-service.js';
import {tensileFixture,fixtureCsv} from '../../../tests/fixtures/agent/ua8-tensile.js';
import {xlsxParts,zipFixture} from '../../../tests/fixtures/agent/ua8-xlsx.js';
import {PiLocalSessionService} from '../../../packages/pi-adapter/src/local-session.js';
import {HostMcp} from '../../../packages/agent/src/host-mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {TaskSupervisor} from '../../../packages/agent/src/task-supervisor.js';
import {supervisionStore} from './agent-supervision-store.js';
import {directPlan} from '../../../packages/agent/src/research-planning.js';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile);
async function setup(){const temp=await mkdtemp(join(tmpdir(),'ua8-')),store=new WorkspaceStore(join(temp,'db.sqlite')),p=store.createProject(temp),service=new ResearchService(store,{client:null});
  return {temp,store,p,service,close:async()=>{store.close();await rm(temp,{recursive:true,force:true});}};}
test('CSV and XLSX imports preserve raw bytes, revisions create new results; same-source replay matches full result and rejects tampering',async()=>{
  const s=await setup();try{
    const f=tensileFixture(),path=join(s.temp,'synthetic.csv'),raw=fixtureCsv(f.table);await writeFile(path,raw);
    const d=await s.service.experiments.importFile(s.p.id,path),c=await s.service.experiments.configure(s.p.id,{...f.config,datasetId:d.id});
    const run=await s.service.experiments.run(s.p.id,null,{configurationIds:[c.id],independentReplicates:false,reason:'Synthetic workflow qualification'});
    assert.equal(run.artifacts.length,10);assert.equal((run.result.statistics as any).fitSlopeMPa.sampleSd,null);
    assert.equal(await readFile(path,'utf8'),raw);assert.equal(await readFile(join(s.temp,d.original.path),'utf8'),raw);
    const full=JSON.parse(await readFile(join(s.temp,run.artifacts[0]!.path),'utf8')),directory=dirname(join(s.temp,run.artifacts[0]!.path));
    await exec(process.execPath,[join(directory,'replay.mjs')]);assert.deepEqual(JSON.parse(await readFile(join(directory,'replay-result.json'),'utf8')),full.result);
    await writeFile(join(directory,'input.json'),'{}');await assert.rejects(exec(process.execPath,[join(directory,'replay.mjs')]),/REPLAY_INPUT_CHANGED/);
    const next=await s.service.experiments.configure(s.p.id,{...c.input,expectedRevision:1,fitRange:[.007,.011]});
    assert.equal(s.service.experiments.overview(s.p.id).runs[0]!.status,'stale');
    await assert.rejects(s.service.experiments.run(s.p.id,null,{configurationIds:[c.id],independentReplicates:false,reason:'Old config'}),/STALE/);
    await assert.rejects(s.service.experiments.configure(s.p.id,{...c.input,expectedRevision:1}),/REVISION/);
    const newRun=await s.service.experiments.run(s.p.id,null,{configurationIds:[next.id],independentReplicates:false,reason:'New interval'});assert((newRun.result.curves as any[])[0].fit.slopeMPa>1000);
    await writeFile(join(s.temp,'second.xlsx'),zipFixture(xlsxParts(tensileFixture(4).table)));const x=await s.service.experiments.importFile(s.p.id,join(s.temp,'second.xlsx'));assert.equal(x.sheet,'Tensile');assert.equal(x.rows,12);
    assert.equal(s.service.experiments.overview(s.p.id).configurations.length,2);
  }finally{await s.close();}
});
test('project isolation, output symlinks, changed originals, revoked sources and cancellation never deliver a fabricated result',async()=>{
  const s=await setup();try{
    const f=tensileFixture(),path=join(s.temp,'raw.csv');await writeFile(path,fixtureCsv(f.table));
    const d=await s.service.experiments.importFile(s.p.id,path),c=await s.service.experiments.configure(s.p.id,{...f.config,datasetId:d.id});
    const input={configurationIds:[c.id],independentReplicates:false,reason:'Real files required'},other=s.store.createProject(join(s.temp,'other'));
    await assert.rejects(s.service.experiments.run(other.id,null,input),/NOT_OWNED/);
    const cancelled=new AbortController();cancelled.abort();await assert.rejects(s.service.experiments.run(s.p.id,null,input,cancelled.signal));
    await writeFile(join(s.temp,d.original.path),'altered');await assert.rejects(s.service.experiments.run(s.p.id,null,input),/CHANGED/);assert.equal(s.service.experiments.overview(s.p.id).runs.length,0);
    await writeFile(join(s.temp,d.original.path),fixtureCsv(f.table));const run=await s.service.experiments.run(s.p.id,null,input);
    await assert.rejects(s.service.experiments.preview(other.id,run.id,run.artifacts[0]!.path),/NOT_OWNED/);
    await assert.rejects(s.service.experiments.preview(s.p.id,run.id,'../raw.csv'),/NOT_OWNED/);
    await symlink(path,join(s.temp,'alias.csv'));await assert.rejects(s.service.experiments.importFile(s.p.id,join(s.temp,'alias.csv')),/SYMLINK/);
    s.service.scientific.notice(s.p.id,{snapshotId:d.id,kind:'access-denied',reason:'Synthetic access revoked',replacementSnapshotId:null});
    const overview=s.service.experiments.overview(s.p.id);assert.equal(overview.datasets.length,0);assert.equal(overview.runs[0]!.status,'stale');assert.equal(overview.runs[0]!.artifacts.length,0);
    await assert.rejects(s.service.experiments.run(s.p.id,null,input),/STALE|REVOKED/);
  }finally{await s.close();}
});
test('Pi tool adapters and real Codex host MCP reuse the same scientific calculation, frozen configuration and supervisor grants',async()=>{
  const s=await setup(),client=new Client({name:'ua8-test',version:'1'});let mcp:HostMcp|undefined,pi:PiLocalSessionService|undefined;
  try{
    const f=tensileFixture(),path=join(s.temp,'raw.csv');await writeFile(path,fixtureCsv(f.table));const d=await s.service.experiments.importFile(s.p.id,path),c=await s.service.experiments.configure(s.p.id,{...f.config,datasetId:d.id});
    const conversation=s.store.createConversation(s.p.id),run=s.store.addRun(s.p.id,'UA8 synthetic','running');s.service.begin(run.id,s.p.id,'@materials-tensile-analysis Analyze configured tensile input');
    pi=new PiLocalSessionService(process.cwd(),s.temp,(_p,id)=>s.service.tools(s.p.id,id));
    const task={taskId:run.id,projectId:s.p.id,conversationId:conversation.id} as any,grant={grantId:randomUUID(),projectId:s.p.id,conversationId:conversation.id,permissions:['read','science','patch'],approvedBy:'local-user',maxCredits:null,maxSeconds:120} as any,
      context={task,grant,methods:pi.toolCapabilities(s.temp,conversation.id)};
    const control=new TaskSupervisor({context,engine:'codex',connectionId:'fixture',accountRef:'local',projectPath:s.temp,resolveArtifact:(step,name)=>s.service.experiments.resolveTaskArtifact(run.id,step,name),...supervisionStore(s.store,run.id)});
    const plan=directPlan('Analyze tensile input',context);plan.executionMode='planned';plan.steps[0]!.method='experiment_analyze';plan.steps[0]!.permissions=grant.permissions;plan.steps[0]!.expectedArtifacts=['实验 JSON','实验报告','应力应变图','实验数据表','复算脚本'];plan.acceptance.requiredArtifacts=plan.steps[0]!.expectedArtifacts;control.acceptPlan(plan);
    assert(!(await pi.hostTools(s.temp,conversation.id,['read'])).some(t=>t.name==='experiment_analyze'));
    const tools=await pi.hostTools(s.temp,conversation.id,grant.permissions);mcp=new HostMcp({files:[],skills:[]},undefined,{tools,permissions:grant.permissions,signal:new AbortController().signal},control);await mcp.start();
    await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:{Authorization:'Bearer '+mcp.token}}}) as any);
    const call=async(name:string,args:Record<string,unknown>)=>{const raw=await client.callTool({name,arguments:args});assert(!raw.isError,JSON.stringify(raw.content));return JSON.parse((raw.content as Array<{text:string}>)[0]!.text);};
    const choices=await call('experiment_data',{action:'list'});assert.equal(choices[0].configurationId,c.id);
    const guidance=JSON.parse(s.service.context(run.id)!.guidance);assert.equal(guidance.experimentInputs[0].configurationId,c.id);assert.equal(guidance.qualityAuditCandidate,null);assert(guidance.policy.includes('experiment_analyze'));
    await assert.rejects(s.service.experiments.configure(s.p.id,{...c.input,expectedRevision:1}),/STOP_RESEARCH/);
    const result=await call('experiment_analyze',{configurationIds:[c.id],independentReplicates:false,reason:'Frozen actual parameters'});assert.equal(result.artifacts.length,10);
    await s.service.experiments.verifyTask(run.id);assert(await s.service.experiments.resolveTaskArtifact(run.id,plan.steps[0]!.id,'实验报告'));
    assert.equal(s.service.deliveryIssue(run.id),null);assert(s.service.deliveryText(run.id).includes('report.md'));
    await control.verifyBackendSteps();assert.equal(control.snapshot().steps[0]!.state,'completed');
    const wrong=await client.callTool({name:'experiment_analyze',arguments:{configurationIds:[randomUUID()],independentReplicates:false,reason:'Never replace bad IDs'}});assert(wrong.isError);
    assert.equal(s.store.research.experimentRuns(s.p.id).length,1);
    control.finish('completed_with_limitations');assert.equal(control.snapshot().state,'completed_with_limitations');
    await writeFile(join(s.temp,d.original.path),'tampered');await assert.rejects(s.service.experiments.verifyTask(run.id),/CHANGED/);
  }finally{await client.close();await mcp?.close();pi?.dispose();await s.close();}
});
