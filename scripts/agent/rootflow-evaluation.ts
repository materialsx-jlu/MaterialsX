// Real RootFlow gpt-5.6-sol through the existing M5 gateway, Codex and desktop runtime.
// Only public bundled Si and clearly synthetic coating data. No user MOOS, payment or production wallet writes.
import {mkdir,readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {hash,canonical} from '../../packages/atomistic/src/discovery-io.js';
import {rootflowCases} from './rootflow-cases.js';
import {rootflowChecks} from './rootflow-checks.js';
import {reliabilityCases} from '../../fixtures/agent/ap6-cases.js';
import {rootflowReference} from './rootflow-reference.js';
import {benchmarkResult} from '../../packages/contracts/src/qualification.js';
import {cpus,totalmem,release} from 'node:os';
import {isolatedRootflowEvaluation} from './rootflow-evaluation-fixture.js';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {DesktopAgentRuntime} from '../../apps/desktop/main/agent-runtime.js';
import {PiLocalSessionService} from '../../packages/pi-adapter/src/local-session.js';
import {AtomisticRuntime} from '../../packages/atomistic/src/runtime.js';
import {createScienceBridge,type ScienceBridge} from '../../packages/pi-adapter/src/science-bridge.js';
import { rootflowSourceText as dataText, brokenRecipeScript } from './rootflow-fixtures.js';
import { freezeBaseline } from './ap0-baseline.js';
import { baselineTiming } from '../../packages/release-readiness/src/qualification/baseline-timing.js';
import type { AgentTimingEvent } from '../../packages/agent/src/agent-timing.js';

if(!process.argv.includes('--live'))throw Error('Pass --live for the explicitly authorized supplier evaluation');
const id=new Date().toISOString().replace(/[:.]/g,'-'),directory=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??join('runtime/agent/rootflow-evaluation',id));
await mkdir(directory,{recursive:true,mode:0o700});
const paired=process.argv.includes('--paired'),ap6=process.argv.includes('--ap6');
const selectedCases=(ap6?reliabilityCases:rootflowCases).filter(c=>!process.argv.some(a=>a.startsWith("--case="))||process.argv.includes("--case="+c.id));
if(!selectedCases.length)throw Error("Unknown case");
const finishBaseline=await freezeBaseline(directory,{provider:'RootFlowAI',publicRoute:'materials-research',model:'gpt-5.6-sol',protocol:'responses',
  subject:paired?'MaterialsX and minimal bundled Codex with same host tools':'MaterialsX Codex',cases:selectedCases,sourceSha256:hash(dataText),scriptSha256:hash(brokenRecipeScript),
  limits:{maxRequests:16,maxOutputTokens:4096,maxSeconds:300,maxCredits:'500'}});
const wire:any[]=[],results:any[]=[];let wireWrites=Promise.resolve();let fixture:Awaited<ReturnType<typeof isolatedRootflowEvaluation>>|undefined;
let store:WorkspaceStore|undefined,runtime:DesktopAgentRuntime|undefined,pi:PiLocalSessionService|undefined,atomic:AtomisticRuntime|undefined;
const save=async()=>{
  const usage=results.flatMap(r=>r.requests??[]).map(r=>r.usage);
  const total=(key:string)=>usage.length&&usage.every(u=>u?.[key]!=null)?usage.reduce((n,u)=>n+Number(u[key]),0):null;
  const report={createdAt:new Date().toISOString(),provider:'RootFlowAI',model:'gpt-5.6-sol',protocol:'responses',
    mode:'real supplier + isolated PostgreSQL + existing desktop runtime and native engines',productionWalletMutations:0,payments:0,
    dataScope:'synthetic coating data and public bundled Si only; private MOOS data not exported',
    configuredLimits:{perTaskRequests:16,perRequestOutputTokens:4096,perTaskSeconds:300},
    passed:results.filter(r=>r.passed).length,total:results.length,expectedCases:selectedCases.length*(paired?2:1),
    schemaVersion:ap6?'ua14-ap6-batch-v1':'rootflow-evaluation-v1',modelIdentity:'advertised supplier ID; underlying weights not verified',
    usage:{inputTokens:total('inputTokens'),outputTokens:total('outputTokens'),cachedInputTokens:total('cachedInputTokens'),actualProcurementCostCny:null},
    scientificAccuracyValidated:false,semanticReview:'bounded assertions plus preserved answers; independent expert review pending',results};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  await writeFile(resolve('runtime/agent/rootflow-evaluation/latest.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
};
try{
  const cells=selectedCases.length*(paired?2:1);
  fixture=await isolatedRootflowEvaluation(event=>{wire.push(event);wireWrites=wireWrites.then(()=>writeFile(join(directory,"wire.json"),JSON.stringify(wire,null,2),{mode:0o600}));},Math.max(160,cells*16),ap6?cells*300000+600000:3600000);store=new WorkspaceStore(join(fixture.temp,'workspace.sqlite'));
  pi=new PiLocalSessionService(process.cwd(),join(fixture.temp,'pi'));
  runtime=new DesktopAgentRuntime(store,pi,fixture.platform,join(fixture.temp,'desktop'),{projectRoot:process.cwd()});
  atomic=new AtomisticRuntime(process.cwd(),join(fixture.temp,'atomic'),projectId=>store!.listProjects().find(p=>p.id===projectId)?.path??null);
  await atomic.restore();console.log(JSON.stringify({phase:'ready',directory,runtimeStatus:atomic.status().map(s=>({id:s.potentialId,installed:s.installed}))}));
  for(const test of selectedCases)for(const engine of (paired?['codex','reference-codex']:['codex']) as Array<'codex'|'reference-codex'>){
    const locale='locale' in test?String(test.locale):(test.id.endsWith('-en')||test.id==='file-inquiry'?'en':'zh');
    const projectPath=join(directory,'projects',test.id+'-'+locale+'-'+engine);await mkdir(projectPath,{recursive:true});
    const project=store.createProject(projectPath),conversation=store.createConversation(project.id),run=store.addRun(project.id,test.id+' '+engine,'running');
    let prompt=test.prompt,selection=test.selection,science:ScienceBridge|undefined;
    if(test.kind==='repair'){
      await writeFile(join(projectPath,'source.json'),dataText);
      await writeFile(join(projectPath,'check_recipe.py'),brokenRecipeScript);
    }
    if(test.kind==='science'){
      if(!atomic.status().some(s=>s.installed)){results.push({id:test.id,engine,passed:false,skipped:true,error:'No installed local scientific runtime'});await save();continue;}
      const structure=await atomic.importSample(project.id,'si-diamond');
      science=createScienceBridge(atomic,project.id,{projectId:project.id,conversationId:conversation.id,structureId:structure.id,
        permission:'singlepoint',domain:'inorganic-crystals',mode:'exploratory'});
      const text=await readFile(resolve('vendor/materialsx-default-skills/skills/materials-mlip-singlepoint/SKILL.md'),'utf8');
      selection={files:[],skills:[{id:'materials-mlip-singlepoint',name:'materials-mlip-singlepoint',text,sha256:hash(text)}]};
      prompt=`@materials-mlip-singlepoint 对本轮已批准的公开硅金刚石结构（结构 ID ${structure.id}）做一次单点计算。自行选择一个合格的已安装机器学习势，先核对适用性，再运行并查询到真实终态，报告能量、最大原子受力、所用势、实际产物及局限。范围为无机晶体、探索模式、短程；不要下载、弛豫或 MD，不要宣称单点结果已收敛或具有 DFT 精度。`;
    }
    const start=Date.now();let text='',partialText='',error='',firstDelta:number|null=null;
    const timingEvents:AgentTimingEvent[]=[];
    console.log(JSON.stringify({phase:'start',id:test.id,engine}));
    try{if(engine==='reference-codex')text=await rootflowReference({store,platform:fixture.platform,catalog:fixture.catalog,accountId:fixture.accountId,taskId:run.id,projectId:project.id,conversationId:conversation.id,projectPath,home:join(fixture.temp,'reference',test.id,locale),prompt,selection,workspaceTools:!['advice','inquiry'].includes(test.kind),delta:delta=>{partialText+=delta;if(delta.trim()&&firstDelta===null)firstDelta=Date.now()-start;},timing:event=>timingEvents.push(event)});
    else text=await runtime.run(run.id,project.id,conversation.id,projectPath,{mode:'platform',modelId:'materials-research',localEndpoint:'http://127.0.0.1:1/v1',...(test.kind==='advice'?{}:{agentEngine:'codex'})},prompt,
      delta=>{partialText+=delta;if(delta.trim()&&firstDelta===null)firstDelta=Date.now()-start;},
      {accountId:fixture.accountId,catalog:fixture.catalog,selection,workspaceTools:!['advice','inquiry'].includes(test.kind),...(science?{science}:{})},
      undefined,undefined,undefined,event=>timingEvents.push(event));}
    catch(e){error=e instanceof Error?e.message:String(e);}
    const execution=store.agentJournal.read(run.id),plan=store.researchPlan(run.id),snapshot=fixture.platform.snapshot(conversation.id);
    const checks:Record<string,boolean>={runtimeCompleted:execution?.state==='completed_with_limitations',realReceipts:!!snapshot?.requests.length&&snapshot.requests.every(r=>r.terminalReceived&&r.execution==='completed'&&r.usage?.inputTokens!=null&&r.usage.outputTokens!=null)};
    let output:unknown=null;const verificationStartedAt=Date.now();
    try{
      const verified=await rootflowChecks(test,projectPath,text,execution,plan,snapshot,store,run);Object.assign(checks,verified.checks);output=verified.output;
      if('noExecution' in test&&test.noExecution){checks.noToolExecution=!execution?.attempts.length;checks.noFiles=(await readdir(projectPath)).length===0;}
      if('family' in test&&test.family==='ambiguous-reference')checks.missingSource=/缺|未提供|missing|not supplied|no .* (?:record|source|formulation)/i.test(text);
      if(test.kind==='science'){
        const jobs=science!.completedSummary(true);output=jobs;checks.actualCalculation=jobs.length===1;
        const job=jobs[0]?atomic.get({projectId:project.id,runId:jobs[0].runId}):null;
        checks.realNumericResult=job?.job.status==='completed'&&Number.isFinite(job.result?.energyEv)&&job.result!.forcesEvPerAngstrom.length>0;
        checks.realArtifacts=!!job?.artifacts.length;
        if(job){const out=join(projectPath,'verified-science');await mkdir(out);for(const a of job.artifacts)await copyFile(join(projectPath,a.relativePath),join(out,a.relativePath.split('/').at(-1)!));}
      }
    }catch(e){checks.requiredOutput=false;if(!error)error=e instanceof Error?e.message:String(e);}
    const passed=!error&&Object.values(checks).every(Boolean),files=await readdir(projectPath);
    await fixture.flushWire();
    const taskWire=wire.filter(e=>snapshot?.requests.some(r=>r.id===e.requestId));
    const before=JSON.parse(await readFile(join(directory,'baseline-before.json'),'utf8'));
    const condition={fingerprint:before.fingerprint,machine:{platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,ram:totalmem(),os:release()},
      prompt,selection,route:fixture.catalog.items.find(m=>m.id==='materials-research'),protocol:'responses',limits:fixture.catalog.alpha.limits,
      grant:execution?.grant?{permissions:execution.grant.permissions,maxCredits:execution.grant.maxCredits,maxSeconds:execution.grant.maxSeconds}:null,
      workspaceTools:!['advice','inquiry'].includes(test.kind),initialState:'fresh-workspace-and-engine-home',cache:'warm-shared-supplier-no-reset'};
    const controlCalls=taskWire.flatMap(e=>(e.terminal??[]).flatMap((t:any)=>(t.response?.output??t.output??[]).filter((i:any)=>i.type==='function_call'&&i.name==='task_control').map((i:any)=>{try{return JSON.parse(i.arguments).action;}catch{return 'invalid';}})));
    const result={id:test.id,locale,heldout:'heldout' in test&&test.heldout,family:'family' in test?test.family:test.kind,engine,passed,checks,controlCalls,administrativeControlCalls:controlCalls.filter((a:string)=>['status','receipt','begin','complete'].includes(a)).length,elapsedMs:Date.now()-start,firstUiDeltaMs:firstDelta,
      firstContentMs:taskWire.some(e=>e.firstTextAt!=null)?Math.min(...taskWire.filter(e=>e.firstTextAt!=null).map(e=>e.firstTextAt))-start:null,
      error,text,partialText,output,files,wire:taskWire,
      timings:baselineTiming(execution,store.agentJournal.events(run.id),start,Date.now(),firstDelta===null?null:start+firstDelta,timingEvents),
      timingEvents,benchmarkVerificationMs:Date.now()-verificationStartedAt,
      grant:execution?.grant??null,inputSha256:hash(canonical({prompt,selection})),conditionSha256:hash(canonical(condition)),condition,journalSha256:hash(JSON.stringify(execution)),
      taskState:execution?.state,plan:plan?{executionMode:plan.executionMode,steps:plan.steps.map(s=>({id:s.id,method:s.method,artifacts:s.expectedArtifacts})),missing:plan.cognition.missing}:null,
      answerAssessment:execution?.answerAssessment??null,
      attempts:execution?.attempts.map(a=>({id:a.id,method:a.method,state:a.state,input:a.inputRef?store!.agentJournal.readResult(run.id,a.inputRef):null,result:a.resultRef?store!.agentJournal.readResult(run.id,a.resultRef):null})),
      requests:snapshot?.requests.map(r=>({id:r.id,execution:r.execution,settlement:r.settlement,billingMode:r.billingMode,reservedCredits:r.reservedCredits,chargedCredits:r.chargedCredits,salesPriceVersionId:r.salesPriceVersionId,routeVersionId:r.routeVersionId,terminalReceived:r.terminalReceived,usage:r.usage}))??[]};
    if(ap6){const first=fixture.catalog.items.find(m=>m.id==='materials-research')!;
      Object.assign(result,{benchmark:benchmarkResult.parse({caseId:test.id,locale,subject:engine,conditionSha256:result.conditionSha256,inputSha256:result.inputSha256,
        model:{id:'model-'+hash(canonical(first)).slice(0,32),source:'platform',modelId:first.upstreamModelId,endpoint:null,protocol:first.protocol,contextWindow:first.contextWindow,maxOutputTokens:fixture.catalog.alpha.limits.maxOutputTokensPerRequest,revision:first.routeVersionId??'unknown-route'},
        weightsSha256:null,platform:process.platform+'-'+process.arch,machineSha256:hash(canonical(condition.machine)),startedAt:new Date(start).toISOString(),
        passed,checks,grant:execution?.grant??null,taskState:execution?.state??null,metrics:{totalMs:result.timings.totalMs,firstOutputMs:result.firstContentMs,inputTokens:result.timings.inputTokens,cachedInputTokens:result.timings.cachedInputTokens,outputTokens:result.timings.outputTokens,requests:result.requests.length,tools:execution?.attempts.length??0,recoveries:result.timings.recoveries},
        artifacts:execution?.steps.flatMap(s=>(s.artifacts??[]).map(a=>({relativePath:relative(projectPath,resolve(projectPath,a.path)),sha256:a.sha256,bytes:a.bytes})))??[],finalTextSha256:hash(text),error:error||null,journalSha256:execution?hash(canonical(execution)):null})});}
    results.push(result);await save();console.log(JSON.stringify({phase:'done',id:test.id,engine,passed,checks,elapsedMs:result.elapsedMs,error,requests:result.requests.length}));
  }
}catch(e){results.push({id:'setup',passed:false,error:e instanceof Error?e.message:String(e)});console.log(JSON.stringify(results.at(-1)));process.exitCode=1;}
finally{await runtime?.dispose();pi?.dispose();atomic?.dispose();store?.close();await wireWrites;await save();await fixture?.close();const baseline=await finishBaseline();if(!baseline.unchanged||results.some(r=>!r.passed))process.exitCode=1;console.log(JSON.stringify({phase:'finished',report:join(directory,'report.json'),passed:results.filter(r=>r.passed).length,total:results.length,sourceUnchanged:baseline.unchanged}));}
