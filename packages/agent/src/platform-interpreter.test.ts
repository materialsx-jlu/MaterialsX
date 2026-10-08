import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretPlatform} from './platform-interpreter.js';
import type {ExecutionControl} from './execution-control.js';
const connection={contextWindow:131072,maxOutputTokens:4096} as any;
const sse=(events:unknown[])=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
test('cloud planner uses the same supervised request ID and verified terminal, without native/tool instructions',async()=>{
 const endings:any[]=[],control={beforeRequest:(payload:any,phase:string)=>{assert.equal(phase,'interpret');assert.equal(payload.tool_choice,'none');assert.deepEqual(payload.tools,[]);assert.equal(payload.input.length,2);return {id:'owned',payload};},firstToken:()=>{},endRequest:(...a:any[])=>endings.push(a)} as unknown as ExecutionControl;
 const answer=await interpretPlatform('contract',new AbortController().signal,control,connection,async(_p,_s,id)=>{assert.equal(id,'owned');return sse([{type:'response.completed',response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"steps":[]}'}]}],usage:{input_tokens:10,output_tokens:3}}}]);});
 assert.equal(answer,'{"steps":[]}');assert.deepEqual(endings,[['owned','completed',{input_tokens:10,output_tokens:3}]]);
});
test('confirmed failed planning terminal preserves usage and stops without execution or unknown retry',async()=>{
 const endings:any[]=[],control={beforeRequest:(payload:any)=>({id:'failed',payload}),endRequest:(...a:any[])=>endings.push(a)} as unknown as ExecutionControl;
 await assert.rejects(interpretPlatform('contract',new AbortController().signal,control,connection,async()=>sse([{type:'response.failed',response:{error:{code:'TASK_BUDGET_EXCEEDED'},usage:{input_tokens:5,output_tokens:5000}}}])),(e:any)=>e.code==='BUDGET_EXCEEDED');
 assert.deepEqual(endings,[['failed','failed',{input_tokens:5,output_tokens:5000}]]);
});
test('a missing cloud plan terminal is unknown and cannot become a completed request',async()=>{
 const endings:any[]=[],control={beforeRequest:(payload:any)=>({id:'unknown',payload}),endRequest:(...a:any[])=>endings.push(a)} as unknown as ExecutionControl;
 await assert.rejects(interpretPlatform('contract',new AbortController().signal,control,connection,async()=>sse([])),/Incomplete model response/);
 assert.deepEqual(endings,[['unknown','unknown',null]]);
});
