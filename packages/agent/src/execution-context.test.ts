import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fitRequest, projectInstructions } from './execution-context.js';
test('compaction removes only closed old exchanges and retains user conditions/current evidence/tool schemas',()=>{
 const input={tools:[{name:'real_tool'}],messages:[{role:'system',content:'scope'},{role:'user',content:'temperature 300K'},
 {role:'assistant',content:'old'.repeat(3000),tool_calls:[{id:'a'}]},{role:'tool',tool_call_id:'a',content:'old'.repeat(3000)},
 {role:'user',content:'current scientific evidence'},{role:'assistant',content:'now'}]};
 const r=fitRequest(input,5000,100,'current goal and constraints');assert(r.compacted);
 const text=JSON.stringify(r.payload);assert(text.includes('300K'));assert(text.includes('current scientific evidence'));assert(!text.includes('tool_call_id'));assert(text.includes('real_tool'));assert(text.includes('checkpoint'));
 assert.equal(input.messages.length,6);assert.deepEqual(r,fitRequest(input,5000,100,'current goal and constraints'));
});
test('unpaired calls or results fail closed before model request',()=>{
 for(const messages of [[{role:'tool',tool_call_id:'missing',content:'invented'}],[{type:'function_call',call_id:'a',name:'read'}]])assert.throws(()=>fitRequest({messages},10000,100,'goal'),/工具结果/);
});
test('current evidence is never truncated just to fit window',()=>{
 assert.throws(()=>fitRequest({input:[{role:'user',content:'evidence'.repeat(2000)}]},4096,1024,'scope'),/窗口/);
});
test('overhead and output reservation included; snapshot replacement is idempotent',()=>{
 const a=fitRequest({messages:[{role:'user',content:'conditions'}]},5000,100,'one');const b=fitRequest(a.payload,5000,100,'two');
 assert.equal(b.payload.messages.filter((m:any)=>m.role==='developer').length,1);assert(b.inputUpperBound>=1024);
});
test('changing authoritative state preserves the native prefix and closed evidence for local prompt reuse',()=>{
 for(const key of ['input','messages']){
  const history=key==='input'?[{type:'message',role:'developer',content:'native scope'}, {type:'message',role:'user',content:'original constraints'},
   {type:'function_call',name:'read',call_id:'actual',arguments:'{}'}, {type:'function_call_output',call_id:'actual',output:'actual evidence'}]:
   [{role:'system',content:'native scope'},{role:'user',content:'original constraints'},
    {role:'assistant',content:null,tool_calls:[{id:'actual',function:{name:'read',arguments:'{}'}}]}, {role:'tool',tool_call_id:'actual',content:'actual evidence'}];
  const input={[key]:history,tools:[{name:'read',parameters:{type:'object'}}]};
  const a=fitRequest(input,10000,100,'old grant');const b=fitRequest(a.payload,10000,100,'current grant');
  assert.deepEqual(b.payload[key].slice(0,-1),history);assert.deepEqual(b.payload.tools,input.tools);
  assert.equal(b.payload[key].at(-1).content,'MaterialsX current task state:\ncurrent grant');
  assert(!JSON.stringify(b.payload).includes('old grant'));assert.deepEqual(input[key],history);
 }
});
test('project guidance respects read grant and project realpath boundary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ua3-guide-'));try{
 const project=join(root,'project');await mkdir(project);await writeFile(join(project,'AGENTS.md'),'Project-only guidance');await writeFile(join(root,'AGENTS.md'),'OUTSIDE');
 assert.equal(await projectInstructions(project,[]),'');const text=await projectInstructions(project,['read']);assert(text.includes('Project-only'));assert(!text.includes('OUTSIDE'));
 await mkdir(join(project,'.materialsx'));await symlink(join(root,'AGENTS.md'),join(project,'.materialsx','AGENTS.md'));await assert.rejects(projectInstructions(project,['read']),/越过/);
 }finally{await rm(root,{recursive:true,force:true});}
});
