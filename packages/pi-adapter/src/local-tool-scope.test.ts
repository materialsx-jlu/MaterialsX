import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defineTool} from '@earendil-works/pi-coding-agent';
import {Type} from 'typebox';
import {PiLocalSessionService} from './local-session.js';
import {TaskSupervisor} from '../../agent/src/task-supervisor.js';
import {directPlan} from '../../agent/src/research-planning.js';
import {taskRefSchema,permissionGrantSchema} from '../../contracts/src/agent.js';
import {modelConnectionSchema} from '../../contracts/src/engine-selection.js';
test('real Pi SDK discovers a registered hidden tool and resets visibility when a conversation changes domains or grants',async()=>{
  const home=await mkdtemp(join(tmpdir(),'mx-pi-scope-')),path=join(home,'project');await mkdir(path);
  const payloads:any[]=[];let executions=0;
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));
    const body=JSON.parse(Buffer.concat(chunks).toString());payloads.push(body);
    const index=payloads.length,tool=index===1?'find_tools':index===2?'research_method_run':null;
    const args=index===1?{query:'research_method_run'}:{value:7};
    const delta=tool?{role:'assistant',tool_calls:[{index:0,id:'call'+index,type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'14'};
    const event=(d:unknown,finish:string|null)=>({model:'fixture',choices:[{index:0,delta:d,finish_reason:finish}]});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end([event(delta,null),event({},tool?'tool_calls':'stop')].map(v=>'data: '+JSON.stringify(v)+'\n\n').join('')+'data: [DONE]\n\n');
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const address=server.address() as any,projectId=randomUUID(),conversationId=randomUUID();
  const service=new PiLocalSessionService(process.cwd(),home,()=>[defineTool({name:'research_method_run',label:'Test method',description:'Synthetic scope fixture',parameters:Type.Object({value:Type.Number()}),execute:async(_id,args)=>{executions++;return {content:[{type:'text',text:String(args.value*2)}],details:{}};}})]);
  const endpoint=`http://127.0.0.1:${address.port}/v1`;
  service.setConnection(conversationId,modelConnectionSchema.parse({id:'model-'+'a'.repeat(32),source:'local',endpoint,modelId:'fixture',protocol:'chat-completions',contextWindow:131072,maxOutputTokens:1024,revision:'fixture'}));
  const supervise=(request:string,science=true)=>{
    const task=taskRefSchema.parse({projectId,conversationId,taskId:randomUUID()}),grant=permissionGrantSchema.parse({projectId,conversationId,grantId:randomUUID(),permissions:science?['read','search','patch','science']:['read','search'],approvedBy:'local-user',maxCredits:null,maxSeconds:30});
    const context={task,grant,methods:service.toolCapabilities(path,conversationId)},results=new Map<string,unknown>();
    const control=new TaskSupervisor({context,engine:'pi',connectionId:'fixture',accountRef:'local',projectPath:path,persist:()=>{},savePlan:()=>{},saveResult:(hash,value)=>{results.set(hash,value);return hash;},readResult:hash=>results.get(hash)});
    control.acceptPlan(directPlan(request,context));service.setControl(conversationId,control);service.setPermissions(conversationId,grant.permissions);
  };
  try{
    supervise('查找论文');await service.prompt(conversationId,path,{mode:'local',modelId:'fixture',localEndpoint:endpoint},'查找论文');
    assert(!payloads[0].tools.some((t:any)=>t.function.name==='research_method_run'));
    assert(payloads[1].tools.some((t:any)=>t.function.name==='research_method_run'));assert.equal(executions,1);
    supervise('显示统计数据',false);await service.prompt(conversationId,path,{mode:'local',modelId:'fixture',localEndpoint:endpoint},'显示统计数据');
    assert(!payloads[3].tools.some((t:any)=>t.function.name==='research_method_run'));
    supervise('显示统计数据');await service.prompt(conversationId,path,{mode:'local',modelId:'fixture',localEndpoint:endpoint},'显示统计数据');
    assert(payloads[4].tools.some((t:any)=>t.function.name==='research_method_run'));assert.equal(executions,1);
  }finally{service.dispose();await new Promise<void>(r=>server.close(()=>r()));await rm(home,{recursive:true,force:true});}
});

test('real Pi SDK serializes supervised dependent tools even when a provider ignores parallel_tool_calls=false',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mx-pi-order-')),path=join(home,'project');await mkdir(path);let round=0;const order:string[]=[];
 const server=createServer(async(req,res)=>{for await(const _ of req){}const tools=++round===1;
  const delta=tools?{role:'assistant',tool_calls:['research_quality','research_method_run'].map((name,index)=>({index,id:'ordered-'+index,type:'function',function:{name,arguments:'{}'}}))}:{role:'assistant',content:'Done'};
  const event=(d:unknown,finish:string|null)=>({model:'fixture',choices:[{index:0,delta:d,finish_reason:finish}]});res.writeHead(200,{'Content-Type':'text/event-stream'});res.end([event(delta,null),event({},tools?'tool_calls':'stop')].map(v=>'data: '+JSON.stringify(v)+'\n\n').join('')+'data: [DONE]\n\n');
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const endpoint=`http://127.0.0.1:${(server.address() as any).port}/v1`,projectId=randomUUID(),conversationId=randomUUID();
 const service=new PiLocalSessionService(process.cwd(),home,()=>['research_quality','research_method_run'].map((name,index)=>defineTool({name,label:name,description:'Synthetic ordering test',parameters:Type.Object({}),execute:async()=>{
   order.push('start-'+index);if(index===0)await new Promise(r=>setTimeout(r,25));else assert(order.includes('end-0'),'Dependent tool cannot start before primary receipt');order.push('end-'+index);return {content:[{type:'text',text:'Actual fixture result'}],details:{}};
 }})));
 const task=taskRefSchema.parse({projectId,conversationId,taskId:randomUUID()}),grant=permissionGrantSchema.parse({projectId,conversationId,grantId:randomUUID(),permissions:['read','search','patch','science'],approvedBy:'local-user',maxCredits:null,maxSeconds:30});
 const results=new Map<string,unknown>(),context={task,grant,methods:service.toolCapabilities(path,conversationId)},control=new TaskSupervisor({context,engine:'pi',connectionId:'fixture',accountRef:'local',projectPath:path,persist:()=>{},savePlan:()=>{},saveResult:(hash,value)=>{results.set(hash,value);return hash;},readResult:hash=>results.get(hash)});control.acceptPlan(directPlan('显示平均数',context));
 service.setConnection(conversationId,modelConnectionSchema.parse({id:'model-'+'c'.repeat(32),source:'local',endpoint,modelId:'fixture',protocol:'chat-completions',contextWindow:131072,maxOutputTokens:1024,revision:'fixture'}));service.setControl(conversationId,control);service.setPermissions(conversationId,grant.permissions);
 try{await service.prompt(conversationId,path,{mode:'local',modelId:'fixture',localEndpoint:endpoint},'显示平均数');assert.deepEqual(order,['start-0','end-0','start-1','end-1']);assert(control.snapshot().attempts.every(a=>a.state==='completed'));}
 finally{service.dispose();await new Promise<void>(r=>server.close(()=>r()));await rm(home,{recursive:true,force:true});}
});
