import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AgentError} from '../../contracts/src/agent.js';
import {withLocalResponseRecovery} from './model-recovery.js';
import {initialResearchTools} from './research-tools.js';
import type {ExecutionControl} from './execution-control.js';

const control=(allowed=true)=>({canRecoverModelResponse:()=>allowed,summary:()=>JSON.stringify({execution:{receipts:[{id:'actual-download',state:'completed'}]}})}) as ExecutionControl;
test('format repair continues original session with owned receipts and at most two corrections',async()=>{
  let requests=0;const corrections:string[]=[];
  const result=await withLocalResponseRecovery(async correction=>{
    requests++;if(requests<3)throw new AgentError('PROTOCOL_ERROR','Tool arguments do not match schema: reason is required');
    corrections.push(correction!);return 'real-export.bib';
  },control());
  assert.equal(result,'real-export.bib');assert.equal(requests,3);assert.match(corrections[0]!,/actual-download/);
  requests=0;await assert.rejects(withLocalResponseRecovery(async()=>{requests++;throw new AgentError('PROTOCOL_ERROR','Incomplete model response');},control()));assert.equal(requests,3);
});
test('unknown mutation, cloud/no admission, exhausted budget, cancellation and non-format failures do not retry',async()=>{
  for(const [error,guard] of [[new AgentError('PROTOCOL_ERROR','Incomplete tool arguments'),control(false)],
    [new AgentError('PROTOCOL_ERROR','Incomplete tool arguments'),undefined],
    [new AgentError('BUDGET_EXCEEDED','Incomplete model response'),control()],
    [new AgentError('CANCELLED','Incomplete model response'),control()],
    [new AgentError('PROTOCOL_ERROR','Response model changed'),control()]] as const){
    let requests=0;await assert.rejects(withLocalResponseRecovery(async()=>{requests++;throw error;},guard));assert.equal(requests,1);
  }
});
test('domain tools retain plan methods while unrelated tools remain discoverable',()=>{
  const paper=initialResearchTools('查找论文并导出 BibTeX');assert(paper.has('paper_read'));assert(!paper.has('research_method_run'));
  const data=initialResearchTools('比较 MOOS 的实测配方',['materials_science']);assert(data.has('research_data'));assert(data.has('materials_science'));assert(!data.has('paper_read'));
  assert(initialResearchTools('显示平均数').has('research_method_run'));assert(initialResearchTools('show the average').has('research_quality'));
});
test('a rejected step mismatch uses the original bounded recovery without relaxing permissions or replaying tools',async()=>{
 const rejected=new AgentError('INVALID_PLAN','依赖尚未完成：Use the actual task_control candidate: [{"action":"begin","stepId":"source-check"}]');
 let calls=0;assert.equal(await withLocalResponseRecovery(async correction=>{calls++;if(calls===1)throw rejected;assert.match(correction!,/source-check/);assert.match(correction!,/actual-download/);return 'same task';},control()),'same task');assert.equal(calls,2);
 for(const [error,guard] of [[rejected,control(false)],[rejected,undefined],[new AgentError('INVALID_PLAN','cyclic dependency'),control()],[new AgentError('PERMISSION_DENIED',rejected.message),control()]] as const){calls=0;await assert.rejects(withLocalResponseRecovery(async()=>{calls++;throw error;},guard));assert.equal(calls,1);}
 calls=0;await assert.rejects(withLocalResponseRecovery(async()=>{calls++;throw rejected;},control()));assert.equal(calls,3);
});
test('premature planned replies get bounded continuation in the same loop; completed mutations are not replayed',async()=>{
 let completed=false,calls=0;
 const c={canRecoverModelResponse:()=>true,summary:()=>JSON.stringify({goal:{executionMode:'planned'},execution:{state:'running',readySteps:completed?[]:['step2'],steps:[{id:'step2',state:completed?'completed':'running'}],receipts:[{id:'actual-calculation',state:'completed'}]}})} as ExecutionControl;
 const text=await withLocalResponseRecovery(async correction=>{calls++;if(correction){assert.match(correction,/actual-calculation/);assert.match(correction,/Incomplete planned execution/);completed=true;}return 'finished';},c);
 assert.equal(text,'finished');assert.equal(calls,2);
 completed=false;calls=0;await assert.rejects(withLocalResponseRecovery(async()=>{calls++;return 'premature';},c),/Incomplete planned execution/);assert.equal(calls,3);
 const stopped={...c,canRecoverModelResponse:()=>false};calls=0;await assert.rejects(withLocalResponseRecovery(async()=>{calls++;return 'premature';},stopped));assert.equal(calls,1);
 const explanation={...c,summary:()=>JSON.stringify({goal:{executionMode:'planned',steps:[{id:'step1',method:'engine.execute',expectedArtifacts:[]}]},execution:{state:'running',readySteps:['step1'],steps:[{id:'step1',state:'pending'}]}})};
 calls=0;assert.equal(await withLocalResponseRecovery(async()=>{calls++;return 'bounded explanation';},explanation),'bounded explanation');assert.equal(calls,1);
});
test('only newly verified completed stages reopen two corrections; read/control metadata does not',async()=>{
 let calls=0,steps:Array<{id:string;state:string}>=[];
 const c={canRecoverModelResponse:()=>true,summary:()=>JSON.stringify({execution:{steps}})} as ExecutionControl;
 assert.equal(await withLocalResponseRecovery(async()=>{
   calls++;if(calls===3)steps=[{id:'stage1',state:'completed'}];if(calls<5)throw new AgentError('PROTOCOL_ERROR','Incomplete tool arguments');return 'stage2 done';
 },c),'stage2 done');assert.equal(calls,5);
 calls=0;steps=[];await assert.rejects(withLocalResponseRecovery(async()=>{
   calls++;steps=[{id:'still-running',state:'running',...{extraReadVersion:calls}}];throw new AgentError('PROTOCOL_ERROR','Incomplete tool arguments');
 },c));assert.equal(calls,3);
});
test('verified native duplicate continues by receipt without replay; unknown/conflicting operations remain blocked',async()=>{
 const duplicate=new AgentError('CONFLICT','该原生操作已有真实回执；未重复执行');
 let calls=0;
 assert.equal(await withLocalResponseRecovery(async correction=>{
  calls++;if(!correction)throw duplicate;
  assert.match(correction,/actual-download/);assert.match(correction,/do not repeat their mutations/);
  return 'inspected existing receipt';
 },control()),'inspected existing receipt');
 assert.equal(calls,2);
 for(const [error,guard] of [[duplicate,control(false)],[duplicate,undefined],
  [new AgentError('CONFLICT','同一操作仍在运行或回执未知；先查询真实状态，不重复提交'),control()],
  [new AgentError('CONFLICT','工具调用 ID 被用于不同输入'),control()]] as const){
   calls=0;await assert.rejects(withLocalResponseRecovery(async()=>{calls++;throw error;},guard));assert.equal(calls,1);
 }
 calls=0;await assert.rejects(withLocalResponseRecovery(async()=>{calls++;throw duplicate;},control()));assert.equal(calls,3);
});
