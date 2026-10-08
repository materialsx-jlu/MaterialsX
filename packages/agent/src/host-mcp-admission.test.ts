import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {HostMcp} from './host-mcp.js';
import {harness} from './task-supervisor.fixture.js';
test('real HostMcp refuses an unready tool as a correctable tool result, before execution, then admits it after verified dependency completion',async()=>{
 const h=harness();h.plan.executionMode='planned';h.plan.adjustmentRules=[];
 h.plan.steps=[{...h.plan.steps[0]!,id:'read-step' as any,method:'read',permissions:['read']},
   {...h.plan.steps[0]!,id:'science-step' as any,method:'materials_science',permissions:['science'],dependsOn:['read-step' as any]}];
 h.control.acceptPlan(h.plan);let executed=0;
 const mcp=new HostMcp({files:[],skills:[]},undefined,{permissions:['science','read','search'],signal:new AbortController().signal,tools:[{
   name:'materials_science',description:'Synthetic admission fixture, not scientific validation',permissions:['science'],parameters:{type:'object',properties:{},additionalProperties:false},
   execute:async()=>{executed++;return {content:[{type:'text',text:'actual fixture result'}]};},
 }]},h.control);
 const client=new Client({name:'admission-regression',version:'1'});
 try{
   await mcp.start();await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:{Authorization:'Bearer '+mcp.token}}}) as Transport);
   const denied=await client.callTool({name:'materials_science',arguments:{}});assert.equal(denied.isError,true);assert.equal(executed,0);assert.equal(h.control.snapshot().attempts.length,0);
   h.control.beforeTool(h.tool('actual-read','read'));h.control.afterTool('actual-read',{actual:true},false);
   await client.callTool({name:'task_control',arguments:{action:'complete',stepId:'read-step',expectedRevision:1,receiptIds:['actual-read']}});
   const allowed=await client.callTool({name:'materials_science',arguments:{}});assert(!allowed.isError);assert.equal(executed,1);
   assert.equal(h.control.snapshot().attempts.at(-1)?.stepId,'science-step');
 }finally{await client.close();await mcp.close();}
});
