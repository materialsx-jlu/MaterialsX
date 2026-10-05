import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentError} from '../../contracts/src/agent.js';
import type {ExecutionControl} from './execution-control.js';
import {supervisedStream} from './supervised-stream.js';
import {withLocalResponseRecovery} from './model-recovery.js';
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
test('an invalid streaming tool name is rejected before admission and corrected only by the bounded original local loop',async()=>{
  let admitted=0,requests=0;const ended:unknown[]=[];
  const control={endRequest:(...args:unknown[])=>ended.push(args),authorize:()=>admitted++,
    canRecoverModelResponse:()=>true,summary:()=>JSON.stringify({execution:{steps:[]}})} as unknown as ExecutionControl;
  const source=(type:string,name:string)=>new Response('data: '+JSON.stringify({type,item:{type:'function_call',name,call_id:'never-run',arguments:'{}'}})+'\n\n');
  const text=await withLocalResponseRecovery(async correction=>{
    requests++;if(requests===1)return supervisedStream(source('response.output_item.added','research_method_run?'),control,'bad',new Map(),'execute').text();
    assert.match(correction!,/Unapproved tool/);return 'same engine continuation';
  },control);
  assert.equal(text,'same engine continuation');assert.equal(requests,2);assert.equal(admitted,0);assert.deepEqual(ended,[['bad','unknown']]);
  await assert.rejects(supervisedStream(source('response.output_item.done','undeclared'),control,'final',new Map(),'execute').text(),(e:unknown)=>e instanceof AgentError&&e.code==='UNKNOWN_METHOD');
  assert.equal(admitted,0);
});
