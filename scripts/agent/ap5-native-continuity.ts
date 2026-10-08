// Real independent Codex App Server + original MCP/SQLite, scripted provider. Not model-intelligence acceptance.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {WorkspaceStore} from '../../apps/desktop/main/store.js';
import {supervisionStore} from '../../apps/desktop/main/agent-supervision-store.js';
import {runtimeWorkingContext} from '../../apps/desktop/main/runtime-working-context.js';
import {CodexEngine} from '../../packages/agent/src/codex-engine.js';
import {HostMcp} from '../../packages/agent/src/host-mcp.js';
import {TaskSupervisor} from '../../packages/agent/src/task-supervisor.js';
import {directPlan} from '../../packages/agent/src/research-planning.js';
import {composerResponse} from '../../fixtures/agent/composer-response.js';
import {taskRefSchema,permissionGrantSchema} from '../../packages/contracts/src/agent.js';
const root=await mkdtemp(join(tmpdir(),'mx-ap5-native-')),projectPath=join(root,'project');await mkdir(projectPath);
let store=new WorkspaceStore(join(root,'state.sqlite'));
const p=store.createProject(projectPath),c=store.createConversation(p.id),text='Public Si fixture\nTemperature: 300 K\nScientific status: unverified.';
const file={id:'owned-si',name:'Si.txt',text,sha256:createHash('sha256').update(text).digest('hex')};
let threadId:string|undefined,originalTask:string|undefined,originalReceipt:string|undefined,requests=0;
const sessions:string[]=[],start=Date.now(),roundResults:unknown[]=[];
try{
 for(let turn=1;turn<=3;turn++){
  if(turn===3){store.close();store=new WorkspaceStore(join(root,'state.sqlite'));}
  const content=turn===1?'读取批准的 Si 文本，解释，不运行计算。':turn===2?'基于这个文件，说明 300 K 的条件，不创建文件。':'继续使用这个文件，列出缺失条件，不运行。';
  const run=store.addRun(p.id,content,'running'),task=taskRefSchema.parse({taskId:run.id,projectId:p.id,conversationId:c.id});
  const grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId:p.id,conversationId:c.id,permissions:['read'],approvedBy:'local-user',maxCredits:null,maxSeconds:60});
  const selection={files:turn===1?[file]:[],skills:[]},context={task,grant,methods:new Map<string,readonly any[]>([['engine.execute',[]],['read_material_file',['read']]])};
  const control=new TaskSupervisor({context,engine:'codex',connectionId:'scripted',accountRef:'local',projectPath,
   ...runtimeWorkingContext(store,undefined,task,'local',content,projectPath,[],selection,false),...supervisionStore(store,run.id)});
  control.acceptPlan(directPlan(content,context));
  if(turn>1){assert(control.snapshot().workingContext!.history.some(h=>h.taskId===originalTask));assert.equal(control.snapshot().workingContext!.references[0]!.sha256,file.sha256);}
  const mcp=new HostMcp(selection,undefined,{tools:[],permissions:grant.permissions,signal:new AbortController().signal},control);await mcp.start();
  let rounds=0;
  const engine=new CodexEngine({home:join(root,'home'),...(threadId?{threadId}:{}),maxOutput:512,contextWindow:131072,readOnlyWorkspace:true,
   mcp:{url:mcp.url,token:mcp.token,tools:mcp.toolNames},mcpPermissions:mcp.permissionMap,directTools:mcp.toolDefinitions,
   onThread:id=>{threadId=id;sessions.push(id);},invoke:async payload=>{
    requests++;rounds++;assert(rounds<=2);assert(JSON.stringify(payload).includes('working-context-v1'));
    const response=await composerResponse(rounds,rounds===1?'unused':null);if(rounds===2)return response;
    const name=turn===1?'read_material_file':'task_control',args=JSON.stringify(turn===1?{fileId:file.id}:{action:'receipt',sourceTaskId:originalTask,receiptIds:[originalReceipt]});
    const events=(await response.text()).split('\n\n').filter(Boolean).map(b=>JSON.parse(b.slice(6)));
    for(const e of events){if(e.item?.type==='function_call')e.item={...e.item,name,arguments:e.type.endsWith('added')?'':args};
     if(e.type==='response.function_call_arguments.delta')e.delta=args;if(e.type==='response.function_call_arguments.done')e.arguments=args;
     if(e.response?.output)e.response.output=e.response.output.map((o:any)=>o.type==='function_call'?{...o,name,arguments:args}:o);}
    return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
   }});
  try{
   const result=await engine.run({task,grant,projectPath,content,control,onEvent:()=>{}});control.checkAnswer(result.text);control.finish('completed_with_limitations');
   const state=control.snapshot();assert.equal(state.state,'completed_with_limitations');assert.equal(rounds,2);
   if(turn===1){originalTask=run.id;originalReceipt=state.attempts[0]!.id;assert.equal(state.attempts.length,1);}else assert.equal(state.attempts.length,0,'historical receipt was not replayed or accepted as a new execution');
   roundResults.push({turn,taskId:run.id,requests:rounds,toolExecutions:state.attempts.length,contextSha256:state.workingContext!.sha256,relatedTasks:state.workingContext!.history.map(h=>h.taskId),technical:state.deliveryAssessment!.technical});
  }finally{await engine.dispose();await mcp.close();}
 }
 assert.equal(new Set(sessions).size,1);
 const report={stage:'AP.5',passed:true,realCodexAppServer:true,realHostMcp:true,originalSQLiteJournal:true,scriptedProvider:true,modelIntelligenceValidated:false,externalModelCalls:0,
  requests,consecutiveTasks:3,restartedStore:true,nativeThreadCount:new Set(sessions).size,actualFileReads:1,historicalReceiptReads:2,mutations:0,elapsedMs:Date.now()-start,roundResults};
 await mkdir(resolve('runtime/agent/ap-5'),{recursive:true});await writeFile(resolve('runtime/agent/ap-5/native-continuity.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}finally{store.close();await rm(root,{recursive:true,force:true});}
