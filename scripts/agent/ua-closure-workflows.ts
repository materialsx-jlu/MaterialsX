// Actual model, desktop entry and owned artifacts; synthetic sources unless --pdf is explicitly supplied.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {ResearchService} from '../../apps/desktop/main/research-service.js';
import {ResearchPaperService} from '../../apps/desktop/main/paper-service.js';
import {DesktopAgentRuntime} from '../../apps/desktop/main/agent-runtime.js';
import {PiLocalSessionService} from '../../packages/pi-adapter/src/local-session.js';
import {scientificFixture} from '../../tests/fixtures/agent/ua7-source.js';
import {hashOwnedFile} from '../../packages/atomistic/src/artifact-io.js';
const protocolIndex=process.argv.indexOf('--protocol'),protocolOption=protocolIndex>=0?process.argv[protocolIndex+1]:undefined;
if(protocolIndex>=0&&!['chat-completions','responses'].includes(protocolOption??''))throw Error('--protocol must be chat-completions or responses; no fallback');
const pdfIndex=process.argv.indexOf('--pdf'),providedPdf=pdfIndex>=0?process.argv[pdfIndex+1]:undefined;
if(pdfIndex>=0&&!providedPdf)throw Error('--pdf requires an explicitly authorized local PDF path');
const repeatIndex=process.argv.indexOf('--repeat'),repeat=repeatIndex<0?1:Number(process.argv[repeatIndex+1]);
if(!Number.isInteger(repeat)||repeat<1||repeat>5||providedPdf&&repeat!==1)throw Error('--repeat requires 1–5 isolated synthetic runs; real PDF repetition is not supported');
async function piErrors(home:string){
  const files=await readdir(join(home,'pi-sessions'),{recursive:true}).catch(()=>[] as string[]),errors:unknown[]=[];
  for(const file of files.filter(f=>f.endsWith('.jsonl'))){const text=await readFile(join(home,'pi-sessions',file),'utf8');if(Buffer.byteLength(text)>4*1024*1024)continue;
    const messages=text.split('\n').filter(Boolean).map(line=>JSON.parse(line).message).filter(Boolean);
    for(const m of messages)if(m.role==='toolResult'&&m.isError||m.role==='assistant'&&m.stopReason==='error'){
      const call=messages.flatMap(m=>m.content??[]).find(c=>c.type==='toolCall'&&c.id===m.toolCallId);
      errors.push({tool:m.toolName,args:call?.arguments,error:m.errorMessage??m.content?.filter((p:{type:string})=>p.type==='text').map((p:{text?:string})=>p.text).join(' ').slice(0,1500)});
    }
  }return errors.slice(-12);
}
const root=process.cwd(),retainedRoot=resolve('runtime/agent/closure');
if(providedPdf)await mkdir(retainedRoot,{recursive:true});
const temp=await mkdtemp(join(providedPdf?retainedRoot:tmpdir(),providedPdf?'user-pdf-':'mx-ua-closure-')),cases:unknown[]=[];
try{
  const engines=(['pi','codex'] as const).filter(e=>!process.argv.includes('--pi-only')||e==='pi').filter(e=>!process.argv.includes('--codex-only')||e==='codex');
  for(const kind of (['rpsme','numeric'] as const).filter(k=>(!process.argv.includes('--numeric-only')&&!process.argv.includes('--planned')||k==='numeric')&&(!process.argv.includes('--rpsme-only')||k==='rpsme')))for(const engine of engines)for(let iteration=1;iteration<=repeat;iteration++){
    const home=join(temp,kind+'-'+engine+'-'+iteration),path=join(home,'project');await mkdir(path,{recursive:true});
    const store=new WorkspaceStore(join(home,'state.sqlite')),project=store.createProject(path),conversation=store.createConversation(project.id),run=store.addRun(project.id,'UA closure / '+(providedPdf?'user-approved PDF': 'synthetic '+kind),'running');
    const research=new ResearchService(store,{client:null}),papers=new ResearchPaperService(store,research,root,home);research.papers=papers;
    const pi=new PiLocalSessionService(root,home,(_p,c)=>research.tools(project.id,c));
    papers.rpsme=(c,p,pdf,approved,signal)=>pi.extractRpsme(c,p,pdf,approved,signal);
    const runtime=new DesktopAgentRuntime(store,pi,{cancel:()=>false} as any,home,{projectRoot:root},undefined,research);
    const started=Date.now();let text='';
    const requestTimings=()=>store.agentJournal.read(run.id)?.requests.map(r=>({phase:r.phase,state:r.state,elapsedMs:r.endedAt===null?null:r.endedAt-r.startedAt,firstTokenMs:r.firstTokenAt===null?null:r.firstTokenAt-r.startedAt,inputUpperBound:r.inputUpperBound,usage:r.usage}))??[];
    try{
      let prompt:string;
      if(kind==='rpsme')prompt=`@materials-literature-rpsme-json 提取 ${resolve(providedPdf??'tests/fixtures/agent/ua6-paper.pdf')}，输出带逐页证据的 RPSME JSON、中文摘要和校验报告。${providedPdf?'这是用户已授权的本地论文，只检验实际文件工具链；抽取内容须科学复核。':'这是团队生成的合成测试文字，不是实测科研数据。'}使用 MaterialsX 的共享抽取工具，保留缺项，不编造配方或材料名称。`;
      else{
        const sources=Array.from({length:3},(_,i)=>store.research.saveSnapshot(scientificFixture(project.id,i)));
        const p=store.research.project(project.id);research.save({...p,revision:p.revision+1,selected:sources.map(s=>s.id)},p.revision);
        prompt='显示已选项目合成测试样品的 y 观测值平均数。先使用 research_quality 检查来源证据，再选择适用的描述统计方法并实际生成中文 JSON 和报告。只使用原单位、原条件，保留所有三个样品，不做拟合、不推断模量或真实实验准确性。这是合成数据，仅检验工具执行。';
        if(process.argv.includes('--planned'))prompt=prompt.replace(/^显示/,'分析');
      }
      text=await runtime.run(run.id,project.id,conversation.id,path,{mode:'local',modelId:'openai/gpt-oss-20b',localEndpoint:'http://127.0.0.1:1234/v1',agentEngine:engine,...(protocolOption?{localProtocol:protocolOption as 'chat-completions'|'responses'}:{}),localMaxOutputTokens:3200},prompt,()=>{});
      assert.equal(store.engineSession(run.id)?.connection?.protocol,protocolOption??'chat-completions','Frozen connection must match the selected or qualified automatic protocol');
      const state=store.agentJournal.read(run.id)!;assert.equal(state.state,'completed_with_limitations',state.reason??'');
      let artifacts:unknown,rpsmeEvidence:unknown;
      if(kind==='rpsme'){
        artifacts=await papers.taskArtifacts(run.id);assert.equal((artifacts as any[]).length,3);
        const files=artifacts as Array<{label:string;path:string}>,summary=await readFile(files.find(a=>a.label==='中文摘要')!.path,'utf8');
        assert(text.includes(summary),'Final answer must use the verified file summary, not a new model paraphrase');
        const packet=JSON.parse(await readFile(files.find(a=>a.label==='RPSME JSON')!.path,'utf8')),validation=JSON.parse(await readFile(files.find(a=>a.label==='校验报告')!.path,'utf8'));
        assert(Array.isArray(packet.evidence));rpsmeEvidence={facts:packet.evidence.length,valid:validation.valid,sourceCoverageComplete:validation.source_coverage_complete,extractionQualityReady:validation.extraction_quality_ready};
      }else{
        const overview=research.scientific.overview(project.id),analysis=overview.analyses.find(a=>a.taskId===run.id)!;
        assert(analysis);assert.equal(analysis.methodId,'descriptive-summary');assert.equal(analysis.result.mean,5);assert.equal(analysis.result.unit,'MPa');
        assert.deepEqual((analysis.result.points as Array<{y:number}>).map(p=>p.y).sort((a,b)=>a-b),[3,5,7]);
        assert.equal(overview.assessments.find(a=>a.id===analysis.assessmentId)?.inputHashes.length,3);assert.equal(analysis.scientificStatus,'needs_review');
        for(const a of analysis.artifacts)await hashOwnedFile(path,join(path,a.path),a.sha256,10*1024*1024);
        assert(overview.audits.some(a=>a.taskId===run.id&&a.inputs.length===3));artifacts=analysis.artifacts;
      }
      cases.push({kind,engine,protocol:store.engineSession(run.id)?.connection?.protocol,protocolSelection:protocolOption?'explicit':'automatic',passed:true,elapsedMs:Date.now()-started,requestTimings:requestTimings(),text,artifacts,...(rpsmeEvidence?{rpsmeEvidence}:{}),...(providedPdf?{retainedProject:path}:{}),actualMethods:state.attempts.map(a=>({method:a.method,state:a.state})),requests:state.requests.length,taskState:state.state,scientificStatus:'needs_review',scientificValidation:false});
    }catch(error){process.exitCode=1;cases.push({kind,engine,protocol:store.engineSession(run.id)?.connection?.protocol,protocolSelection:protocolOption?'explicit':'automatic',passed:false,elapsedMs:Date.now()-started,requestTimings:requestTimings(),error:error instanceof Error?error.message:String(error),text,
      piErrors:engine==='pi'?await piErrors(home):[],state:store.agentJournal.read(run.id),plan:store.researchPlan(run.id),...(providedPdf?{retainedProject:path}:{}),
      ...(kind==='numeric'?{actualAnalyses:research.scientific.overview(project.id).analyses,actualAssessments:research.scientific.overview(project.id).assessments}:{}),scientificValidation:false});}
    finally{await runtime.dispose();pi.dispose();await research.close();store.close();}
    Object.assign(cases.at(-1)!,{iteration});console.log(JSON.stringify(cases.at(-1)));
    const report=providedPdf?'user-pdf-workflows':process.argv.includes('--planned')?'planned-workflows':process.argv.includes('--numeric-only')?'numeric-workflows':'workflows';
    await mkdir(resolve('runtime/agent/closure'),{recursive:true});await writeFile(resolve('runtime/agent/closure/'+report+'.json'),JSON.stringify({mode:providedPdf?'real-local-model-real-engines/user-approved-local-pdf':'real-local-model-real-engines-synthetic-sources',modelId:'openai/gpt-oss-20b',payments:0,cases},null,2));
  }
}finally{if(!providedPdf)await rm(temp,{recursive:true,force:true});}
