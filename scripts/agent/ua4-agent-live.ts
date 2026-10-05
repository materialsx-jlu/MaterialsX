// A genuine local Pi SDK turn with real MOOS source selection and artifact checks. No paid APIs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {ResearchService} from '../../apps/desktop/main/research-service.js';
import {DesktopAgentRuntime} from '../../apps/desktop/main/agent-runtime.js';
import {PiLocalSessionService} from '../../packages/pi-adapter/src/local-session.js';
const engine=process.argv.includes('--codex')?'codex':'pi',locale=process.argv.includes('--en')?'en':'zh';
const root=resolve('runtime/agent/ua-4'),id=randomUUID(),projectPath=join(root,'live',id),statePath=join(root,'live-state',id);await mkdir(projectPath,{recursive:true});await mkdir(statePath,{recursive:true});
const store=new WorkspaceStore(join(statePath,'workspace.sqlite')),project=store.createProject(projectPath),conversation=store.createConversation(project.id);
const research=new ResearchService(store,{directory:resolve(process.env.MATERIALSX_MOOS_MCP_DIRECTORY??'../MOOS/services/materials-mcp'),origin:process.env.MATERIALSX_MOOS_ORIGIN??'http://127.0.0.1:8080'});
const pi=new PiLocalSessionService(resolve('.'),statePath,(path,c)=>research.tools(project.id,c));
// Platform is unavailable in this local-only probe and is never invoked.
const runtime=new DesktopAgentRuntime(store,pi,{cancel:()=>false} as any,statePath,{projectRoot:resolve('.')},undefined,research);
const cases:Record<string,unknown>[]=[];
try{
 const found=await research.router.search(project.id,null,{query:process.env.MATERIALSX_MOOS_FIXTURE_QUERY??'WO2025161063A1',reviewScope:'include-unreviewed'});assert(found.items.length>=2);
 const snapshots=[];for(const candidate of found.items.slice(0,2))snapshots.push(await research.select(project.id,candidate.ref));
 const run=store.addRun(project.id,'UA.4 real local source comparison','running');
 const content=locale==='en'?'Show an original-value table of solar reflectance from the selected MOOS snapshots. Unreviewed extraction is explicitly allowed. Use @materials-research-workbench to generate actual CSV, SVG and English report files, preserving units, conditions and evidence. Do not average, rank or claim scientific validation. Report the paths and limitations.':'显示选定 MOOS 记录中太阳反射率的原值对照表，允许使用待审核记录，保留原单位、条件和证据。使用 @materials-research-workbench，生成真实 CSV、SVG 和中文报告，不平均、不排名，不声称科研验证。完成后说明文件路径和限制。';
 const start=Date.now();let text='',error='';
 try{text=await runtime.run(run.id,project.id,conversation.id,projectPath,{mode:'local',modelId:'openai/gpt-oss-20b',localEndpoint:'http://127.0.0.1:1234/v1',agentEngine:engine},content,delta=>process.stdout.write(JSON.stringify({phase:'progress',chars:delta.length})+'\n'));}
 catch(e){error=e instanceof Error?e.message:String(e);}
 const execution=store.agentJournal.read(run.id),deliveries=research.overview(project.id).deliveries.filter(d=>d.taskId===run.id);
 cases.push({kind:'real-local-agent',model:'openai/gpt-oss-20b',engine,locale,elapsedMs:Date.now()-start,error,text,requests:execution?.requests.length,tools:execution?.attempts.map(a=>({method:a.method,state:a.state})),taskState:execution?.state,deliveries:deliveries.map(d=>({id:d.id,status:d.status,checks:d.checks.length,hashes:d.artifacts.map(a=>a.sha256)})),delivered:deliveries.some(d=>d.status==='accepted-with-limitations')});
}catch(e){cases.push({kind:'preparation',error:e instanceof Error?e.message:String(e),delivered:false});process.exitCode=1;}
finally{await runtime.dispose();pi.dispose();await research.close();store.close();const report={stage:'UA.4',mode:'real '+engine+' + fixed real local model + MOOS + real artifacts',cases,intelligenceQualified:false,semanticExpertReview:'pending',scientificAccuracyValidated:false,payments:0,cloudExport:false};await writeFile(join(root,'agent-live-'+id+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});await writeFile(join(root,'agent-live-'+engine+'-'+locale+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});await writeFile(join(root,'agent-live.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({stage:report.stage,cases,modelCalls:'actual journal',payments:0}));}
