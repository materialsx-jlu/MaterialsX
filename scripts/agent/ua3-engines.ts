// Real engine/tool loops with scripted model transports. This is an engineering test, not model intelligence.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PiLocalSessionService } from '../../packages/pi-adapter/src/local-session.js';
import { CodexEngine } from '../../packages/agent/src/codex-engine.js';
import { TaskSupervisor } from '../../packages/agent/src/task-supervisor.js';
import { HostMcp } from '../../packages/agent/src/host-mcp.js';
import { composerResponse } from '../../fixtures/agent/composer-response.js';
import { taskRefSchema, permissionGrantSchema } from '../../packages/contracts/src/agent.js';
import { directPlan } from '../../packages/agent/src/research-planning.js';
const dir=await mkdtemp(join(tmpdir(),'mx-ua3-')),project=join(dir,'project');await mkdir(project);
function supervised(permissions:('read'|'search'|'terminal'|'patch'|'science')[],engine:'pi'|'codex'){
 const task=taskRefSchema.parse({taskId:randomUUID(),projectId:randomUUID(),conversationId:randomUUID()});
 const grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId:task.projectId,conversationId:task.conversationId,permissions,approvedBy:'local-user',maxCredits:null,maxSeconds:90});
 const context={task,grant,methods:new Map<string,readonly any[]>([['engine.execute',[]]])},results=new Map<string,unknown>();
 const control=new TaskSupervisor({context,engine,connectionId:'fixture',accountRef:'local',projectPath:project,persist:()=>{},savePlan:()=>{},saveResult:(h,v)=>{results.set(h,v);return h;},readResult:h=>results.get(h)});
 control.acceptPlan(directPlan('显示任务结果',context));return {control,task,grant};
}
let posts=0;const payloads:any[]=[];
const server=createServer(async(req,res)=>{
 if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'fixture',context_length:65536}]}));return;}
 const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));payloads.push(JSON.parse(Buffer.concat(chunks).toString()));posts++;
 const call=posts===1||posts===2;const delta=call?{role:'assistant',tool_calls:[{index:0,id:'pi-'+posts,type:'function',function:{name:'bash',arguments:JSON.stringify({command:'echo verified >> pi-once.txt'})}}]}:{role:'assistant',content:'实际回执已收到。'};
 const event=(delta:any,finish_reason:string|null)=>({id:'chat-'+posts,object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]});
 res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify(event(delta,null))}\n\ndata: ${JSON.stringify(event({},call?'tool_calls':'stop'))}\n\ndata: [DONE]\n\n`);
});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();assert(addr&&typeof addr==='object');
const service=new PiLocalSessionService(process.cwd(),join(dir,'state'));
try{
 const p=supervised(['read','search','terminal','patch'],'pi');service.setControl(p.task.conversationId,p.control);service.setPermissions(p.task.conversationId,p.grant.permissions);
 await service.prompt(p.task.conversationId,project,{mode:'local',modelId:'fixture',localEndpoint:`http://127.0.0.1:${addr.port}/v1`},'显示任务结果');
 p.control.finish('completed_with_limitations');assert.equal(await readFile(join(project,'pi-once.txt'),'utf8'),'verified\n');
 assert.equal(p.control.snapshot().attempts.length,1);assert.equal(p.control.snapshot().requests.length,3);assert(payloads[2].messages.some((m:any)=>m.role==='tool'&&String(m.content).includes('已有真实回执')));
 const budget=supervised(['read','search'],'pi');const original=budget.control.beforeRequest.bind(budget.control);budget.control.beforeRequest=(payload,phase,_window,output)=>original(payload,phase,1024,output);
 service.setControl(budget.task.conversationId,budget.control);const before=posts;
 await assert.rejects(service.prompt(budget.task.conversationId,project,{mode:'local',modelId:'fixture',localEndpoint:`http://127.0.0.1:${addr.port}/v1`},'显示任务结果'),/窗口/);assert.equal(posts,before,'failed Pi admission must not reach provider');
 const n=supervised(['read','search','terminal','patch'],'codex');const mcp=new HostMcp({files:[],skills:[]},undefined,undefined,n.control);await mcp.start();
 let round=0;const engine=new CodexEngine({home:join(dir,'native'),maxOutput:512,contextWindow:131072,mcp:{url:mcp.url,token:mcp.token,tools:mcp.toolNames},mcpPermissions:mcp.permissionMap,
 invoke:async()=>{round++;assert(round<=4);return composerResponse(round,round===1?'text(await tools.exec_command({cmd:"echo verified >> native-once.txt",max_output_tokens:100}));':null);}});
 try{
 await engine.run({task:n.task,grant:n.grant,projectPath:project,content:'显示任务结果',control:n.control,onEvent:()=>{}});n.control.finish('completed_with_limitations');
 assert.equal(await readFile(join(project,'native-once.txt'),'utf8'),'verified\n');assert.equal(n.control.snapshot().attempts.length,1);assert.equal(n.control.snapshot().attempts[0]?.state,'completed');assert.equal(n.control.snapshot().requests.length,2);
 }finally{await engine.dispose();await mcp.close();}
 const planned=supervised(['read','search','terminal','patch','science'],'codex');
 // A narrow science method must pass through the native composer and the original MCP dispatcher, once.
 // Build a fresh control whose actual capability includes this fixture method.
 const ctx={task:planned.task,grant:planned.grant,methods:new Map<string,readonly any[]>([['fixture_science',['science']],['engine.execute',[]]])};
 const narrow=new TaskSupervisor({context:ctx,engine:'codex',connectionId:'fixture',accountRef:'local',projectPath:project,persist:()=>{},savePlan:()=>{},saveResult:(h)=>h,readResult:()=>({actual:true})});
 const np=directPlan('显示材料分析结果',ctx);np.steps[0]!.method='fixture_science';np.steps[0]!.permissions=['science'];narrow.acceptPlan(np);
 let scientificCalls=0;const scopeController=new AbortController();
 const lazyMcp=new HostMcp({files:[],skills:[]},undefined,{permissions:planned.grant.permissions,signal:scopeController.signal,tools:[{name:'fixture_science',description:'Fixture scientific tool',parameters:{type:'object',properties:{},additionalProperties:false},permissions:['science'],execute:async()=>{scientificCalls++;return {content:[{type:'text',text:JSON.stringify({actual:true})}]};}}]},narrow);await lazyMcp.start();
 let nr=0;const ne=new CodexEngine({home:join(dir,'narrow'),maxOutput:512,contextWindow:131072,mcp:{url:lazyMcp.url,token:lazyMcp.token,tools:lazyMcp.toolNames},mcpPermissions:lazyMcp.permissionMap,invoke:async()=>{
  nr++;const code=nr===1?'text(await tools.mcp__materialsx__invoke_material_tool({"name":"fixture_science","arguments":{}}));':nr===2?`text(await tools.mcp__materialsx__task_control(${JSON.stringify({action:'complete',stepId:np.steps[0]!.id,expectedRevision:1,receiptIds:narrow.snapshot().attempts.map(a=>a.id)})}));`:null;
  assert(nr<=4);return composerResponse(20+nr,code);
 }});
 try{await ne.run({task:planned.task,grant:planned.grant,projectPath:project,content:'显示材料分析结果',control:narrow,onEvent:()=>{}});narrow.finish('completed_with_limitations');assert.equal(scientificCalls,1);assert.equal(narrow.snapshot().steps[0]?.state,'completed');}finally{await ne.dispose();await lazyMcp.close();}
 const denied=supervised(['read','search','terminal','patch'],'codex');
 const deniedPlan=denied.control.plan()!;deniedPlan.planRevision++;deniedPlan.constraints.permissions=['read','search'];deniedPlan.steps[0]!.permissions=['read','search'];denied.control.revise(deniedPlan,1,'user');
 const blocked=new CodexEngine({home:join(dir,'denied'),maxOutput:512,contextWindow:131072,invoke:async()=>composerResponse(10,'text(await tools.exec_command({cmd:"echo forbidden > denied.txt"}));')});
 const cancel=setTimeout(()=>void blocked.cancel(denied.task.taskId),1500);
 try{await assert.rejects(blocked.run({task:denied.task,grant:denied.grant,projectPath:project,content:'显示任务结果',control:denied.control,onEvent:()=>{}}));}finally{clearTimeout(cancel);await blocked.dispose();}
 await assert.rejects(readFile(join(project,'denied.txt')));assert.equal(denied.control.snapshot().attempts.length,0);
 const report={stage:'UA.3',realPiSDK:true,realCodexAppServer:true,piRepeatedMutationBlocked:true,piBudgetDeniedBeforeNetwork:true,nativeRunsOnce:true,nativeNarrowMcpOnce:true,nativeDeniedBeforeExecution:true,intelligenceValidated:false,scientificValidation:false};
 await mkdir(resolve('runtime/agent/ua-3'),{recursive:true});await writeFile(resolve('runtime/agent/ua-3/engines.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{service.dispose();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
