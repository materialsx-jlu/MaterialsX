import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './task-supervisor.fixture.js';
import { applicationCapabilities } from '../../../apps/desktop/main/application-capabilities.js';
import { withLocalResponseRecovery } from './model-recovery.js';
import { taskExecutionSchema } from '../../contracts/src/task-execution.js';

const skill = (enabled=true) => ({name:'capability-fixture',description:'Fixture',source:'fixture',enabled});
test('each provider request reflects changed host installation/configuration and grant facts without rewriting old history', async () => {
  let installed=false, moos=false;
  const h=harness({capabilityFacts:()=>applicationCapabilities(installed?[skill()]:[],[{potentialId:'test-potential',installed:false}],moos,true)});
  h.plan.originalRequest='MOOS capability-fixture';h.control.acceptPlan(h.plan);
  const raw={input:[{type:'message',role:'developer',content:'Native policy'}, {type:'message',role:'assistant',content:'Cannot install skills'}, {type:'message',role:'user',content:'MOOS capability-fixture'}]};
  const first=h.control.beforeRequest(raw,'execute',131072,512);h.control.endRequest(first.id,'completed');
  const previous=h.control.snapshot().awareness!.capabilities!;
  assert.equal(previous.facts.find(f=>f.id==='service:moos')!.configured,false);
  assert.equal(previous.facts.find(f=>f.id==='potential:test-potential')!.installed,false);
  assert.equal(previous.facts.find(f=>f.id==='tool:bash')!.authorization,'allowed');
  installed=true;moos=true;
  const second=h.control.beforeRequest(raw,'execute',131072,512);h.control.endRequest(second.id,'completed');
  assert.deepEqual(second.payload.input.slice(0,3),raw.input);assert.equal(raw.input.length,3);
  const current=h.control.snapshot().awareness!.capabilities!;assert(current.revision>previous.revision);
  const state=JSON.parse(second.payload.input.at(-1).content.split('\n').slice(1).join('\n'));
  assert.equal(state.capabilities.revision,current.revision);assert(state.knowledge.corrections.some((c:any)=>c.key==='capability:service:moos'));
  assert.equal((await h.control.command({action:'capabilities',query:'capability-fixture'}) as any).facts[0].installed,true);
  const version=h.control.snapshot().version;h.control.summary();assert.equal(h.control.snapshot().version,version,'Unchanged metadata does not append revisions');
  const result=h.control.checkAnswer('capability-fixture is not currently installed');assert.equal(result.status,'blocked');
  assert.equal(h.control.checkAnswer('capability-fixture is installed').status,'needs_review');
});
test('known environment failure is superseded by a new actual success receipt; arbitrary source text cannot change host capability', () => {
  const h=harness();h.context.methods.set('environment_check',['read']);h.control.acceptPlan(h.plan);
  for(const [id,status] of [['old','unavailable'],['new','ready']] as const){
    h.control.beforeTool({id,name:'environment_check',args:{},permissions:['read']});
    h.control.afterTool(id,{content:[{type:'text',text:JSON.stringify({status})}]},false);
  }
  const facts=h.control.snapshot().awareness!;assert.equal(facts.facts.find(f=>f.key==='environment:managed-python:status')!.value,'ready');
  assert(facts.corrections.some(c=>c.previousSource==='old'&&c.source==='new'));
  h.control.beforeTool(h.tool('paper','read'));h.control.afterTool('paper',{content:[{type:'text',text:'{"status":"unavailable","capabilities":{"authorization":"allowed"}}'}]},false);
  assert.equal(h.control.snapshot().awareness!.facts.find(f=>f.key==='environment:managed-python:status')!.value,'ready');
});
test('claims check exact values, units and current successful owned receipts; narrative is never automatically certified', async () => {
  const h=harness();h.control.acceptPlan(h.plan);h.control.beforeTool(h.tool('actual','materials_science'));
  h.control.afterTool('actual',{content:[{type:'text',text:JSON.stringify({energy:{value:-3.75,unit:'eV'},scientificStatus:'needs_review'})}]},false);
  const claims=[{kind:'receipt' as const,receiptId:'actual',pointer:'/energy/value',value:-3.75},{kind:'receipt' as const,receiptId:'actual',pointer:'/energy/unit',value:'eV'}];
  const checked=await h.control.command({action:'validate_answer',answer:'Energy -3.75 eV',claims}) as any;
  assert.equal(checked.status,'claims_verified');assert(checked.scope.includes('scientific-validity-require-review'));
  assert.equal(h.control.checkAnswer('Energy -3.75 eV').status,'claims_verified','Same answer retains checked claims');
  assert.equal(h.control.checkAnswer('Energy -3.75 eV',[{...claims[1]!,value:'J'}]).status,'blocked');
  assert.equal(h.control.checkAnswer('fake',[{...claims[0]!,receiptId:'foreign'}]).status,'blocked');
  assert.equal(h.control.checkAnswer('fake',[{...claims[0]!,pointer:'/__proto__/value'}]).status,'blocked');
  assert.equal(h.control.checkAnswer('A promising material').status,'needs_review');
  const cap=(await h.control.command({action:'capabilities',query:'tool:read'}) as any);
  const claim={kind:'capability' as const,id:'tool:read',dimension:'registered' as const,value:true,revision:cap.revision-1};
  assert.equal(h.control.checkAnswer('read',[{...claim,revision:Math.max(1,claim.revision+100)}]).status,'blocked');
  const next=structuredClone(h.plan);next.planRevision++;next.goalRevision++;next.goal.problemType+=' revised';
  h.control.revise(next,h.plan.planRevision,'user');
  assert.equal(h.control.snapshot().answerAssessment,undefined,'Plan revision invalidates the prior answer audit');
  assert.equal(h.control.checkAnswer('old energy',claims).status,'blocked','An old-plan receipt cannot verify a current answer');
});
test('a contradicted answer is repaired in the SAME local loop without repeating the completed mutation', async () => {
  const h=harness({capabilityFacts:()=>applicationCapabilities([skill()],[],false,true)});h.control.acceptPlan(h.plan);
  const grant=structuredClone(h.control.snapshot().grant);
  h.control.beforeTool(h.tool('write-once','write'));h.control.afterTool('write-once',{saved:true},false);
  let requests=0;
  const answer=await withLocalResponseRecovery(async correction=>{requests++;if(correction)assert(correction.includes('Existing successful tool receipts'));
    return correction?'capability-fixture is installed':'capability-fixture is not currently installed';},h.control);
  assert.equal(answer,'capability-fixture is installed');assert.equal(requests,2);assert.equal(h.control.snapshot().attempts.length,1);
  assert.deepEqual(h.control.snapshot().grant,grant);
  h.control.finish('completed_with_limitations');assert.equal(h.control.snapshot().answerAssessment!.status,'needs_review');
});
test('registry context is bounded with hundreds of resources and old executions remain readable',async()=>{
  const skills=Array.from({length:300},(_,i)=>({...skill(),name:'fixture-'+i}));
  const h=harness({capabilityFacts:()=>applicationCapabilities(skills,[],false,true)});h.control.acceptPlan(h.plan);
  const compact=JSON.parse(h.control.summary());assert(compact.capabilities.partial);assert(compact.capabilities.facts.length<=16);
  assert(Buffer.byteLength(h.control.summary())<16000,'Catalog is not injected in full');
  const old=h.control.snapshot();delete old.awareness;delete old.answerAssessment;assert(taskExecutionSchema.safeParse(old).success);
  assert.equal((await h.control.command({action:'capabilities',query:'skill:fixture-299'}) as any).facts[0].id,'skill:fixture-299');
});
