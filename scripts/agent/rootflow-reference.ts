// Minimal bundled Codex reference, same M5 gateway, project tools, grants and original journal.
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodexEngine,codexReadOnlyWorkspace} from '../../packages/agent/src/codex-engine.js';
import {HostMcp} from '../../packages/agent/src/host-mcp.js';
import {projectTools} from '../../packages/agent/src/project-tools.js';
import {requestedGrant} from '../../packages/agent/src/request-limits.js';
import {TaskSupervisor} from '../../packages/agent/src/task-supervisor.js';
import {projectInstructions} from '../../packages/agent/src/execution-context.js';
import {publicApplicationCapabilities} from '../../apps/desktop/main/application-capabilities.js';
import {supervisionStore} from '../../apps/desktop/main/agent-supervision-store.js';
import {runtimeWorkingContext} from '../../apps/desktop/main/runtime-working-context.js';
import {permissionGrantSchema,taskRefSchema} from '../../packages/contracts/src/agent.js';
import type {WorkspaceStore} from '../../apps/desktop/main/store.js';
import type {CloudSelection,PiPlatformSessionService} from '../../packages/pi-adapter/src/platform-session.js';
import type {CloudCatalog} from '../../packages/contracts/src/platform.js';
import type {AgentTimingEvent} from '../../packages/agent/src/agent-timing.js';
export async function rootflowReference(input:{store:WorkspaceStore;platform:PiPlatformSessionService;catalog:CloudCatalog;accountId:string;
 taskId:string;projectId:string;conversationId:string;projectPath:string;home:string;prompt:string;selection:CloudSelection;workspaceTools:boolean;
 delta:(text:string)=>void;timing:(event:AgentTimingEvent)=>void}){
 const {store,platform,catalog,accountId,taskId,projectId,conversationId,projectPath,selection,prompt}=input;
 const task=taskRefSchema.parse({taskId,projectId,conversationId});
 const grant=requestedGrant(permissionGrantSchema.parse({grantId:randomUUID(),projectId,conversationId,permissions:input.workspaceTools?['read','search','terminal','patch']:['read'],
  approvedBy:'native-dialog',maxCredits:'500',maxSeconds:catalog.alpha.limits.maxDurationSeconds}),prompt);
 const tools=input.workspaceTools?(await projectTools(projectPath,join(input.home,'project-tools'))).filter(t=>t.permissions.every(p=>grant.permissions.includes(p))&&!['read','ls','bash','write','edit'].includes(t.name)):[];
 const methods=new Map<string,readonly any[]>([['engine.execute',[]],['task_control',[]],...tools.map(t=>[t.name,t.permissions] as const)]);
 if(selection.files.length)methods.set('read_material_file',['read']);if(selection.skills.length)methods.set('read_skill',['read']);
 if(input.workspaceTools){methods.set('exec_command',['terminal']);methods.set('write_stdin',['terminal']);methods.set('apply_patch',['patch']);}
 const control=new TaskSupervisor({context:{task,grant,methods,inputVersions:selection.files.concat(selection.skills).map(a=>({id:a.id,version:a.sha256,sha256:a.sha256})),
  methodDescriptions:new Map([...tools.map(t=>[t.name,t.description] as const),...(selection.files.length?[['read_material_file',`Approved immutable files available by id: ${JSON.stringify(selection.files.map(f=>({id:f.id,name:f.name,sha256:f.sha256})))}`] as const]:[]),...(selection.skills.length?[['read_skill',`Approved selected Skills available by id: ${JSON.stringify(selection.skills.map(s=>s.id))}`] as const]:[])])},
  engine:'codex',connectionId:'reference-route',accountRef:accountId,projectPath,originalRequest:prompt,
  capabilityFacts:publicApplicationCapabilities,instructions:await projectInstructions(projectPath,grant.permissions),
  ...runtimeWorkingContext(store,undefined,task,accountId,prompt,projectPath,[],selection,true),...supervisionStore(store,taskId)});
 // An empty project-tool bridge still carries the actual grant, matching the product.
 const mcp=new HostMcp(selection,undefined,{tools,permissions:grant.permissions,signal:AbortSignal.timeout(grant.maxSeconds*1000)},control);await mcp.start();
 let engine:CodexEngine|undefined;
 try{
  let text='';await platform.native(accountId,conversationId,selection,catalog,'500',async invoke=>{
   engine=new CodexEngine({home:join(input.home,'codex'),maxOutput:catalog.alpha.limits.maxOutputTokensPerRequest,
    localToolScope:true,localResponseRecovery:true,readOnlyWorkspace:codexReadOnlyWorkspace(grant.permissions,!input.workspaceTools),
    mcp:{url:mcp.url,token:mcp.token,tools:mcp.toolNames},mcpPermissions:mcp.permissionMap,directTools:mcp.toolDefinitions,
    invoke:(payload,signal,id)=>invoke({...payload as object,model:'materials-research'},signal,id)});
   const result=await engine.run({task,grant,projectPath,content:prompt,control,onEvent:e=>{if(e.type==='text')input.delta(e.delta);else if(e.type==='plan')control.acceptPlan(e.plan);},onTiming:input.timing});
   text=result.text;control.checkAnswer(text);control.finish('completed_with_limitations');
   if(control.snapshot().state!=='completed_with_limitations')throw Error(control.snapshot().reason??'Reference incomplete');return text;
  },taskId);return text;
 }catch(error){control.finish('failed');throw error;}
 finally{await engine?.dispose();await mcp.close();}
}
