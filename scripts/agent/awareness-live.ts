// Real local model + both engines; isolated state, no paid APIs, real user data or remote downloads.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexEngine } from '../../packages/agent/src/codex-engine.js';
import { HostMcp } from '../../packages/agent/src/host-mcp.js';
import { TaskSupervisor } from '../../packages/agent/src/task-supervisor.js';
import { PiLocalSessionService } from '../../packages/pi-adapter/src/local-session.js';
import { localModelConnection, localResponsesInvoker } from '../../packages/agent/src/local-model-transport.js';
import { permissionGrantSchema, taskRefSchema } from '../../packages/contracts/src/agent.js';
import { SkillInstallationService } from '../../packages/skills/src/installation-service.js';
import { createInstalledSkillTools } from '../../packages/pi-adapter/src/installed-skill-tools.js';
import { applicationCapabilities } from '../../apps/desktop/main/application-capabilities.js';
import { directPlan } from '../../packages/agent/src/research-planning.js';

const dir=await mkdtemp(join(tmpdir(),'mx-awareness-live-')),project=join(dir,'project');await mkdir(project);
const service=new SkillInstallationService(join(dir,'state'),()=>[]);await service.restore();
const sessions=new PiLocalSessionService(process.cwd(),join(dir,'pi'),()=>createInstalledSkillTools(service,project),()=>service.paths());
const connection=await localModelConnection('http://localhost:1234/v1',process.env.MATERIALSX_LOCAL_MODEL??'openai/gpt-oss-20b',fetch,'chat-completions',{maxOutputTokens:1536});
const invoke=localResponsesInvoker(connection),scope={projectId:randomUUID(),conversationId:randomUUID()},results:unknown[]=[];
let threadId:string|undefined,engine:CodexEngine|undefined,mcp:HostMcp|undefined,failure:string|null=null;
try {
  for(const [index,content] of [
    'Can MaterialsX install Skills? Read current host facts and state the chat command; do not install anything.',
    'Is capability-fixture currently installed and enabled? Use the CURRENT host capability snapshot, not the previous answer.',
    'Is capability-fixture currently installed and enabled? Its state may have changed; inspect CURRENT host facts. Report installed and enabled separately.',
    '显示 capability-fixture 当前安装和启用状态。仅依据宿主最新状态；不要安装或运行脚本。',
  ].entries()){
    console.log(`Starting isolated capability case ${index} (${index===3?'Pi':'Codex'}).`);
    if(index===1){const source=join(dir,'source');await mkdir(source);await writeFile(join(source,'SKILL.md'),'---\nname: capability-fixture\ndescription: Capability status fixture\n---\nRead input.\n');await service.install(source,new AbortController().signal);}
    if(index===2)await service.enable('capability-fixture',false);
    const task=taskRefSchema.parse({...scope,taskId:randomUUID()}),grant=permissionGrantSchema.parse({...scope,grantId:randomUUID(),permissions:['read','search','terminal','patch'],approvedBy:'local-user',maxCredits:null,maxSeconds:180});
    const kind=index===3?'pi':'codex';const stored=new Map<string,unknown>();let providerRequests=0;
    const methods=new Map<string,readonly any[]>([['engine.execute',[]],['task_control',[]],['exec_command',['terminal']],['apply_patch',['patch']],['skill_capabilities',['read']]]);
    const control=new TaskSupervisor({context:{task,grant,methods},engine:kind,connectionId:connection.id,accountRef:'local',projectPath:project,originalRequest:content,
      capabilityFacts:()=>applicationCapabilities(service.summaries(),[],false,true),persist(){},savePlan(){},saveResult:(h,v)=>{stored.set(h,v);return h;},readResult:h=>stored.get(h)});
    control.acceptPlan(directPlan(content,{task,grant,methods}));const start=Date.now();let text:string;
    if(kind==='codex'){
      mcp=new HostMcp({files:[],skills:[]},undefined,{tools:await sessions.hostTools(project,scope.conversationId,grant.permissions),permissions:grant.permissions,signal:new AbortController().signal},control);await mcp.start();
      engine=new CodexEngine({home:join(dir,'codex'),maxOutput:1536,contextWindow:connection.contextWindow!,modelId:connection.modelId,...(threadId?{threadId}:{}),onThread:id=>{threadId=id;},
        mcp:{url:mcp.url,token:mcp.token,tools:mcp.toolNames},mcpPermissions:mcp.permissionMap,localToolScope:true,localResponseRecovery:true,
        invoke:async(payload:any,signal)=>{providerRequests++;assert(payload.input.some((m:any)=>typeof m.content==='string'&&m.content.startsWith('MaterialsX current task state:\n')));return invoke(payload,signal);}});
      text=(await engine.run({task,grant,projectPath:project,content,control,onEvent(){}})).text;
      await engine.dispose();engine=undefined;await mcp.close();mcp=undefined;
    }else{
      sessions.setControl(scope.conversationId,control);sessions.setConnection(scope.conversationId,connection);sessions.setPermissions(scope.conversationId,grant.permissions);
      text=await sessions.prompt(scope.conversationId,project,{mode:'local',agentEngine:'pi',localEndpoint:'http://localhost:1234/v1',modelId:connection.modelId},content);
    }
    const assessment=control.checkAnswer(text);assert.notEqual(assessment.status,'blocked',assessment.issues.join('; '));
    if(index===0){assert.match(text,/Install Skill|安装 Skill/i);assert.doesNotMatch(text,/cannot install|not authorized|未授权/i);}
    if(index===1)assert.match(text,/enabled|启用/i);
    if(index>=2)assert.match(text,/disabled|not (?:currently )?enabled|停用|未启用|禁用|已拒绝|无法被调用|authorization.{0,12}denied/i);
    results.push({engine:kind,index,text,elapsedMs:Date.now()-start,providerRequests:index===3?control.snapshot().requests.length:providerRequests,
      capabilityRevision:control.snapshot().awareness?.capabilities?.revision,assessment:assessment.status});
  }
}catch(error){failure=error instanceof Error?error.message:String(error);process.exitCode=1;}
finally{
  const createdAt=new Date().toISOString(),out=resolve('runtime/agent/awareness');await mkdir(out,{recursive:true});
  const report=JSON.stringify({passed:!failure&&results.length===4,createdAt,failure,model:connection.modelId,cloudCalls:0,downloads:0,results},null,2);
  await writeFile(join(out,'local-live.json'),report);await writeFile(join(out,`local-live-${createdAt.replace(/[:.]/g,'-')}.json`),report,{flag:'wx'});
  console.log(report);await engine?.dispose();await mcp?.close();sessions.dispose();await rm(dir,{recursive:true,force:true});
}
