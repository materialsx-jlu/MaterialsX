// Diagnostic only: isolate supplier/SDK behavior from desktop research planning.
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {CodexEngine} from '../../packages/agent/src/codex-engine.js';
import {permissionGrantSchema,taskRefSchema} from '../../packages/contracts/src/agent.js';
import {resolve,join} from 'node:path';
import {isolatedRootflowEvaluation} from './rootflow-evaluation-fixture.js';
import { rootflowSourceText as original, brokenRecipeScript, repairPrompt } from './rootflow-fixtures.js';
import { freezeBaseline } from './ap0-baseline.js';
import { hash } from '../../packages/atomistic/src/discovery-io.js';
import type { AgentTimingEvent } from '../../packages/agent/src/agent-timing.js';
if(!process.argv.includes('--live'))throw Error('Explicit --live required');
const directory=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??join('runtime/agent/rootflow-baseline',new Date().toISOString().replace(/[:.]/g,'-')));
await mkdir(directory,{recursive:true,mode:0o700});
const wire:any[]=[];
const finishBaseline=await freezeBaseline(directory,{provider:'RootFlowAI',publicRoute:'materials-research',model:'gpt-5.6-sol',protocol:'responses',
  subject:'native Codex diagnostic',prompt:repairPrompt,sourceSha256:hash(original),scriptSha256:hash(brokenRecipeScript),
  limits:{maxRequests:16,maxOutputTokens:4096,maxSeconds:300,maxCredits:'500'},supervision:false});
let fixture:Awaited<ReturnType<typeof isolatedRootflowEvaluation>>|undefined;const results:any[]=[];
try{
 fixture=await isolatedRootflowEvaluation(event=>wire.push(event));
 const project=join(directory,'native-repair');await mkdir(project);
 await writeFile(join(project,'source.json'),original);
 await writeFile(join(project,'check_recipe.py'),brokenRecipeScript);
 const conversation=randomUUID(),task=taskRefSchema.parse({taskId:randomUUID(),projectId:randomUUID(),conversationId:conversation}),
  grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId:task.projectId,conversationId:conversation,permissions:['read','search','terminal','patch'],approvedBy:'native-dialog',maxCredits:'500',maxSeconds:300});
 const start=Date.now(),events:any[]=[];let answer='',error='',engine:CodexEngine|undefined;
 const timingEvents:AgentTimingEvent[]=[];
 try{
  answer=await fixture.platform.native(fixture.accountId,conversation,{files:[],skills:[]},fixture.catalog,'500',async invoke=>{
   engine=new CodexEngine({home:join(fixture!.temp,'baseline-codex'),maxOutput:4096,
    invoke:(payload,signal,id)=>invoke({...payload as object,model:'materials-research'},signal,id)});
   const completion=await engine.run({task,grant,projectPath:project,content:repairPrompt,
    onEvent:e=>{if(['receipt','text'].includes(e.type))events.push({...e,at:Date.now()});},onTiming:e=>timingEvents.push(e)});
   if(completion.state!=='completed_with_limitations')throw Error(completion.limitation??completion.state);return completion.text;
  },task.taskId);
 }catch(e){error=e instanceof Error?e.message:String(e);}finally{await engine?.dispose();}
 let output:any=null;try{output=JSON.parse(await readFile(join(project,'repaired.json'),'utf8'));}catch{}
 await fixture.flushWire();
 const snapshot=fixture.platform.snapshot(conversation),checks={completed:!error&&snapshot?.task.state==='completed',exactResult:output?.totalWetMassG===100&&output?.solidMassG===50&&output?.scientificStatus==='needs_review',
  originalPreserved:(await readFile(join(project,'source.json'),'utf8'))===original,failureObserved:events.some(e=>e.type==='receipt'&&(e.receipt.status==='failed'||Number(e.receipt.exitCode)>0)),receipts:!!snapshot?.requests.length&&snapshot.requests.every(r=>r.terminalReceived&&r.execution==='completed')};
 results.push({id:'native-repair',engine:'codex',scope:'Existing native engine with direct plan; desktop task supervisor absent, diagnostic only',passed:Object.values(checks).every(Boolean),checks,error,answer,output,elapsedMs:Date.now()-start,events,grant,inputSha256:hash(repairPrompt),
   firstFeedbackMs:events.some(e=>e.type==='text')?events.find(e=>e.type==='text').at-start:null,
   firstContentMs:wire.some(e=>e.firstTextAt!==null&&e.firstTextAt!==undefined)?Math.min(...wire.filter(e=>e.firstTextAt!=null).map(e=>e.firstTextAt))-start:null,
   timingEvents,requests:snapshot?.requests??[]});
 console.log(JSON.stringify({id:'native-repair',passed:results.at(-1).passed,elapsedMs:Date.now()-start,error}));
}catch(e){results.push({id:'setup',passed:false,error:e instanceof Error?e.message:String(e)});process.exitCode=1;}finally{
 const report={provider:'RootFlowAI',model:'gpt-5.6-sol',scope:'real M5 gateway; Codex-only diagnostic; desktop supervision absent, not a delivery acceptance test',results,wire};
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 await writeFile(resolve('runtime/agent/rootflow-baseline',process.argv.includes('--repair-only')?'latest-repair.json':'latest.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 await fixture?.close();const baseline=await finishBaseline();if(!baseline.unchanged||results.some(r=>!r.passed))process.exitCode=1;
 console.log(JSON.stringify({report:join(directory,'report.json'),sourceUnchanged:baseline.unchanged}));
}
