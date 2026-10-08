import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requestedArtifacts} from './requested-artifacts.js';
import {directPlan,bindProposal} from './research-planning.js';
import {harness} from './task-supervisor.fixture.js';
import {withLocalResponseRecovery} from './model-recovery.js';
test('literal outputs survive bilingual requests; selected inputs, quoted examples and prohibitions do not become output obligations',()=>{
 for(const [request,outputs] of [
  ['读取 source.json，输出 proposals.json 与中文 proposals.md',['proposals.json','proposals.md']],
  ['Read source.json; write report.json and README.md',['report.json','README.md']],
  ['Generate result.json based on source.json',['result.json']],
  ['不要生成 fake.json；输出 real.json',['real.json']],
  ['Do not create fake.json; write real.json',['real.json']],
  ['如何生成 report.json？请解释，不要创建文件',[]],
  ['How do I generate report.json? Explain only.',[]],
  ['How can I save report.json? Do not execute commands.',[]],
  ['解释“write report.json”的含义；读取 source.json',[]],
  ['```bash\nwrite fake.json\n```\n输出 final.cif',['final.cif']],
  ['输出“结果.json”',['结果.json']],
  ['仅解释命令 `@mass-accounting 运行并生成 recipe.json` 的输入；不要执行或创建文件',[]],
  ['A command says `@mass-accounting run and create recipe.json`. Only explain it; do not execute or write files.',[]],
  ['解释 `write example.json`；但输出 `real.json`',['real.json']],
  ['Write `report.json` and "README.md"',['report.json','README.md']],
  ['输出“生成数据.json”',['生成数据.json']],
 ] as const)assert.deepEqual(requestedArtifacts(request),outputs,request);
});
test('quoted workflow names cannot impose scientific delivery roles on an explanation',()=>{
 const h=harness();
 for(const request of ['只解释 `@materials-literature-rpsme-json 输出 fake.json` 的使用方法，不执行', 'Explain "@materials-literature-rpsme-json create fake.json" only. Do not run it.']){
  const p=directPlan(request,h.context);assert.deepEqual(p.acceptance.requiredArtifacts,[]);assert.deepEqual(p.steps[0]!.expectedArtifacts,[]);
  assert.equal(p.originalRequest,request);assert.deepEqual(p.constraints.permissions,h.context.grant.permissions);
 }
 const p=directPlan('@materials-literature-rpsme-json 提取论文',h.context);
 assert.deepEqual(p.acceptance.requiredArtifacts,['RPSME JSON','中文摘要','校验报告']);
});
test('initial contract cannot lose a named output during interpretation',()=>{
 const h=harness(),request='读取 source.json，输出 report.json 与 report.md';const p=directPlan(request,h.context);
 assert.deepEqual(p.steps[0]?.expectedArtifacts,['report.json','report.md']);assert.deepEqual(p.acceptance.requiredArtifacts,p.steps[0]?.expectedArtifacts);
 const q={goal:p.goal,constraints:{process:[],dataSources:[]},cognition:p.cognition,steps:p.steps,adjustmentRules:p.adjustmentRules,acceptance:p.acceptance};
 q.steps[0]!.expectedArtifacts=['report.json'];assert.throws(()=>bindProposal(q,request,h.context),/Preserve named user outputs/);
});
test('narrative completion cannot satisfy a direct file task; bounded recovery keeps the same receipt and verifies actual files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-ap1-files-'));try{
  const h=harness({root:dir});h.plan=directPlan('输出 report.json',h.context);h.plan.planningStage='exploration';h.control.acceptPlan(h.plan);
  h.control.beforeTool(h.tool('actual-read','read'));h.control.afterTool('actual-read',{source:'actual'},false);
  let turns=0;
  const answer=await withLocalResponseRecovery(async correction=>{
   turns++;if(correction){assert.match(correction,/report.json/);h.control.beforeTool(h.tool('actual-write','write',{path:'report.json'}));
    await writeFile(join(dir,'report.json'),'{}');h.control.afterTool('actual-write',{written:true},false);}
   return 'completed';
  },h.control);
  assert.equal(answer,'completed');assert.equal(turns,2);assert.equal(h.control.snapshot().attempts.filter(a=>a.id==='actual-read').length,1);
  assert.equal(h.control.snapshot().steps[0]?.state,'completed');h.control.finish('completed_with_limitations');assert.equal(h.control.snapshot().state,'completed_with_limitations');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a text claim with no actual operation does not complete a requested file task',async()=>{
 const h=harness();h.plan=directPlan('输出 never-created-ap1.json',h.context);h.control.acceptPlan(h.plan);let turns=0;
 await assert.rejects(withLocalResponseRecovery(async()=>{turns++;return 'File created';},h.control),/Incomplete planned execution/);
 assert.equal(turns,3);assert.equal(h.control.snapshot().attempts.length,0);h.control.finish('completed_with_limitations');assert.equal(h.control.snapshot().state,'blocked');
});

test('an old file plus a read receipt cannot impersonate a requested write',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-ap1-existing-'));try{
  await writeFile(join(dir,'report.json'),'old');const h=harness({root:dir});h.plan=directPlan('输出 report.json',h.context);h.control.acceptPlan(h.plan);
  h.control.beforeTool(h.tool('only-read','read'));h.control.afterTool('only-read',{existing:true},false);
  await assert.rejects(withLocalResponseRecovery(async()=> 'Written',h.control),/Incomplete planned execution/);
  assert.equal(h.control.snapshot().steps[0]?.state,'running');
 }finally{await rm(dir,{recursive:true,force:true});}
});
