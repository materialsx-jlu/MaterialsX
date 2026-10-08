// Existing M5 gateway + independent Codex + desktop runtime. Synthetic sources only.
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readOwnedBytes} from '../../packages/atomistic/src/artifact-io.js';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {DesktopAgentRuntime} from '../../apps/desktop/main/agent-runtime.js';
import {PiLocalSessionService} from '../../packages/pi-adapter/src/local-session.js';
import {rootflowSource,rootflowSourceText} from './rootflow-fixtures.js';
import {isolatedRootflowEvaluation} from './rootflow-evaluation-fixture.js';
import {freezeBaseline} from './ap0-baseline.js';
if(!process.argv.includes('--live'))throw Error('Explicit --live required for authorized supplier test');
const out=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??('runtime/agent/ap-5/live-'+new Date().toISOString().replace(/[:.]/g,'-')));await mkdir(out,{recursive:true,mode:0o700});
const finish=await freezeBaseline(out,{engine:'codex',provider:'RootFlowAI',model:'gpt-5.6-sol',protocol:'responses',consecutiveTasks:3,source:'synthetic only',cloudExport:'same explicitly selected text',payments:0,productionWalletMutations:0});
let fixture:Awaited<ReturnType<typeof isolatedRootflowEvaluation>>|undefined,store:WorkspaceStore|undefined,runtime:DesktopAgentRuntime|undefined,pi:PiLocalSessionService|undefined;
const results:any[]=[],wire:any[]=[];
const sourceSha=createHash('sha256').update(rootflowSourceText).digest('hex');
const selection={files:[{id:'synthetic-recipe',name:'recipe-source.json',text:rootflowSourceText,sha256:sourceSha}],skills:[]};
try{
 fixture=await isolatedRootflowEvaluation(event=>wire.push(event));const database=join(fixture.temp,'workspace.sqlite');store=new WorkspaceStore(database);
 const projectPath=join(fixture.temp,'project');await mkdir(projectPath);const project=store.createProject(projectPath),conversation=store.createConversation(project.id);
 const prompts=[
  '实际读取本轮批准的 synthetic-recipe 合成文本，给出各组分原始湿用量、总湿质量、总固体质量和质量固含。只解释，不写文件，不模拟。这不是文献或实测配方。',
  '基于上述配方，将总湿质量改为250 g，输出 scaled.json。JSON 根对象必须包含总固体质量 solidMassG（g）、scientificStatus=needs_review、sourceSha256；components 数组逐项保留组件原名 name、原始用量 originalAmountG 和缩放用量 proposedAmountG。实际生成并读回文件，不运行模拟，不声称性能已验证。',
  '继续使用上述原始配方，以100 g湿质量提出三个不同候选。输出 proposals.json 与中文 proposals.md，读回核对。JSON包含 sourceSha256、scientificStatus=needs_review 和 proposals 数组；每项含name、components（name、originalAmountG、proposedAmountG）、evidenceType=synthetic_fixture、assumptions 和 process 非空数组。不凭空声称验证性能；不是实验结果，不模拟。',
 ];
 for(let index=0;index<3;index++){
  if(index===2){await runtime?.dispose();pi?.dispose();store.close();store=new WorkspaceStore(database);}
  pi=new PiLocalSessionService(process.cwd(),join(fixture.temp,'pi'));
  runtime=new DesktopAgentRuntime(store,pi,fixture.platform,join(fixture.temp,'desktop'),{projectRoot:process.cwd()});
  const run=store.addRun(project.id,prompts[index]!,'running'),start=Date.now();let text='',error='';const checks:Record<string,boolean>={};
  try{
   text=await runtime.run(run.id,project.id,conversation.id,projectPath,{mode:'platform',agentEngine:'codex',modelId:'materials-research',localEndpoint:'http://127.0.0.1:1/v1'},prompts[index]!,()=>{},
    {accountId:fixture.accountId,catalog:fixture.catalog,selection,workspaceTools:index>0});
   const state=store.agentJournal.read(run.id)!;checks.completed=state.state==='completed_with_limitations';checks.frozenInput=state.workingContext?.references.some(r=>r.sha256===sourceSha)===true;
   if(index===0){checks.actualRead=state.attempts.some(a=>a.method==='read_material_file'&&a.state==='completed');checks.massBalance=/100/.test(text)&&/50/.test(text);}
   if(index===1){const r=JSON.parse((await readOwnedBytes(projectPath,join(projectPath,'scaled.json'),null,1048576)).toString('utf8'));checks.scaled=r.solidMassG===125&&r.scientificStatus==='needs_review'&&r.sourceSha256===sourceSha;
    checks.components=r.components?.length===4&&r.components.every((v:any,i:number)=>v.name===rootflowSource.components[i]!.name&&v.originalAmountG===rootflowSource.components[i]!.amountG&&v.proposedAmountG===rootflowSource.components[i]!.amountG*2.5);}
   if(index===2){const r=JSON.parse((await readOwnedBytes(projectPath,join(projectPath,'proposals.json'),null,1048576)).toString('utf8'));checks.three=r.proposals?.length===3&&new Set(r.proposals.map((p:any)=>p.name)).size===3;
    checks.originals=r.sourceSha256===sourceSha&&r.proposals.every((p:any)=>p.components?.length===4&&p.components.every((v:any,i:number)=>v.name===rootflowSource.components[i]!.name&&v.originalAmountG===rootflowSource.components[i]!.amountG&&Number.isFinite(v.proposedAmountG)&&v.proposedAmountG>=0));
    checks.distinctVariants=new Set(r.proposals?.map((p:any)=>JSON.stringify(p.components?.map((v:any)=>v.proposedAmountG)))).size===3;
    checks.totalWetMass=r.proposals?.every((p:any)=>Math.abs(p.components.reduce((sum:number,v:any)=>sum+v.proposedAmountG,0)-100)<1e-8);
    checks.qualified=r.scientificStatus==='needs_review'&&r.proposals.every((p:any)=>p.evidenceType==='synthetic_fixture'&&p.assumptions?.length&&p.process?.length);checks.report=(await readOwnedBytes(projectPath,join(projectPath,'proposals.md'),null,1048576)).length>100;}
  }catch(e){error=e instanceof Error?e.message:String(e);}
  const state=store.agentJournal.read(run.id),snapshot=fixture.platform.snapshot(conversation.id);
  const artifacts=[];
  for(const file of index===1?['scaled.json']:index===2?['proposals.json','proposals.md']:[]){
   try{const bytes=await readOwnedBytes(projectPath,join(projectPath,file),null,1048576),relativePath='artifacts/turn-'+(index+1)+'/'+file;
    await mkdir(join(out,'artifacts','turn-'+(index+1)),{recursive:true});await writeFile(join(out,relativePath),bytes,{mode:0o600});
    artifacts.push({relativePath,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
   }catch{/* Missing/unreadable artifacts remain failures; do not fabricate a placeholder. */}
  }
  await fixture.flushWire();
  const requests=snapshot?.requests??[];
  checks.terminal=requests.length>0&&requests.every(r=>r.terminalReceived&&r.execution==='completed'&&r.usage?.inputTokens!=null&&r.usage.outputTokens!=null);
  const result={turn:index+1,passed:!error&&Object.values(checks).every(Boolean),checks,error,text,artifacts,elapsedMs:Date.now()-start,taskState:state?.state,context:state?.workingContext,delivery:state?.deliveryAssessment,
   journalRequests:state?.requests,cloudTaskId:snapshot?.task.id,wire:wire.filter((e:any)=>state?.requests.some(r=>r.id===e.requestId)),
   attempts:state?.attempts.map(a=>({id:a.id,method:a.method,state:a.state})),requests:requests.map(r=>({id:r.id,execution:r.execution,settlement:r.settlement,terminalReceived:r.terminalReceived,usage:r.usage}))};
  results.push(result);await writeFile(join(out,'progress.json'),JSON.stringify(results,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({turn:index+1,passed:result.passed,error,elapsedMs:result.elapsedMs,requests:requests.length}));
  await runtime.dispose();runtime=undefined;pi.dispose();pi=undefined;
  // A failed/unknown prior task is not bypassed with a new task or artificial conversation.
  if(!result.passed)break;
 }
}catch(e){results.push({turn:'setup',passed:false,error:e instanceof Error?e.message:String(e)});}
finally{
 await runtime?.dispose();pi?.dispose();store?.close();await fixture?.close();const baseline=await finish();
 const report={stage:'AP.5',provider:'RootFlowAI',model:'gpt-5.6-sol',engine:'codex',sourceUnchanged:baseline.unchanged,expectedTasks:3,executedTasks:results.length,passed:results.filter(r=>r.passed).length,
  remainingTasksNotRun:Math.max(0,3-results.filter(r=>typeof r.turn==='number').length),scientificValidation:false,payments:0,productionWalletMutations:0,results};
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});await writeFile(resolve('runtime/agent/ap-5/latest-live.json'),JSON.stringify({out,...report},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({out,sourceUnchanged:baseline.unchanged,passed:report.passed,executedTasks:report.executedTasks}));if(report.passed!==3||!baseline.unchanged)process.exitCode=1;
}
