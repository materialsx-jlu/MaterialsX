// Native independent Codex App Server + actual MCP. Scripted provider tests protocol, not model intelligence.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {CodexEngine,codexReadOnlyWorkspace} from '../../packages/agent/src/codex-engine.js';
import {HostMcp} from '../../packages/agent/src/host-mcp.js';
import {TaskSupervisor} from '../../packages/agent/src/task-supervisor.js';
import {directPlan} from '../../packages/agent/src/research-planning.js';
import {composerResponse} from '../../fixtures/agent/composer-response.js';
import {taskRefSchema,permissionGrantSchema} from '../../packages/contracts/src/agent.js';
const dir=await mkdtemp(join(tmpdir(),'mx-ap3-discovery-')),project=join(dir,'project');await mkdir(project);
const task=taskRefSchema.parse({taskId:randomUUID(),projectId:randomUUID(),conversationId:randomUUID()}),grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId:task.projectId,conversationId:task.conversationId,permissions:['read','search'],approvedBy:'local-user',maxCredits:null,maxSeconds:60});
const text='Actual public fixture\nSi 0 0 0',sha=createHash('sha256').update(text).digest('hex'),results=new Map<string,unknown>(),context={task,grant,methods:new Map<string,readonly any[]>([['engine.execute',[]],['read_material_file',['read']]])};
const control=new TaskSupervisor({context,engine:'codex',connectionId:'fixture',accountRef:'local',projectPath:project,persist:()=>{},savePlan:()=>{},saveResult:(h,v)=>{results.set(h,v);return h;},readResult:h=>results.get(h)});control.acceptPlan(directPlan('读取已选附件',context));
const mcp=new HostMcp({files:[{id:'owned-public-fixture',name:'Si sample.txt',text,sha256:sha}],skills:[]},undefined,{tools:[],permissions:grant.permissions,signal:new AbortController().signal},control);let round=0;const start=Date.now();
await mcp.start();const engine=new CodexEngine({home:join(dir,'home'),maxOutput:512,contextWindow:131072,readOnlyWorkspace:codexReadOnlyWorkspace(grant.permissions),mcp:{url:mcp.url,token:mcp.token,tools:mcp.toolNames},mcpPermissions:mcp.permissionMap,invoke:async payload=>{
 round++;assert(round<=4);
 if(round===3){assert(JSON.stringify(payload).includes('owned-public-fixture'));assert(JSON.stringify(payload).includes(sha));}
 const code=round===1?'text(await tools.mcp__materialsx__find_tools({"query":"读取已选附件","includeSchema":true}));':round===2?'text(await tools.mcp__materialsx__invoke_material_tool({"name":"read_material_file","arguments":{"fileId":"owned-public-fixture","startLine":1,"endLine":200}}));':null;
 return composerResponse(round,code);
}});
try{await engine.run({task,grant,projectPath:project,content:'查找读取已选附件的工具，然后读取批准的 Si sample.txt；不要写文件或计算。',control,onEvent:()=>{}});
 const state=control.snapshot();assert.equal(round,3);assert.equal(state.attempts.length,1);assert.equal(state.attempts[0]?.method,'read_material_file');assert.equal(state.attempts[0]?.state,'completed');
 assert(!engine.capabilities.tools.has('exec_command'));assert(!engine.capabilities.tools.has('apply_patch'));
 const report={stage:'AP.3',passed:true,realCodexAppServer:true,realHostMcp:true,scriptedProvider:true,modelIntelligenceValidated:false,externalModelCalls:0,rounds:round,elapsedMs:Date.now()-start,pinnedHash:sha};
 await mkdir(resolve('runtime/agent/ap-3'),{recursive:true});await writeFile(resolve('runtime/agent/ap-3/native-discovery.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}finally{await engine.dispose();await mcp.close();await rm(dir,{recursive:true,force:true});}
