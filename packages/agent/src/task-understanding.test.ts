import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareResearchPlan,bindProposal} from './research-planning.js';
import {requestedGrant} from './request-limits.js';
import {harness} from './task-supervisor.fixture.js';
import type {ResearchGoalPlan} from '../../contracts/src/research-goal.js';
const proposal=(p:ResearchGoalPlan)=>({goal:p.goal,constraints:{process:p.constraints.process,dataSources:p.constraints.dataSources},cognition:p.cognition,steps:p.steps,adjustmentRules:p.adjustmentRules,acceptance:p.acceptance});
async function exploring(request='读取来源并比较三个配方；不要编造密度'){
 const h=harness();h.plan=await prepareResearchPlan(request,{...h.context,interactivePlanning:true},async()=>{throw Error('Independent interpreter forbidden');});
 h.control.acceptPlan(h.plan);return h;
}
function calculation(h:Awaited<ReturnType<typeof exploring>>){
 const p=proposal(h.plan);p.goal={...p.goal,problemType:'根据真实结构进行单点计算'};
 p.steps=[{...p.steps[0]!,id:'calculate' as any,method:'materials_science',expectedArtifacts:[],completionCriteria:['Verify the actual numeric result']}];
 p.cognition={...p.cognition,missing:[]};p.adjustmentRules=[];return p;
}
test('bilingual advice, negation, quantities and mixed intentions enter the same contextual loop without interpretation requests',async()=>{
 for(const request of ['如何设计反射率95%的水性涂料？只给建议','How can I design a coating with 95% reflectance? Advice only.',
 '不要执行模拟，先读取上述文件并比较方案','Do not run simulations; read the selected file and compare options.',
 '读取配方并提出三个方案','Read the recipes and propose three options','安装 Skill frontend-design','Can you install a Skill?',
 '执行最多3步固定晶胞弛豫，输出能量、受力和报告']){
  const h=await exploring(request);assert.equal(h.control.plan()?.planningStage,'exploration');assert.equal(h.control.snapshot().requests.length,0);
  assert.equal(h.control.originalRequest(),request);assert.match(JSON.parse(h.control.summary()).understanding,/relevant conversation history/);
  assert.deepEqual(h.control.snapshot().grant,h.context.grant);
 }
});
test('missing density limits conversion without blocking independent evidence reading',async()=>{
 const h=await exploring('比较10 wt%与10 vol%，不要直接等同，先读取来源');
 assert(h.plan.cognition.missing.length);assert.deepEqual(h.plan.cognition.missing[0]?.blocks,[]);
 h.control.beforeTool(h.tool('read-source','read'));h.control.afterTool('read-source',{units:['wt%'],density:null},false);
 assert.equal(h.control.snapshot().attempts[0]?.state,'completed');
 const p=calculation(h);p.steps.unshift({...p.steps[0]!,id:'inspect' as any,method:'read',permissions:['read'],expectedArtifacts:[]});
 const next=bindProposal(p,h.plan.originalRequest,{...h.context,previous:h.plan});
 assert.deepEqual(next.cognition.missing.at(-1)?.blocks,['calculate']);
});
test('calculation admission requires a real plan, while inspection and selection remain authorized',async()=>{
 const h=await exploring('检查结构然后计算');
 for(const action of ['inspect','auto_plan','select']){
  h.control.beforeTool(h.tool(action,'materials_science',{action}));h.control.afterTool(action,{inspected:true},false);
 }
 for(const action of ['singlepoint','relaxation','md','auto_run'])assert.throws(()=>h.control.beforeTool(h.tool(action,'materials_science',{action})),/PLAN_REQUIRED/);
 for(const method of ['research_method_run','experiment_analyze','next_experiment_design','research_subtask']){
  h.context.methods.set(method,['read']);assert.throws(()=>h.control.beforeTool({id:method,name:method,args:{},permissions:['read']}),/PLAN_REQUIRED/);
 }
 assert.equal(h.control.snapshot().attempts.length,3,'Denied calls must not execute or acquire receipts');
 assert.equal(h.control.snapshot().requests.length,0);
});
test('same-task plan submission preserves read receipts, deadline and identity; primary calculation still required',async()=>{
 const h=await exploring('读取真实结构，再计算能量');
 h.control.beforeTool(h.tool('source','read'));h.control.afterTool('source',{structureId:'actual'},false);
 const before=h.control.snapshot(),guide=await h.control.command({action:'plan'});
 assert.match(guide.instruction,/Methods and REQUIRED permissions/);assert.equal(h.control.snapshot().requests.length,0);
 await h.control.command({action:'plan',proposal:calculation(h)});
 const after=h.control.snapshot();assert.equal(h.control.plan()?.planningStage,'validated');assert.equal(after.planRevision,2);
 assert.deepEqual(after.task,before.task);assert.deepEqual(after.grant,before.grant);assert.equal(after.deadline,before.deadline);
 assert.equal(after.attempts[0]?.state,'completed');assert.equal(after.attempts[0]?.resultRef,before.attempts[0]?.resultRef);
 await assert.rejects(h.control.command({action:'complete',stepId:'calculate',expectedRevision:2,receiptIds:['source']}),/真实成功回执/);
 h.control.beforeTool(h.tool('compute','materials_science',{action:'singlepoint'}));h.control.afterTool('compute',{energyEv:-3},false);
 await assert.rejects(h.control.command({action:'complete',stepId:'calculate',expectedRevision:2,receiptIds:['compute']}),/No actual science job receipt/);
 assert.equal(h.control.snapshot().steps[0]?.state,'running');
 assert.deepEqual(h.control.plan()?.steps[0]?.expectedArtifacts,['JSON','报告','3D结构'],'A numeric receipt cannot omit the fixed backend output contract');
 await assert.rejects(h.control.command({action:'plan',proposal:calculation(h)}),/初始任务已解释/);
});
test('initial interpretation rejects lost artifacts, targets, facts, restrictions and fabricated confirmations',async()=>{
 for(const change of ['artifact','metric','fact','process','dataSource','confirmed'] as const){
  const h=harness();h.plan.planningStage='exploration';h.plan.acceptance.requiredArtifacts=['report.json'];
  h.plan.goal.metrics=[{name:'temperature',value:25,unit:'C',condition:null,priority:1,origin:'user'}];
  h.plan.constraints.process=['no simulation'];h.plan.constraints.dataSources=['approved sources only'];
  h.plan.cognition.facts=[{text:'Known user condition',evidence:[],confirmed:false}];h.control.acceptPlan(h.plan);
  const p=calculation(h);
  if(change==='artifact')p.acceptance={...p.acceptance,requiredArtifacts:[]};
  if(change==='metric')p.goal={...p.goal,metrics:[]};
  if(change==='fact')p.cognition={...p.cognition,facts:[]};
  if(change==='process')p.constraints={...p.constraints,process:[]};
  if(change==='dataSource')p.constraints={...p.constraints,dataSources:[]};
  if(change==='confirmed')p.cognition={...p.cognition,facts:[...p.cognition.facts,{text:'Imagined measurement',evidence:[],confirmed:true}]};
  // Use the admitted full contract here: target numeric binding has its own existing tests.
  const next={...h.plan,...p,goalRevision:2,planRevision:2,planningStage:'validated',constraints:{...h.plan.constraints,...p.constraints}};
  assert.throws(()=>h.control.revise(next,1,'engine'),/初始解释不能|不能放宽/,change);
  assert.equal(h.control.plan()?.planRevision,1);
 }
});
test('possible writes or unknown operations prevent reinterpreting the goal, not just replaying the command',async()=>{
 for(const pending of [false,true]){
  const h=await exploring();h.control.beforeTool(h.tool('write-attempt'));
  if(!pending)h.control.afterTool('write-attempt',{ok:true},false);
  await assert.rejects(h.control.command({action:'plan',proposal:calculation(h)}),/副作用/);
  assert.equal(h.control.snapshot().attempts.length,1);
 }
});
test('model revisions cannot reset exploration or expand narrowed permission, budget, time or source constraints',()=>{
 for(const field of ['permissions','maxCredits','maxSeconds','process','dataSources'] as const){
  const h=harness();h.plan.constraints={...h.plan.constraints,permissions:['read'],maxCredits:'1',maxSeconds:30,process:['read only'],dataSources:['selected source']};
  h.plan.steps[0]!.permissions=['read'];h.control.acceptPlan(h.plan);
  const next=structuredClone(h.plan);next.planRevision++;next.steps[0]!.completionCriteria=['Read and inspect'];
  if(field==='permissions')next.constraints.permissions.push('patch');
  if(field==='maxCredits')next.constraints.maxCredits='2';
  if(field==='maxSeconds')next.constraints.maxSeconds=60;
  if(field==='process')next.constraints.process=[];
  if(field==='dataSources')next.constraints.dataSources=[];
  assert.throws(()=>h.control.revise(next,1,'engine'),/不能放宽/);
 }
});
test('literal advice/no-simulation requests restrict mutations; target numbers do not become task budgets',()=>{
 const h=harness();
 for(const text of ['只给文字建议，不创建文件','Only provide advice','解释配方，不要模拟','Explain the formulation; do not run simulations']){
  const grant=requestedGrant(h.context.grant,text);assert(!grant.permissions.includes('science'));assert(grant.permissions.includes('read'));
 }
 const numerical=requestedGrant(h.context.grant,'设计95%反射率，固含50%，预算最多2积分，限时30秒');
 assert.equal(numerical.maxSeconds,30); // A null host credit limit never manufactures a new spending authority.
 assert.equal(numerical.maxCredits,null);
});

test('plan method discovery follows the current registry rather than the wording of the task',async()=>{
 const h=await exploring('继续处理选中的对象');h.context.methods.set('experiment_analyze',['read','science']);
 const guide=await h.control.command({action:'plan'});assert.match(guide.instruction,/experiment_analyze/);assert.match(guide.instruction,/materials_science/);
 h.context.methods.set('forbidden_upload',['network']);const narrowed=await h.control.command({action:'plan'});assert(!narrowed.instruction.includes('forbidden_upload'));
});
