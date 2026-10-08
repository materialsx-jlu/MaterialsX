import test from 'node:test';
import assert from 'node:assert/strict';
import {LoopbackProxy} from './loopback-proxy.js';
import {canRecoverLocalResponse} from './model-recovery.js';
test('actual loopback transport failure is structured, sanitized and cannot trigger paid/model replay',async()=>{
 let calls=0;const proxy=new LoopbackProxy(async()=>{calls++;throw Error('fixture-secret-not-to-display');});
 try{await proxy.start();const response=await fetch(proxy.url+'/responses',{method:'POST',headers:{Authorization:'Bearer '+proxy.token},body:'{}'});
  assert.equal(response.status,502);assert.equal(calls,1);assert.equal(proxy.lastError?.recovery?.kind,'transport');assert.equal(proxy.lastError?.recovery?.phase,'unknown');
  assert(!JSON.stringify(proxy.lastError?.toJSON()).includes('fixture-secret-not-to-display'));assert(!proxy.lastError!.message.includes('本地服务'));
  assert(!canRecoverLocalResponse(proxy.lastError,{canRecoverModelResponse:()=>true} as any));
 }finally{await proxy.close();}
});
