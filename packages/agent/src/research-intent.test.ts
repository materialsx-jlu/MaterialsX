import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { advisoryQuestion, advisoryContent, recipeProposalFollowup, requestedRecipeCount } from './research-intent.js';
import { executionMode, prepareResearchPlan, directPlan, interpretationPrompt, interpretResearchPlan } from './research-planning.js';
import { PiEngine } from './pi-engine.js';
import { permissionGrantSchema, taskRefSchema } from '../../contracts/src/agent.js';

const task = taskRefSchema.parse({taskId:randomUUID(),projectId:randomUUID(),conversationId:randomUUID()});
const grant = permissionGrantSchema.parse({grantId:randomUUID(),projectId:task.projectId,conversationId:task.conversationId,permissions:['read','search'],approvedBy:'local-user',maxCredits:null,maxSeconds:60});
const context = {task,grant,methods:new Map([['engine.execute',[]],['read',['read']]] as const),inputVersions:[{id:'method-package:source-summary',version:'1.0.0',sha256:'a'.repeat(64)}]};

test('waterborne cooling-coating advice reaches the original engine without a brittle planning model turn', async () => {
  for (const text of ['如何设计 水性制冷涂料','如何设计水性制冷涂料','How can I design a waterborne cooling coating?']) {
    let executions=0;
    const engine=new PiEngine({capabilities:{kind:'pi',tools:context.methods,steer:false,resume:false,persistentHistory:false,sandbox:'none'},
      interpret:async()=>{throw Error('Advice must not invoke the planner');},cancel:()=>true,
      prompt:async input=>{executions++;assert(input.content.startsWith(text));assert(input.content.includes('Advisory scope'));return 'Design advice; no validated experimental result.';}});
    const result=await engine.run({task,grant,projectPath:'/tmp',content:text,onEvent:()=>{}});
    assert.equal(executions,1);assert.equal(result.state,'completed_with_limitations');assert.equal(result.scientificStatus,'needs_review');
    const plan=await prepareResearchPlan(text,context,async()=>{throw Error('Unexpected planner');});
    assert.equal(plan.steps[0]?.method,'engine.execute');assert.deepEqual(plan.acceptance.requiredArtifacts,[]);
    assert.deepEqual(plan.constraints.permissions,grant.permissions);
  }
});

test('advice routing never bypasses actual computations, searches, outputs, skills or numeric constraints', () => {
  for(const text of ['如何设计水性涂料，运行模拟','如何设计水性涂料，生成配方报告','如何设计水性涂料，比较已有数据','如何设计水性涂料，目标反射率 95%','如何设计实验','如何设计下一轮实验','如何设计涂料，搜索最新论文','如何设计 @materials-research-workbench 配方','How can I design a coating and run simulations?','How do I design a coating from selected measurements?','How do I design an experiment?']) assert.equal(advisoryQuestion(text),false,text);
});

test('frozen method-package IDs remain non-executable and targeted repair must choose a registered method', async () => {
  const prompt=interpretationPrompt('设计涂料并生成报告',context);
  assert(prompt.includes('frozen DATA/version references, NEVER executable methods'));
  const full=directPlan('解释水性涂料',context);
  const proposal={goal:full.goal,cognition:full.cognition,steps:full.steps,adjustmentRules:full.adjustmentRules,acceptance:full.acceptance,constraints:{process:[],dataSources:[]}};
  const bad=structuredClone(proposal);bad.steps[0]!.method='method-package:source-summary';let calls=0;
  const repaired=await interpretResearchPlan('设计涂料并生成报告',context,async repair=>{
    calls++;if(calls===1)return JSON.stringify(bad);
    assert(repair.includes('输入版本不能作为执行方法'));assert(repair.includes('cannot be methods'));
    return JSON.stringify(proposal);
  });
  assert.equal(calls,2);assert.equal(repaired.steps[0]?.method,'engine.execute');
  calls=0;await assert.rejects(interpretResearchPlan('设计涂料并生成报告',context,async()=>{calls++;return JSON.stringify(bad);}),/输入版本不能作为执行方法/);assert.equal(calls,2);
});

test('advisory scope distinguishes suggestions from measured results and leaves executable requests untouched',()=>{
 const advice=advisoryContent('如何设计水性制冷涂料');assert(advice.includes('不得编造'));assert(advice.includes('物理机制'));
 const action='运行材料模拟，生成 JSON';assert.equal(advisoryContent(action),action);
});
test('MOOS mixed requests retain the full goal and grant without a separate classification request',async()=>{
 for(const text of ['从 moos 中获取水性制冷涂料配方数据，允许本次读取待复核记录','从 MOOS 获取配方并优化工艺','分析 MOOS 配方性能数据并生成报告','Read MOOS recipes and suggest three formulation options']){
  const p=await prepareResearchPlan(text,{...context,interactivePlanning:true},async()=>{throw Error('Premature planner');});
  assert.equal(p.originalRequest,text);assert.equal(p.planningStage,'exploration');assert.deepEqual(p.constraints.permissions,grant.permissions);
  assert.equal(p.goal.problemType,text);assert.equal(p.steps[0]?.method,'engine.execute');
 }
});

test('bounded recipe follow-ups request real sources and proposals without an invented planning turn',async()=>{
 for(const text of ['基于上述配方，生成你建议的配方工艺','Based on the previous recipes, suggest a formulation and process']){
  assert(recipeProposalFollowup(text));assert.equal(executionMode(text),'direct');
  assert.match(advisoryContent(text),/read_current_recipes/);assert.match(advisoryContent(text),/Separate original facts/);
  assert.equal((await prepareResearchPlan(text,context,async()=>{throw Error('No unnecessary planning turn');})).executionMode,'direct');
 }
 for(const text of ['基于上述配方，建议运行模拟','基于上述配方，推荐并保存 JSON 文件','基于上述配方，建议下一轮实验设计','推荐一种配方'])assert(!recipeProposalFollowup(text),text);
});

test('negated measurements and operations do not turn an advisory question into execution',()=>{
 for(const text of ['如何设计水性辐射制冷涂料？只给文字建议，不创建文件、不虚构实测性能或论文来源。','如何设计涂料，不运行模拟，只给建议','How do I design a coating? Do not run simulations.'])assert(advisoryQuestion(text),text);
 for(const text of ['如何设计涂料，不虚构实测数据，但运行模拟','如何设计涂料，不运行模拟，但搜索论文','如何设计涂料，不创建文件，计算固含'])assert(!advisoryQuestion(text),text);
});

test('source-grounded proposals preserve bilingual counts and numeric targets without claiming computation',()=>{
 for(const [text,count] of [['基于上述配方，优化并推荐三种配方',3],['根据上述配方，提出三个建议方案',3],['基于上述配方，推荐三种不同的配方，不运行模拟、不创建文件',3],['Based on the previous recipes, suggest three different formulation options. Do not run simulations.',3],['Based on the previous recipes, suggest three formulation options',3],['基于上述配方，建议目标反射率95%的配方',1]] as const){
  assert(recipeProposalFollowup(text),text);assert.equal(requestedRecipeCount(text),count);assert.match(advisoryContent(text),new RegExp('Requested named proposals: '+count));
 }
 assert.equal(requestedRecipeCount('基于上述配方，推荐十种配方'),10);
 assert(!recipeProposalFollowup('基于上述配方，推荐十种配方'),'Do not silently clamp unsupported counts');
});

test('a negated quantity is not the required proposal count',()=>{
 assert.equal(requestedRecipeCount('不要三种配方，只给一种配方'),1);
 assert.equal(requestedRecipeCount('Not three recipes; give two proposals'),2);
});
