// UA.14 orchestration only: execute existing evaluators; never introduce a model/tool loop.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {freezeBaseline} from './ap0-baseline.js';
import {fingerprint} from '../../packages/release-readiness/src/qualification/fingerprint.js';
import {hash} from '../../packages/atomistic/src/discovery-io.js';
import {qualifyReliability,reliabilityBatch,reliabilityKeys} from '../../packages/release-readiness/src/qualification/reliability.js';
import {reliabilityTuningUses} from '../../fixtures/agent/ap6-cases.js';
const live=process.argv.includes('--live'),out=resolve('runtime/agent/ap-6', (live?'live-':'engineering-')+new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(out,{recursive:true,mode:0o700});
const fp=await fingerprint(process.cwd());
const finish=await freezeBaseline(out,{stage:'AP.6',live,engine:'codex',protocol:'responses',route:'materials-research',upstreamModel:'gpt-5.6-sol',
 fullBatches:3,payments:0,productionWalletMutations:0,data:'public synthetic only',qualification:'additional UA.14 cases; not a scientific gold set'});
const before=JSON.parse(await readFile(join(out,'baseline-before.json'),'utf8'));
if(!before.buildMatchesSource)throw Error('CURRENT_FROZEN_BUILD_REQUIRED');
const batches:any[]=[],engineering:any[]=[];
async function run(args:string[],dir:string,timeoutMs:number,command=process.execPath){
 const started=Date.now(),chunks:Buffer[]=[];let bytes=0;
 const code=await new Promise<number>((done,reject)=>{
  const child=spawn(command,command===process.execPath?['--import','tsx',...args]:args,{stdio:['ignore','pipe','pipe']});
  const capture=(b:Buffer)=>{bytes+=b.length;if(bytes>8*1024*1024)child.kill('SIGTERM');else chunks.push(b);};
  child.stdout.on('data',capture);child.stderr.on('data',capture);
  const timer=setTimeout(()=>child.kill('SIGTERM'),timeoutMs);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',c=>{clearTimeout(timer);done(c??1);});
 });
 const log=Buffer.concat(chunks);await writeFile(join(dir,'run.log'),log,{mode:0o600});
 return {exitCode:code,elapsedMs:Date.now()-started,logSha256:hash(log)};
}
async function save(){
 const qualification=qualifyReliability(batches,fp);
 await writeFile(join(out,'report.json'),JSON.stringify({stage:'AP.6',out,live,fingerprint:fp,batches,engineering,qualification},null,2)+'\n',{mode:0o600});
 await writeFile(resolve('runtime/agent/ap-6',live?'latest-live.json':'latest-engineering.json'),JSON.stringify({out,batches,engineering,qualification},null,2)+'\n',{mode:0o600});
}
try{
 for(let i=1;i<=3;i++){
  const dir=join(out,'batch-'+i);await mkdir(dir);const startedAt=new Date().toISOString();
  if(live){
   // Allow each cell its existing 300-second deadline instead of truncating an otherwise full batch.
   const result=await run(['scripts/agent/rootflow-evaluation.ts','--live','--ap6','--paired','--output='+dir],dir,reliabilityKeys.length*300000+600000);
   let raw:any=null;try{raw=JSON.parse(await readFile(join(dir,'report.json'),'utf8'));}catch{/* preserve incomplete batch */}
   let after:any=null;try{after=JSON.parse(await readFile(join(dir,'baseline-after.json'),'utf8'));}catch{}
   const continuityDir=join(dir,'continuity');await mkdir(continuityDir);
   const continuityRun=await run(['scripts/agent/ap5-rootflow-continuity.ts','--live','--output='+continuityDir],continuityDir,20*60*1000);
   let chain:any=null;try{chain=JSON.parse(await readFile(join(continuityDir,'report.json'),'utf8'));}catch{}
   const rows=(raw?.results??[]).filter((r:any)=>r.benchmark).map((r:any)=>({benchmark:r.benchmark,
    intentPassed:r.passed&&(!['advice','file-inquiry','capability-update'].includes(r.family)||r.requests.length===1),
    constraintsPassed:r.passed&&r.checks.noToolExecution!==false&&r.checks.noFiles!==false,
    terminalVerified:r.checks.realReceipts===true&&r.requests.length>0&&r.requests.every((q:any)=>q.terminalReceived&&q.execution==='completed'&&q.usage?.inputTokens!=null&&q.usage?.outputTokens!=null),
    requestToolSha256:r.wire[0]?.requestMetadata?.toolContractSha256??null,
    timing:{requestUnionMs:r.timings.requestUnionMs,toolUnionMs:r.timings.toolUnionMs,unclassifiedMs:r.timings.unclassifiedMs}}));
   batches.push(reliabilityBatch.parse({schemaVersion:'ua14-ap6-batch-evidence-v1',batchIndex:i,runId:out+'/batch-'+i,fingerprint:fp,
    sourceUnchanged:after?.unchanged===true&&chain?.sourceUnchanged===true,continuityComplete:chain?.passed===3&&chain?.executedTasks===3,continuityLogSha256:continuityRun.logSha256,continuityReportSha256:chain?hash(await readFile(join(continuityDir,'report.json'))):null,buildMatched:before.buildMatchesSource,mode:'real-supplier',startedAt,finishedAt:new Date().toISOString(),
    expectedKeys:reliabilityKeys,usedForTuning:reliabilityTuningUses,logSha256:result.logSha256,reportSha256:raw?hash(await readFile(join(dir,'report.json'))):null,rows}));
   console.log(JSON.stringify({batch:i,live,exitCode:result.exitCode,cells:rows.length,expected:reliabilityKeys.length,passed:rows.filter((r:any)=>r.benchmark.passed).length}));
  }else{
   const steps=[];
   for(const script of ['ap2-native-session.ts','ap3-native-discovery.ts','ap4-native-recovery.ts','ap5-native-continuity.ts']){
    const stepDir=join(dir,script.replace('.ts',''));await mkdir(stepDir);
    const result=await run(['scripts/agent/'+script],stepDir,120000);steps.push({script,...result});
   }
   const tests=['packages/agent/src/recovery-failures.test.ts','packages/agent/src/recovery-budget.test.ts','packages/agent/src/awareness-regression.test.ts','packages/agent/src/host-step-automation.test.ts',
    'packages/agent/src/working-context.test.ts','apps/desktop/main/research-continuity.test.ts','packages/agent/src/codex-protocol.test.ts',
    'packages/agent/src/tool-discovery.test.ts','apps/desktop/main/task-reference-binding.test.ts','packages/agent/src/composer-admission.test.ts',
    'packages/release-readiness/src/qualification/reliability.test.ts','packages/release-readiness/src/qualification/rootflow-checks.test.ts'];
   const testDir=join(dir,'regression');await mkdir(testDir);
   steps.push({script:'selected-original-regressions',...await run(['--test',...tests],testDir,120000)});
   const goDir=join(dir,'gateway');await mkdir(goDir);steps.push({script:'original-go-control-plane-regression',...await run(['-C','services/control-plane','test','./...'],goDir,120000,'go')});
   engineering.push({batchIndex:i,startedAt,finishedAt:new Date().toISOString(),passed:steps.every(s=>s.exitCode===0),steps,
    externalModelCalls:0,scientificQualification:false,modelIntelligenceValidated:false});
   console.log(JSON.stringify({batch:i,live:false,passed:engineering.at(-1)!.passed}));
  }
  await save();
  if((await fingerprint(process.cwd())).sourceSha256!==fp.sourceSha256)throw Error('SOURCE_CHANGED_KEEP_FAILED_BATCHES');
 }
}finally{
 const after=await finish();await save();
 console.log(JSON.stringify({out,sourceUnchanged:after.unchanged,qualificationPassed:qualifyReliability(batches,fp).passed}));
 if(!after.unchanged||live&&!qualifyReliability(batches,fp).passed||!live&&engineering.some(b=>!b.passed))process.exitCode=1;
}
