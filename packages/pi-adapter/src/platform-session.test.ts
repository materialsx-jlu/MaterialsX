import assert from "node:assert/strict";
import { test } from "node:test";
import { PiPlatformSessionService, type PlatformTransport, type CloudSelection } from "./platform-session.js";
import { responseFixtureEvents } from "./platform-probe.js";
import { cloudCatalogSchema,type CloudCatalog } from "../../contracts/src/platform.js";
const catalog=cloudCatalogSchema.parse({items:[],nextCursor:null,alpha:{configured:true,available:true,remainingRequests:10,expiresAt:new Date(Date.now()+60000).toISOString(),limits:{maxRequests:3,maxOutputTokensPerRequest:256,maxDurationSeconds:30}}});
const selection:CloudSelection={files:[{id:"silicon",name:"silicon.txt",text:"Synthetic silicon atomic number 14",sha256:"fixture-hash"}],skills:[]};
function fixture(kind="normal") {
 const payloads:Record<string,unknown>[]=[];let state="created",count=0;const records=new Map<string,unknown>();
 const transport:PlatformTransport={origin:"http://127.0.0.1:18788",async platformRequest(path,init){
  const task=()=>({id:"task-fixture",clientTaskId:"client-fixture",modelId:"materials-research",billingMode:"alpha-test",budget:catalog.alpha.limits,consent:{policyVersion:"cloud-alpha-v1",prompt:true,history:"platform-only",fileCount:1,skillCount:0},state,scientificQuality:"not_evaluated",createdAt:new Date().toISOString(),deadline:new Date(Date.now()+30000).toISOString(),requestCount:count});
  if(path==="/v1/models")return Response.json(catalog);
  if(path==="/v1/tasks")return Response.json(task());
  if(path.endsWith("/finish")){state=JSON.parse(String(init?.body)).state;return Response.json(task())}
  if(path.endsWith("/cancel")){state="cancelled";return Response.json(task())}
  if(path.startsWith("/v1/model-requests/"))return Response.json(records.get(path.split("/").at(-1)!));
  assert.equal(path,"/v1/model-gateway/responses");const payload=JSON.parse(String(init?.body));payloads.push(payload);count++;state="running";
  const id=new Headers(init?.headers).get("X-Materialsx-Request-Id")!;
  const record={id,taskId:"task-fixture",modelId:"materials-research",billingMode:"alpha-test",execution:kind==="interrupted"?"unknown":"completed",settlement:"not_billed",scientificQuality:"not_evaluated",usage:{source:"responses",inputTokens:10,outputTokens:4,cachedInputTokens:2,uncachedInputTokens:8,reasoningTokens:1},reservedCredits:"0",chargedCredits:null,salesPriceVersionId:null,routeVersionId:"fixture-v1",terminalReceived:kind!=="interrupted",errorCode:null,dispatched:true};
  if(kind==="interrupted")record.settlement="reconciliation_pending";records.set(id,kind==="missingusage"?{...record,usage:null}:record);
  const callName=kind==="skill"?"read_skill":"read_material_file", args=kind==="skill"?'{"name":"pymatgen"}':'{"fileId":"silicon"}';
  const events=JSON.parse(JSON.stringify(responseFixtureEvents(count===1?"tool":"text")));
  for(const e of events){if(e.item?.type==="function_call"){e.item.name=callName;e.item.arguments=e.item.arguments?args:""}if(e.response?.output)for(const i of e.response.output){if(i.type==="function_call"){i.name=callName;i.arguments=kind==="unauthorized"?'{"fileId":"outside"}':args}}if(e.type==="response.function_call_arguments.delta")e.delta=kind==="skill"?args:e.delta.startsWith('{')?'{"fileId":':'"silicon"}';if(e.type==="response.function_call_arguments.done")e.arguments=args;if(kind==="unauthorized"&&e.item?.type==="function_call"&&e.item.arguments)e.item.arguments='{"fileId":"outside"}'}
  const bytes=new TextEncoder().encode(events.filter((e:{type:string})=>kind!=="interrupted"||e.type!=="response.completed").map((e:unknown)=>`data: ${JSON.stringify(e)}\n\n`).join(""));
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close()}}),{headers:{"Content-Type":"text/event-stream"}});
 }};
 return {session:new PiPlatformSessionService(transport),payloads,transport};
}
test("platform Pi streams UTF8 and completes authenticated two-round readonly tool flow",async()=>{
 const {session,payloads}=fixture();let deltas="";
 const answer=await session.prompt("account-A","conversation","materials-research","Read synthetic silicon.",selection,catalog,d=>deltas+=d);
 assert.equal(answer,"硅的原子序数是 14。");assert.equal(deltas,answer);assert.equal(payloads.length,2);
 const follow=JSON.stringify(payloads[1]);assert.ok(follow.includes("function_call_output")&&follow.includes("atomic number 14"));
 const snapshot=session.snapshot("conversation")!;assert.equal(snapshot.task.state,"completed");assert.equal(snapshot.requests.length,2);assert.equal(snapshot.requests[0]?.chargedCredits,null);
 assert.ok(session.historyLength("account-A","conversation")>0);assert.equal(session.historyLength("account-B","conversation"),0);
});
test("interruption is not retried and does not create a completed history",async()=>{
 const {session,payloads}=fixture("interrupted");await assert.rejects(session.prompt("a","c","materials-research","fixture",selection,catalog,()=>{}));
 assert.equal(payloads.length,1);assert.equal(session.historyLength("a","c"),0);assert.equal(session.snapshot("c")?.requests[0]?.execution,"unknown");
});
test("unapproved model file reads stop instead of fabricating results",async()=>{
 const {session,payloads}=fixture("unauthorized");await assert.rejects(session.prompt("a","c","materials-research","fixture",selection,catalog,()=>{}),/未授权/);assert.equal(payloads.length,1);
});

test("local abort returns immediately even when durable cancellation transport is offline",async()=>{
 const f=fixture();let started!:()=>void;const ready=new Promise<void>(r=>started=r);let usageQueries=0;
 // Only the generation waits; cancellation intentionally never returns.
 const transport:PlatformTransport={origin:"http://127.0.0.1:18788",async platformRequest(path,init){
  if(path.endsWith("/cancel"))return new Promise<Response>(()=>{});
  if(path.startsWith("/v1/model-requests/"))usageQueries++;
  if(path==="/v1/model-gateway/responses"){started();return new Promise<Response>((_r,reject)=>{init?.signal?.addEventListener("abort",()=>reject(new Error("fixture abort")),{once:true})})}
  return f.transport.platformRequest(path,init);
 }};
 const session=new PiPlatformSessionService(transport);
 const pending=session.prompt("a","c","materials-research","fixture",selection,catalog,()=>{});await ready;
 assert.equal(session.cancel("c"),true);
 const outcome=await Promise.race([pending.then(()=>"completed",()=>"aborted"),new Promise<string>(r=>setTimeout(()=>r("timeout"),500))]);
 assert.equal(outcome,"aborted");assert.equal(usageQueries,0);
});


test("explicitly named Skill content reaches the next model request through the readonly tool",async()=>{
 const {session,payloads}=fixture("skill");
 await session.prompt("a","c","materials-research","@pymatgen read skill",{files:[],skills:[{id:"pymatgen",name:"pymatgen",text:"Synthetic skill documentation only",sha256:"fixture"}]},catalog,()=>{});
 assert.ok(JSON.stringify(payloads[1]).includes("Synthetic skill documentation only"));assert.equal(payloads.length,2);
});

test('paid Pi tasks keep decimal budgets and stop before tool continuation on unsettled usage',async()=>{
 for(const pending of [false,true]){
  const f=fixture();let seenBudget='';
  const transport:PlatformTransport={origin:f.transport.origin,async platformRequest(path,init){
   if(path==='/v1/tasks'){
    const inTask=JSON.parse(String(init?.body));assert.equal(inTask.billingMode,'paid-credits');seenBudget=inTask.budget.maxCredits;
   }
   const response=await f.transport.platformRequest(path,init);
   if(path==='/v1/model-gateway/responses')return response;
   const value=await response.json();
   if(path.startsWith('/v1/model-requests/'))return Response.json({...value,billingMode:'paid-credits',settlement:pending?'reconciliation_pending':'settled',reservedCredits:'141.312',chargedCredits:pending?null:'0.0482',salesPriceVersionId:'paid-sol-20261001-v1',routeVersionId:'rootflow-sol-responses-2026-10-01-v1'});
   if(path==='/v1/tasks'||path.endsWith('/finish')||path.endsWith('/cancel'))return Response.json({...value,billingMode:'paid-credits',budget:{...value.budget,maxCredits:seenBudget}});
   return Response.json(value);
  }};
  const paidCatalog:CloudCatalog={...catalog,paidPricing:{id:'paid-sol-20261001-v1',modelId:'materials-research',routeVersionId:'rootflow-sol-responses-2026-10-01-v1',testOnly:false,unit:'paid-credit',tiers:[{minInputTokens:0,inputPerMillion:'1000',cachedInputPerMillion:'100',outputPerMillion:'10000'}],inputOverheadTokens:0,maxInputTokens:131072,inputPolicy:'paid-pilot-ceiling-v1',evidenceRef:'synthetic-retail-fixture'}};
  const session=new PiPlatformSessionService(transport),run=session.prompt('account','conversation','materials-research','Read synthetic silicon.',selection,paidCatalog,()=>{},'500.0001');
  if(pending){await assert.rejects(run,/未完成或用量/);assert.equal(f.payloads.length,1);assert.equal(session.historyLength('account','conversation'),0)}
  else {assert.equal(await run,'硅的原子序数是 14。');assert.equal(f.payloads.length,2);assert.equal(session.snapshot('conversation')?.requests[0]?.chargedCredits,'0.0482')}
  assert.equal(seenBudget,'500.0001');
 }
});

test("terminal Responses without actual usage stop before any tool continuation",async()=>{const {session,payloads}=fixture('missingusage');await assert.rejects(session.prompt('a','c','materials-research','fixture',selection,catalog,()=>{}),/未完成或用量/);assert.equal(payloads.length,1);assert.equal(session.historyLength('a','c'),0);});

test("native engine reuses one M5 task and admits only receipted streaming results", async()=>{
 for(const kind of ["normal","missingusage"]){
  const f=fixture(kind);let tasks=0,clientId="",finished="";
  const transport:PlatformTransport={origin:f.transport.origin,async platformRequest(path,init){
   if(path==="/v1/tasks"){tasks++;clientId=JSON.parse(String(init?.body)).clientTaskId}
   if(path.endsWith("/finish"))finished=JSON.parse(String(init?.body)).state;
   return f.transport.platformRequest(path,init);
  }};
  const session=new PiPlatformSessionService(transport);
  const run=session.native("account","conversation",selection,catalog,"500",async invoke=>{
   for(let i=0;i<2;i++){
    const response=await invoke({model:"materials-research",input:[{role:"user",content:"native fixture"}],tools:[{type:"function",name:"read_material_file",parameters:{type:"object",properties:{fileId:{type:"string"}},required:["fileId"],additionalProperties:false}}],stream:true,store:false,max_output_tokens:256},new AbortController().signal);
    const stream=await response.text();assert.ok(stream.includes("response.completed"));
   }
   return "native result";
  },"host-task-id");
  if(kind==="normal"){
   assert.equal(await run,"native result");assert.equal(finished,"completed");
   assert.equal(session.snapshot("conversation")?.requests.length,2);
  }else{
   await assert.rejects(run,/用量待核对/);assert.equal(finished,"interrupted");
   assert.equal(f.payloads.length,1);
  }
  assert.equal(tasks,1);assert.equal(clientId,"host-task-id");
 }
});

test('platform Pi delegates approved project writes to the existing SDK and checks grants before execution',async()=>{
 const {projectTools}=await import('../../agent/src/project-tools.js'),{taskRefSchema,permissionGrantSchema}=await import('../../contracts/src/agent.js');
 const {mkdtemp,mkdir,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{randomUUID}=await import('node:crypto');
 const dir=await mkdtemp(join(tmpdir(),'mx-platform-project-')),project=join(dir,'project');await mkdir(project);
 try{for(const permitted of [true,false]){
  const f=fixture();const transport:PlatformTransport={origin:f.transport.origin,async platformRequest(path,init){const r=await f.transport.platformRequest(path,init);if(path!=='/v1/model-gateway/responses'||f.payloads.length!==1)return r;
   const args=JSON.stringify({path:'actual.txt',content:'SDK project receipt\n'});let emitted=false;
   const events=JSON.parse(JSON.stringify(responseFixtureEvents('tool')));
   for(const e of events){if(e.item?.type==='function_call'){e.item.name='write';if(e.item.arguments)e.item.arguments=args;}if(e.response?.output)for(const i of e.response.output){if(i.type==='function_call'){i.name='write';i.arguments=args;}}if(e.type==='response.function_call_arguments.delta'){e.delta=emitted?'':args;emitted=true;}if(e.type==='response.function_call_arguments.done')e.arguments=args;}
   return new Response(events.map((e:any)=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
  }};
  const task=taskRefSchema.parse({taskId:randomUUID(),projectId:randomUUID(),conversationId:randomUUID()}),grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId:task.projectId,conversationId:task.conversationId,permissions:permitted?['read','patch']:['read'],approvedBy:'native-dialog',maxCredits:'10',maxSeconds:30});
  const tools=(await projectTools(project,join(dir,'home'))).filter(t=>t.name==='write');const session=new PiPlatformSessionService(transport);
  const run=session.prompt('account',task.conversationId,'materials-research','显示文件回执，并写入合成笔记。',{files:[],skills:[]},catalog,()=>{},'10',undefined,{context:{task,grant,methods:new Map([['engine.execute',[]],['write',['patch']]])},onPlan:()=>{},tools});
  if(permitted){await run;assert.equal(await readFile(join(project,'actual.txt'),'utf8'),'SDK project receipt\n');assert.equal(f.payloads.length,2);await rm(join(project,'actual.txt'));}
  else {await assert.rejects(run,/未获本轮授权/);assert.equal(f.payloads.length,1);await assert.rejects(readFile(join(project,'actual.txt')));}
 }}finally{await rm(dir,{recursive:true,force:true});}
});
