import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentError} from '../../contracts/src/agent.js';
import type {ExecutionControl} from './execution-control.js';
import {supervisedStream} from './supervised-stream.js';
test('native model request records close on upstream parser failure and consumer cancellation without claiming usage',async()=>{
  const ended:unknown[]=[];
  const control={endRequest:(...args:unknown[])=>ended.push(args)} as unknown as ExecutionControl;
  const error=new AgentError('PROTOCOL_ERROR','Incomplete tool arguments');
  const source=new Response(new ReadableStream({start(c){c.error(error);}}));
  await assert.rejects(supervisedStream(source,control,'failed-request',new Map(),'execute').text(),/Incomplete tool/);
  assert.deepEqual(ended,[['failed-request','unknown']]);
  const ongoing=new Response(new ReadableStream({}));
  await supervisedStream(ongoing,control,'cancelled-request',new Map(),'execute').body!.cancel();
  assert.deepEqual(ended.at(-1),['cancelled-request','unknown']);
});
test('a rejected native call retains completed usage and cannot dispatch before the terminal',async()=>{
 const ended:unknown[]=[];let admitted=0;
 const control={endRequest:(...args:unknown[])=>ended.push(args),authorize:()=>{admitted++;throw new AgentError('INVALID_PLAN','dependency not ready');}} as unknown as ExecutionControl;
 const item={type:'function_call',name:'exec_command',call_id:'call1',arguments:'{"cmd":"echo test"}'};
 const frames=[{type:'response.output_item.done',item},{type:'response.completed',response:{output:[item],usage:{input_tokens:5,output_tokens:2}}}];
 const source=()=>new Response(frames.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
 await assert.rejects(supervisedStream(source(),control,'paid',new Map([['exec_command',['terminal']]]),'execute').text(),/dependency not ready/);
 assert.equal(admitted,1);assert.deepEqual(ended,[['paid','completed',{input_tokens:5,output_tokens:2}]]);
 admitted=0;ended.length=0;
 await assert.rejects(supervisedStream(new Response('data: '+JSON.stringify(frames[0])+'\n\n'),control,'partial',new Map([['exec_command',['terminal']]]),'execute').text(),/可靠终态/);
 assert.equal(admitted,0);assert.deepEqual(ended,[['partial','unknown']]);
});

const frame=(value:unknown)=>'data: '+JSON.stringify(value)+'\n\n';
test('a conflicting duplicate, omitted final call or invalid native arguments never reaches admission',async()=>{
 const item={type:'function_call',id:'item',name:'exec_command',call_id:'owned',arguments:'{"cmd":"echo actual"}'};
 for(const output of [[{...item,arguments:'{"cmd":"different"}'}],[],[item,item],[{...item,arguments:'{"cmd":null}'}]]){
  let dispatch=0;const control={endRequest:()=>{},authorize:()=>{},beforeTool:()=>{dispatch++;}} as unknown as ExecutionControl;
  const source=frame({type:'response.output_item.done',item})+frame({type:'response.completed',response:{output}});
  await assert.rejects(supervisedStream(new Response(source),control,'request',new Map([['exec_command',['terminal']]]),'execute').text(),/repeated call|omitted|schema/);
  assert.equal(dispatch,0);
 }
});
test('complete identical item replay is forwarded once; arguments fragmented across bytes execute only after trusted terminal',async()=>{
 let dispatch=0;const control={endRequest:()=>{},authorize:()=>{},beforeTool:()=>{dispatch++;}} as unknown as ExecutionControl;
 const item={type:'function_call',id:'item',name:'exec_command',call_id:'owned',arguments:'{"cmd":"echo actual"}'};
 const parts=[frame({type:'response.output_item.added',item:{...item,arguments:''}}),frame({type:'response.function_call_arguments.delta',item_id:'item',delta:'{"cmd":'}),frame({type:'response.function_call_arguments.delta',item_id:'item',delta:'"echo actual"}'}),frame({type:'response.output_item.done',item}),frame({type:'response.output_item.done',item}),frame({type:'response.completed',response:{output:[item],usage:{input_tokens:3,output_tokens:2}}})];
 const encoder=new TextEncoder();
 const bytes=parts.join('');const chunks=new ReadableStream<Uint8Array>({start(out){for(let i=0;i<bytes.length;i+=5)out.enqueue(encoder.encode(bytes.slice(i,i+5)));out.close();}});
 const text=await supervisedStream(new Response(chunks),control,'request',new Map([['exec_command',['terminal']]]),'execute').text();
 assert.equal(dispatch,1);assert.equal(text.split('response.output_item.done').length-1,1);
});
test('multiple native actions are rejected before any reservation; prose and failed/truncated responses cannot invoke tools',async()=>{
 const item={type:'function_call',id:'item',name:'exec_command',call_id:'owned',arguments:'{"cmd":"echo actual"}'};
 for(const source of [frame({type:'response.completed',response:{output:[item,{...item,id:'second',call_id:'second'}]}}),frame({type:'response.output_item.done',item})+frame({type:'response.incomplete',response:{output:[item]}})]){
  let dispatch=0;const control={endRequest:()=>{},authorize:()=>{},beforeTool:()=>{dispatch++;}} as unknown as ExecutionControl;
  try{await supervisedStream(new Response(source),control,'request',new Map([['exec_command',['terminal']]]),'execute').text();}catch(e){assert.match((e as Error).message,/one native operation/);}
  assert.equal(dispatch,0);
 }
 let dispatch=0;const control={endRequest:()=>{},beforeTool:()=>{dispatch++;}} as unknown as ExecutionControl;
 await supervisedStream(new Response(frame({type:'response.completed',response:{output:[{type:'message',content:'Call exec_command("touch fake")'}]}})),control,'request',new Map(),'execute').text();assert.equal(dispatch,0);
});

test('a complete invalid native object is rejected by Schema before any dispatch',async()=>{
 let dispatch=0;const control={endRequest:()=>{},authorize:()=>{},beforeTool:()=>{dispatch++;}} as unknown as ExecutionControl;
 const item={type:'function_call',id:'item',name:'exec_command',call_id:'owned',arguments:'{"cmd":null}'};
 await assert.rejects(supervisedStream(new Response(frame({type:'response.output_item.done',item})+frame({type:'response.completed',response:{output:[item]}})),control,'request',new Map([['exec_command',['terminal']]]),'execute').text(),/schema/);assert.equal(dispatch,0);
});
