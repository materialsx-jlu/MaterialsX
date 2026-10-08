import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {interpretLocal} from './local-runtime.js';
import {modelConnectionSchema} from '../../contracts/src/engine-selection.js';
test('local proposal retries one rejected protocol response without advertising or executing any tools',async()=>{
  const payloads:any[]=[];let unavailable=false;
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());payloads.push(body);
    if(unavailable){res.writeHead(503);res.end('offline');return;}
    const delta={content:payloads.length===1?'<|message|>':JSON.stringify({example:'response data only'})};
    const event=(d:unknown,finish:string|null)=>({model:'fixture',choices:[{index:0,delta:d,finish_reason:finish}]});
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.end([event(delta,null),event({},'stop')].map(v=>'data: '+JSON.stringify(v)+'\n\n').join('')+'data: [DONE]\n\n');
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const address=server.address() as any,endpoint=`http://127.0.0.1:${address.port}/v1`;
  const connection=modelConnectionSchema.parse({id:'model-'+'b'.repeat(32),source:'local',endpoint,modelId:'fixture',protocol:'chat-completions',contextWindow:131072,maxOutputTokens:1024,revision:'fixture'});
  try{
    const result=await interpretLocal(endpoint,'fixture','Interpret only',AbortSignal.timeout(5000),1024,undefined,connection);
    assert.deepEqual(JSON.parse(result),{example:'response data only'});assert.equal(payloads.length,2);
    for(const p of payloads){assert.equal(p.tool_choice,'none');assert.deepEqual(p.tools??[],[]);}
    unavailable=true;await assert.rejects(interpretLocal(endpoint,'fixture','Interpret only',AbortSignal.timeout(5000),1024,undefined,connection));assert.equal(payloads.length,3);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
