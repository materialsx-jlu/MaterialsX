import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bindProposal, directPlan, interpretationPrompt, interpretResearchPlan,prepareResearchPlan } from './research-planning.js';
import {boundedAtomicProposal} from './bounded-atomic-plan.js';
import type { PlanContext } from '../../contracts/src/research-goal.js';
import {taskRefSchema} from '../../contracts/src/agent.js';
const projectId=randomUUID(),conversationId=randomUUID();
const context:PlanContext={task:taskRefSchema.parse({projectId,conversationId,taskId:randomUUID()}),grant:{projectId,conversationId,grantId:randomUUID(),permissions:['science'],approvedBy:'local-user',maxSeconds:60,maxCredits:null},methods:new Map([['engine.execute',[]],['materials_science',['science']]])};
const request='自动选择合适的机器学习势，优先使用已安装模型，执行最多 3 步固定晶胞弛豫，输出能量、原子受力、收敛状态、报告和 3D 结构。';
function proposal(name='能量',unit='eV',value:number|null=null){
  const p=directPlan(request,context);
  return {goal:{...p.goal,metrics:[{name,unit,value,condition:null,priority:0,origin:'user'}]},cognition:p.cognition,steps:[{...p.steps[0]!,method:'materials_science',permissions:['science']}],constraints:{process:[],dataSources:[]},adjustmentRules:p.adjustmentRules,acceptance:p.acceptance};
}
test('the reported exact request accepts native unknown energy/forces in the first interpretation',async()=>{
  let calls=0;
  const plan=await interpretResearchPlan(request,context,async()=>{calls++;return JSON.stringify(proposal());});
  assert.equal(calls,1);assert.equal(plan.goal.metrics[0]!.value,null);assert.equal(plan.goal.metrics[0]!.unit,'eV');
  assert.equal(bindProposal(proposal('原子受力','eV/Å'),request,context).goal.metrics[0]!.unit,'eV/Å');
  assert.equal(bindProposal(proposal('total energy','eV'),'Choose a potential and report energy and forces',context).goal.metrics[0]!.unit,'eV');
  assert(interpretationPrompt(request,context).includes('NOT target thresholds'));
});
test('an explicit fixed-cell bounded atomic workflow reuses one registered backend step without model plan generation',async()=>{
  const text=request+' 结构 ID：'+randomUUID();let calls=0;
  const plan=await prepareResearchPlan(text,context,async()=>{calls++;throw Error('Unexpected interpretation');});
  assert.equal(calls,0);assert.equal(plan.executionMode,'planned');assert.equal(plan.steps.length,1);assert.equal(plan.steps[0]!.method,'materials_science');
  assert.deepEqual(plan.steps[0]!.expectedArtifacts,['JSON','报告','3D结构']);assert.equal(plan.originalRequest,text);assert(plan.goal.metrics.every(m=>m.value===null));
  for(const unsupported of [request,text.replace('最多 3 步','最多 300 步'),text.replace('固定晶胞','可变晶胞'),text+'然后对比两种势',text.replace('最多 3 步','展示 3D')])assert.equal(boundedAtomicProposal(unsupported,context),null);
  assert.equal(boundedAtomicProposal(text,{...context,grant:{...context.grant,permissions:[]}}),null);
});
test('native outputs never invent thresholds, convert units or supply unrequested quantities',()=>{
  for(const p of [proposal('能量','eV',3),proposal('能量','MeV'),proposal('能量','meV'),proposal('电导率','eV'),proposal('应力','GPa')])
    assert.throws(()=>bindProposal(p,request,context),/单位/);
  assert.throws(()=>bindProposal(proposal('能量','eV',100),request,context),/数值/);
  assert.throws(()=>bindProposal(proposal(),request,{...context,methods:new Map([['engine.execute',[]]])}),/方法|单位/);
  assert.throws(()=>bindProposal(proposal(),request,{...context,grant:{...context.grant,permissions:[]}}),/单位|权限/);
  assert.throws(()=>bindProposal(proposal('energy','eV'),'分析热导率',context),/单位/);
});
