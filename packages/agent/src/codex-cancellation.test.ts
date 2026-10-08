import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CodexRpc} from './codex-rpc.js';
import {CodexEngine} from './codex-engine.js';

test('child exit during interrupt stays a cancelled request and disposal closes the proxy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mx-cancel-exit-'));
 let rpc:CodexRpc|undefined;
 try{
  const script=join(root,'child.cjs');
  await writeFile(script,`const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='turn/interrupt')process.exit(0);
if(m.id!==undefined)process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n');});\n`);
  rpc=new CodexRpc(process.execPath,root,root,{command:process.execPath,args:[script],temporary:root});
  await rpc.initialize();
  const diagnostics:any[]=[];
  const engine=new CodexEngine({home:root,maxOutput:4096,invoke:async()=>{throw Error('no model requests authorized');},onDiagnostic:e=>diagnostics.push(e)});
  const internal=engine as any;internal.rpc=rpc;
  internal.active={taskId:'task',threadId:'thread',turnId:'turn',cancelled:false};
  const requests=new AbortController();internal.requests=requests;
  let closed=0;internal.proxy={close:async()=>{closed++;}};
  assert.equal(await engine.cancel('task'),true);
  assert.equal(requests.signal.aborted,true);
  assert.equal(internal.active.cancelled,true);
  assert.equal(diagnostics.filter(e=>e.method==='runtime/interrupt-failed').length,1);
  await engine.dispose();assert.equal(closed,1);
  assert.equal(await engine.cancel('different-task'),false);
 }finally{await rpc?.close();await rm(root,{recursive:true,force:true});}
});
