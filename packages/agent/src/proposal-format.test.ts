import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {taskRefSchema,permissionGrantSchema} from '../../contracts/src/agent.js';
import {proposalFormat} from './proposal-format.js';
import {researchProposalSchema,directPlan,bindProposal} from './research-planning.js';
const projectId=randomUUID(),conversationId=randomUUID();
const context={task:taskRefSchema.parse({projectId,conversationId,taskId:randomUUID()}),grant:permissionGrantSchema.parse({projectId,conversationId,grantId:randomUUID(),permissions:['read','search'],approvedBy:'local-user',maxCredits:null,maxSeconds:60}),methods:new Map([['engine.execute',[]],['research_data',['read','search']],['research_method_run',['read','patch','science']]] as const)};
const base=z.toJSONSchema(researchProposalSchema,{io:'input'});
test('proposal serialization repair is lossless and does not invent values or erase ambiguous fields',()=>{
  const input={goal:{constraints:{process:'below 50 °C',dataSources:[]},priorities:'strength',metrics:[]}};
  const result=proposalFormat(input,base) as any;
  assert.deepEqual(result.constraints,{process:['below 50 °C'],dataSources:[]});
  assert.deepEqual(result.goal.priorities,['strength']);assert(input.goal.constraints);
  const ambiguous={goal:{constraints:{process:[]}},constraints:{process:['original']}};
  assert.deepEqual(proposalFormat(ambiguous,base),ambiguous);
});
test('binding supplies host registry minimums but rejects dangling refs and permissions outside the grant',()=>{
  const p=directPlan('解释数据',context);
  const proposal:any={goal:p.goal,cognition:p.cognition,steps:p.steps,adjustmentRules:p.adjustmentRules,acceptance:p.acceptance,constraints:{process:[],dataSources:[]}};
  proposal.steps[0].method='research_data';proposal.steps[0].permissions=[];
  assert.deepEqual(bindProposal(proposal,'解释数据',context).steps[0]?.permissions,['read','search']);
  proposal.cognition.missing=[{id:'missing1',question:'required data',blocks:['missing1']}];
  assert.throws(()=>bindProposal(proposal,'解释数据',context),/missing1.*execute/);
  proposal.cognition.missing=[];proposal.steps[0].method='research_method_run';
  assert.throws(()=>bindProposal(proposal,'解释数据',context),/权限/);
});
test('source units label an unknown requested quantity, never invent a numeric threshold or convert a unit',()=>{
  const p=directPlan('解释数据',context);
  const proposal:any={goal:{...p.goal,metrics:[{name:'mean',value:null,unit:'MPa',condition:null,priority:0,origin:'user'}]},cognition:p.cognition,steps:p.steps,adjustmentRules:p.adjustmentRules,acceptance:p.acceptance,constraints:{process:[],dataSources:[]}};
  assert.throws(()=>bindProposal(proposal,'分析原单位的平均数',context),/单位/);
  assert.equal(bindProposal(proposal,'分析原单位的平均数',{...context,sourceUnits:['MPa']}).goal.metrics[0]?.value,null);
  proposal.goal.metrics[0].unit='GPa';assert.throws(()=>bindProposal(proposal,'分析原单位的平均数',{...context,sourceUnits:['MPa']}),/单位/);
  proposal.goal.metrics[0].unit='MPa';proposal.goal.metrics[0].value=100;
  assert.throws(()=>bindProposal(proposal,'分析原单位的平均数',{...context,sourceUnits:['MPa']}),/数值/);
});
test('an explicit input step supplies its dependency; self references and resulting cycles still fail',()=>{
 const p=directPlan('解释数据',context);
 const proposal:any={goal:p.goal,cognition:p.cognition,steps:[{...p.steps[0],id:'step1'}, {...p.steps[0],id:'step2',inputRefs:['step1']}],adjustmentRules:[],acceptance:p.acceptance,constraints:{process:[],dataSources:[]}};
 assert.deepEqual(bindProposal(proposal,'解释数据',context).steps[1]?.dependsOn,['step1']);
 proposal.steps[0].inputRefs=['step1'];assert.throws(()=>bindProposal(proposal,'解释数据',context),/step1.*自己/);
 proposal.steps[0].inputRefs=['step2'];assert.throws(()=>bindProposal(proposal,'解释数据',context),/循环/);
});

test('assessment-only methods cannot promise nonexistent files; a receipt step stays valid',()=>{
 const methods=new Map<string,readonly import('../../contracts/src/agent.js').Permission[]>(context.methods);methods.set('research_methods',['read','science']);const c={...context,grant:{...context.grant,permissions:[...context.grant.permissions,'science' as const]},methods},p=directPlan('筛选方法',c);
 const proposal:any={goal:p.goal,cognition:p.cognition,steps:[{...p.steps[0],method:'research_methods',expectedArtifacts:['JSON']}],adjustmentRules:[],acceptance:p.acceptance,constraints:{process:[],dataSources:[]}};
 assert.throws(()=>bindProposal(proposal,'筛选方法',c),/assessment receipt, not files/);proposal.steps[0].expectedArtifacts=[];assert.equal(bindProposal(proposal,'筛选方法',c).steps[0]!.method,'research_methods');
});
