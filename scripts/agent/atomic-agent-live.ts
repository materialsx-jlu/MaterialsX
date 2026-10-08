// Real local model and existing desktop tool loop; isolated, explicitly authorized silicon fixture.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {ResearchService} from '../../apps/desktop/main/research-service.js';
import {DesktopAgentRuntime} from '../../apps/desktop/main/agent-runtime.js';
import {PiLocalSessionService} from '../../packages/pi-adapter/src/local-session.js';
import {createAtomisticTools} from '../../packages/pi-adapter/src/atomistic-tools.js';
import {AtomisticRuntime} from '../../packages/atomistic/src/runtime.js';
import {PotentialAnalysisService} from '../../packages/atomistic/src/potential-workflow.js';
const root=process.cwd(),dir=resolve('runtime/agent/atomic-agent');await mkdir(dir,{recursive:true});
const home=await mkdtemp(join(dir,'probe-')),path=join(home,'project');await mkdir(path);
const store=new WorkspaceStore(join(home,'state.sqlite')),project=store.createProject(path),conversation=store.createConversation(project.id);
const atomic=new AtomisticRuntime(root,home,id=>id===project.id?path:null);await atomic.restore();
const automation=new PotentialAnalysisService(root,home,atomic),structure=await atomic.importSample(project.id,'si-diamond');
const options={optimizer:'FIRE' as const,cellMode:'fixed' as const,cellConstraint:'none' as const,externalPressureGPa:null,maxSteps:3,fmaxEvPerAngstrom:.05};
const scope={projectId:project.id,conversationId:conversation.id,structureId:structure.id,domain:'inorganic-crystals' as const,mode:'exploratory' as const,permission:'relaxation' as const,options};
const analysis={projectId:project.id,conversationId:conversation.id,structureId:structure.id,permission:'relaxation' as const,maxSteps:3,maxDownloadBytes:0};
const research=new ResearchService(store,{client:null});research.scientific.atomistic=atomic;
const pi=new PiLocalSessionService(root,home,()=>[...research.tools(project.id,conversation.id),...createAtomisticTools(atomic,project.id,undefined,{service:automation,scope:analysis,prompt:'优先使用已安装模型；不下载模型'},scope)]);
const agent=new DesktopAgentRuntime(store,pi,{cancel:()=>false} as any,home,{projectRoot:root},async(projectId,ids)=>ids.flatMap<{id:string;state:string;runId?:string}>(id=>{try{const w=automation.get(projectId,id);return [{id,state:w.state,...(w.runId?{runId:w.runId}:{})}];}catch{try{return [{id,state:atomic.get({projectId,runId:id}).job.status}];}catch{return [];}}}),research);
const run=store.addRun(project.id,'Automatic potential regression / authorized silicon fixture','running'),started=Date.now();let answer='';
try{
  answer=await agent.run(run.id,project.id,conversation.id,path,{mode:'local',modelId:'openai/gpt-oss-20b',localEndpoint:'http://127.0.0.1:1234/v1',localProtocol:'chat-completions',agentEngine:'codex',localMaxOutputTokens:16384,localContextBudget:131072},
    `自动选择合适的机器学习势，优先使用已安装模型，执行最多 3 步固定晶胞弛豫，输出能量、原子受力、收敛状态、报告和 3D 结构。分析对象是已导入的 8 原子硅晶体 ${structure.id}，这是探索性测试。已授权固定晶胞 FIRE、最多 3 步、受力停止阈值 0.05 eV/Å，禁止下载。使用 materials_science auto_plan、auto_run、auto_get 并读取实际结果，不要创建额外产物。`,delta=>{if(delta.includes('正在')||delta.includes('研究计划'))console.log(delta.trim().slice(0,200));});
  const workflow=automation.list(project.id).find(w=>w.state==='completed');assert(workflow?.runId,'No completed workflow');
  const job=atomic.get({projectId:project.id,runId:workflow.runId});assert.equal(job.job.status,'completed');assert.equal(job.relaxation?.options.maxSteps,3);assert.equal(job.relaxation?.options.cellMode,'fixed');assert(Number.isFinite(job.result?.energyEv));assert.equal(job.result?.forcesEvPerAngstrom.length,8);assert(job.artifacts.some(a=>a.type==='validation_report'));assert.equal(store.agentJournal.read(run.id)?.state,'completed_with_limitations');
  await writeFile(join(dir,'latest.json'),JSON.stringify({passed:true,elapsedMs:Date.now()-started,answer,model:'openai/gpt-oss-20b',engine:'codex',structureIsTestFixture:true,project:path,state:store.agentJournal.read(run.id),plan:store.researchPlan(run.id),workflow,result:job.result,artifacts:job.artifacts},null,2));console.log(JSON.stringify({passed:true,elapsedMs:Date.now()-started,potential:job.result?.potentialId,energyEv:job.result?.energyEv,stopReason:job.result?.stopReason}));
}catch(error){await writeFile(join(dir,'latest.json'),JSON.stringify({passed:false,elapsedMs:Date.now()-started,error:String(error),answer,project:path,state:store.agentJournal.read(run.id),plan:store.researchPlan(run.id),workflows:automation.list(project.id)},null,2));console.error(String(error));process.exitCode=1;}
finally{await agent.dispose();pi.dispose();automation.dispose();atomic.dispose();await research.close();store.close();}
