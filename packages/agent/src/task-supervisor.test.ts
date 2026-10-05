import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskSupervisor } from './task-supervisor.js';
import { directPlan } from './research-planning.js';
import type { ResearchGoalPlan } from '../../contracts/src/research-goal.js';
import {assessMethods} from './method-registry.js';
import {scientificFixture} from '../../../tests/fixtures/agent/ua7-source.js';
import {harness} from './task-supervisor.fixture.js';
function accept(){const h=harness();h.control.acceptPlan(h.plan);return h;}
test('a planned calculation admits its registered prerequisite but cannot complete on prerequisite receipts alone',async()=>{
 const h=harness();h.plan.executionMode='planned';h.plan.adjustmentRules=[];
 h.context.methods.set('research_method_run',['read','science','patch']);h.context.methods.set('research_methods',['read','science']);
 h.plan.steps[0]!.method='research_method_run';h.plan.steps[0]!.permissions=['read','science','patch'];h.control.acceptPlan(h.plan);
 h.control.beforeTool({id:'assess',name:'research_methods',args:{action:'assess'},permissions:['read','science']});h.control.afterTool('assess',{id:'actual-assessment'},false);
 await assert.rejects(h.control.command({action:'complete',stepId:'execute',expectedRevision:1,receiptIds:['assess']}),/主要方法/);
 assert.throws(()=>h.control.beforeTool({id:'unrelated',name:'paper_fetch',args:{},permissions:['read','patch']}),/依赖/);
 h.control.beforeTool({id:'calculate',name:'research_method_run',args:{assessmentId:'actual-assessment'},permissions:['read','science','patch']});h.control.afterTool('calculate',{actual:true},false);
 await h.control.command({action:'complete',stepId:'execute',expectedRevision:1,receiptIds:['assess','calculate']});assert.equal(h.control.snapshot().steps[0]?.state,'completed');
 const denied=harness();denied.context.methods.set('research_method_run',['read']);denied.plan.steps[0]!.method='research_method_run';denied.plan.steps[0]!.permissions=['read'];denied.control.acceptPlan(denied.plan);
 assert.throws(()=>denied.control.beforeTool({id:'outside-step-grant',name:'research_methods',args:{},permissions:['science']}),/授权/);
});
test('planned control candidates use real owned IDs, never accept automatically or bypass unresolved operations',async()=>{
 const h=harness();h.plan.executionMode='planned';h.control.acceptPlan(h.plan);
 assert.deepEqual(JSON.parse(h.control.summary()).execution.controlCandidates,[{action:'begin',stepId:'execute',expectedRevision:1}]);
 h.control.beforeTool(h.tool('actual-read','read'));assert.deepEqual(JSON.parse(h.control.summary()).execution.controlCandidates,[]);
 h.control.afterTool('actual-read',{actual:'value'},false);
 assert.deepEqual(await h.control.verifyBackendSteps(),[]);
 assert.deepEqual(JSON.parse(h.control.summary()).execution.controlCandidates,[{action:'complete',stepId:'execute',expectedRevision:1,receiptIds:['actual-read']}]);
 assert.equal(h.control.snapshot().steps[0]?.state,'running');
 await h.control.command({action:'complete',stepId:'execute',expectedRevision:1,receiptIds:['actual-read']});
 assert.equal(h.control.snapshot().steps[0]?.state,'completed');
 assert.match(JSON.parse(h.control.summary()).policy,/All planned steps are verified complete/);
 assert.throws(()=>h.control.beforeTool(h.tool('unplanned-read','read')),/依赖/);
});
test('an acceptance artifact with no verified completed step prevents completion',()=>{
 const h=harness();h.plan.acceptance.requiredArtifacts=['missing.json'];h.control.acceptPlan(h.plan);
 h.control.finish('completed_with_limitations');assert.equal(h.control.snapshot().state,'blocked');assert.match(h.control.snapshot().reason!,/missing.json/);
});
test('local model response recovery checks all original attempts/jobs and never permits a cloud retry',()=>{
 const h=accept();assert(h.control.canRecoverModelResponse());h.control.beforeTool(h.tool('unknown'));assert(!h.control.canRecoverModelResponse());
 h.control.afterTool('unknown',{ok:true},false);assert(h.control.canRecoverModelResponse());h.tick(60000);assert(!h.control.canRecoverModelResponse());
 const cloud=harness({account:'platform'});cloud.control.acceptPlan(cloud.plan);assert(!cloud.control.canRecoverModelResponse());
 const job=accept();job.control.beforeTool(job.tool('submit','materials_science'));job.control.afterTool('submit',{runId:'pending',status:'running'},false);assert(!job.control.canRecoverModelResponse());
});
test('admission persists before execution, stable argument order and cached mutation do not reexecute',()=>{
 const h=accept();h.control.beforeTool(h.tool('one','bash',{a:1,b:2}));assert.equal(h.events.at(-1)?.state,'running');h.control.afterTool('one',{ok:true},false);
 assert.deepEqual(h.control.beforeTool(h.tool('two','bash',{b:2,a:1})),{ok:true});assert.equal(h.control.snapshot().attempts.length,1);
});
test('unknown mutations block repeats, fresh read operations are allowed',()=>{
 const h=accept();h.control.beforeTool(h.tool('one'));assert.throws(()=>h.control.beforeTool(h.tool('two')),/回执未知/);
 h.control.beforeTool(h.tool('read1','read'));h.control.afterTool('read1','first',false);h.control.beforeTool(h.tool('read2','read'));
});
test('at most initial execution and two failed corrections per step',()=>{
 const h=accept();for(let i=0;i<3;i++){h.control.beforeTool(h.tool('try'+i,'bash',{command:'fix'+i}));h.control.afterTool('try'+i,{error:'failure'},true);}
 assert.throws(()=>h.control.beforeTool(h.tool('four')),/两次纠错/);assert(h.control.snapshot().attempts.every(a=>a.errorFingerprint));
 const next=structuredClone(h.plan);next.planRevision++;assert.throws(()=>h.control.revise(next,1,'engine'),/实际改变/);
});
test('effective method change invalidates failed attempts and permits bounded corrections',()=>{
 const h=accept();h.control.beforeTool(h.tool('try'));h.control.afterTool('try','bad',true);
 const next=structuredClone(h.plan);next.planRevision++;next.steps[0]!.method='write';next.steps[0]!.permissions=['patch'];
 h.control.revise(next,1,'engine');assert.equal(h.control.snapshot().attempts[0]?.state,'stale');h.control.beforeTool(h.tool('new','write'));
});
test('permissions, method availability and dependency checks happen before tools',async()=>{
 const h=harness();const p=h.plan;p.executionMode='planned';p.steps=[{...p.steps[0]!,id:'first' as any,method:'read',permissions:['read']},{...p.steps[0]!,id:'second' as any,method:'bash',permissions:['terminal'],dependsOn:['first' as any]}];
 p.adjustmentRules=[];h.control.acceptPlan(p);assert.throws(()=>h.control.beforeTool(h.tool('early')),/依赖/);h.control.beforeTool(h.tool('read1','read'));h.control.afterTool('read1','actual',false);
 await h.control.command({action:'complete',stepId:'first',expectedRevision:1,receiptIds:['read1']});h.control.beforeTool(h.tool('after'));
});
test('missing data blocks one branch but independent authorized work continues',()=>{
 const h=harness();h.plan.executionMode='planned';h.plan.steps=[{...h.plan.steps[0]!,id:'missing' as any,method:'bash',permissions:['terminal']},{...h.plan.steps[0]!,id:'independent' as any,method:'read',permissions:['read']}];
 h.plan.adjustmentRules=[];h.plan.cognition.missing=[{id:'condition' as any,question:'输入载荷',blocks:['missing' as any]}];h.control.acceptPlan(h.plan);
 h.control.beforeTool(h.tool('safe','read'));assert.equal(h.control.snapshot().activeStepId,'independent');assert.throws(()=>h.control.beforeTool(h.tool('unsafe')),/依赖/);
});
test('stale plan version cannot overwrite goal; engine cannot alter user acceptance',()=>{
 const h=accept(),p=structuredClone(h.plan);p.planRevision++;assert.throws(()=>h.control.revise(p,9,'user'),/版本/);
 p.acceptance.criteria=['forged'];assert.throws(()=>h.control.revise(p,1,'engine'),/验收/);
});
test('input version updates invalidate affected descendants only',async()=>{
 const h=harness();
 const p=h.plan;p.executionMode='planned';p.steps=[{...p.steps[0]!,id:'a' as any,method:'read',permissions:['read'],inputRefs:[]},{...p.steps[0]!,id:'b' as any,method:'read',permissions:['read'],inputRefs:[h.task.taskId]},{...p.steps[0]!,id:'c' as any,method:'read',permissions:['read'],dependsOn:['b' as any],inputRefs:['b']}];
 p.adjustmentRules=[];h.control.acceptPlan(p);await h.control.command({action:'begin',stepId:'a',expectedRevision:1});h.control.beforeTool(h.tool('read-a','read'));h.control.afterTool('read-a','safe',false);
 await h.control.command({action:'complete',stepId:'a',expectedRevision:1,receiptIds:['read-a']});
 const next=structuredClone(p);next.goalRevision++;next.planRevision++;next.goal.problemType='新目标';next.originalRequest='新目标';h.control.revise(next,1,'user');
 assert.equal(h.control.snapshot().steps[0]?.state,'completed');assert.equal(h.control.snapshot().steps[1]?.state,'pending');
});
test('running jobs prevent revision and completion until real terminal query',async()=>{
 const h=accept();h.control.beforeTool(h.tool('submit','materials_science',{action:'run'}));h.control.afterTool('submit',{runId:'job1',status:'running'},false);
 const p=structuredClone(h.plan);p.planRevision++;assert.throws(()=>h.control.revise(p,1,'user'),/核实在途/);
 await assert.rejects(h.control.command({action:'complete',stepId:h.plan.steps[0]!.id,expectedRevision:1,receiptIds:['submit']}),/终态/);
 h.control.reconcileJobs([{id:'job1',state:'completed'}]);await h.control.command({action:'complete',stepId:h.plan.steps[0]!.id,expectedRevision:1,receiptIds:['submit']});
});
test('cancel retains unknown operations; late result cannot mark task completed',()=>{
 const h=accept();h.control.beforeTool(h.tool('pending'));h.control.finish('cancelled');assert.equal(h.control.snapshot().attempts[0]?.state,'unknown');
 assert.throws(()=>h.control.resume(),/回执尚未确认/);assert.throws(()=>h.control.afterTool('pending','late',false),/终态/);assert.equal(h.control.snapshot().state,'cancelled');
});
test('resume retains time and request budgets, identity and journal revisions',()=>{
 const h=accept();const r=h.control.beforeRequest({messages:[{role:'user',content:'condition'}]},'execute',5000,100);h.control.endRequest(r.id,'completed');h.control.finish('failed');h.control.resume();
 assert.equal(h.control.snapshot().startedAt,1000);assert.equal(h.control.snapshot().requests.length,1);h.tick(60000);assert.throws(()=>h.control.beforeTool(h.tool('late')),/时间/);
});
test('request count and duplicate request ids are bounded',()=>{
 const h=accept();for(let i=0;i<32;i++){const r=h.control.beforeRequest({messages:[{role:'user',content:'test'}]},'execute',5000,10,String(i));h.control.endRequest(r.id,'completed');}
 assert.throws(()=>h.control.beforeRequest({messages:[]},'execute',5000,10),/请求达到/);
});
test('old request completion cannot complete a newly revised goal',()=>{
 const h=accept();const r=h.control.beforeRequest({messages:[{role:'user',content:'test'}]},'execute',5000,10);
 const p=structuredClone(h.plan);p.planRevision++;p.goalRevision++;p.goal.problemType='changed';p.originalRequest='changed';h.control.revise(p,1,'user');h.control.endRequest(r.id,'completed');h.control.finish('completed_with_limitations');
 assert.equal(h.control.snapshot().state,'blocked');assert.match(h.control.snapshot().reason!,/旧计划/);
});
test('required artifacts must actually exist within project; bytes use true SHA256',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ua3-artifact-'));try{
 const h=harness({root});h.plan.steps[0]!.expectedArtifacts=['output.json'];h.control.acceptPlan(h.plan);h.control.beforeTool(h.tool('write'));h.control.afterTool('write','actual',false);
 const args={action:'complete',stepId:h.plan.steps[0]!.id,expectedRevision:1,receiptIds:['write']};await assert.rejects(h.control.command(args),/产物缺失/);
 await writeFile(join(root,'output.json'),'real');await h.control.command(args);
 assert([...h.results.values()].some((r:any)=>r.sha256===createHash('sha256').update('real').digest('hex')));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('duplicate terminal receipts are ignored only when identical',()=>{
 const h=accept();h.control.beforeTool(h.tool('one'));h.control.afterTool('one',{ok:true},false);h.control.afterTool('one',{ok:true},false);
 assert.throws(()=>h.control.afterTool('one',{ok:false},false),/终态/);
});
test('read-only job queries are fresh, pending jobs forbid another submission',()=>{
 const h=accept();h.control.beforeTool(h.tool('submit','materials_science',{action:'run'}));h.control.afterTool('submit',{runId:'job',status:'queued'},false);
 assert.throws(()=>h.control.beforeTool(h.tool('other','materials_science',{action:'run',potential:'different'})),/在途计算/);
 const query={id:'get1',name:'get_atomistic_job',args:{runId:'job'},permissions:['science'] as const};h.control.beforeTool(query);h.control.afterTool('get1',{job:{id:'job',status:'running'}},false);
 assert.equal(h.control.beforeTool({...query,id:'get2'}),undefined);
 const failed=accept();for(let i=0;i<3;i++){failed.control.beforeTool(failed.tool('job'+i,'materials_science',{action:'run',input:i}));failed.control.afterTool('job'+i,{runId:'j'+i,status:'failed'},false);}
 assert.throws(()=>failed.control.beforeTool(failed.tool('job4','materials_science',{action:'run',input:4})),/两次纠错/);
});
test('scoped conflicts preserve an independent branch; unscoped conflicts remain conservative',()=>{
 const h=harness();h.plan.executionMode='planned';h.plan.adjustmentRules=[];h.plan.steps=[{...h.plan.steps[0]!,id:'a' as any,method:'bash',permissions:['terminal']},{...h.plan.steps[0]!,id:'b' as any,method:'read',permissions:['read']}];
 h.plan.cognition.conflicts=['矛盾载荷'];h.plan.cognition.conflictScopes=[{conflictIndex:0,blocks:['a' as any]}];h.control.acceptPlan(h.plan);h.control.beforeTool(h.tool('safe','read'));
 assert.throws(()=>h.control.beforeTool(h.tool('unsafe')),/依赖/);
});
test('host-approved source update invalidates affected descendants while keeping independent receipt',async()=>{
 const h=harness();const old={id:'source',version:'one',sha256:'a'.repeat(64)};
 (h.context as any).inputVersions=[old];h.plan.inputVersionRefs=[old];h.plan.executionMode='planned';h.plan.adjustmentRules=[];
 h.plan.steps=[{...h.plan.steps[0]!,id:'source-step' as any,inputRefs:['source'],method:'read',permissions:['read']},{...h.plan.steps[0]!,id:'independent' as any,inputRefs:[],method:'read',permissions:['read']},{...h.plan.steps[0]!,id:'dependent' as any,inputRefs:['source-step'],dependsOn:['source-step' as any],method:'read',permissions:['read']}];h.control.acceptPlan(h.plan);
 await h.control.command({action:'begin',stepId:'independent',expectedRevision:1});h.control.beforeTool(h.tool('independent-call','read'));h.control.afterTool('independent-call','real',false);
 await h.control.command({action:'complete',stepId:'independent',expectedRevision:1,receiptIds:['independent-call']});
 const next=structuredClone(h.plan);next.planRevision++;next.inputVersionRefs=[{...old,version:'two',sha256:'b'.repeat(64)}];
 assert.throws(()=>h.control.revise(next,1,'engine'),/输入版本/);h.control.revise(next,1,'user',next.inputVersionRefs);
 assert.equal(h.control.snapshot().steps[1]?.state,'completed');assert.equal(h.control.snapshot().attempts[0]?.state,'completed');
 assert.equal(h.control.snapshot().steps[0]?.state,'pending');assert.equal(h.control.snapshot().steps[2]?.state,'pending');
});
test('first delta latency is captured once and missing usage stays unknown',()=>{
 const h=accept(),r=h.control.beforeRequest({messages:[{role:'user',content:'test'}]},'execute',5000,100);
 h.tick(25);h.control.firstToken(r.id);h.tick(25);h.control.firstToken(r.id);h.control.endRequest(r.id,'completed');
 assert.equal(h.control.snapshot().requests[0]?.firstTokenAt,1025);assert.equal(h.control.snapshot().requests[0]?.usage,null);
});
test('completion after deadline is failure, never silently relaxes task acceptance',()=>{
 const h=accept();h.tick(60001);h.control.finish('completed_with_limitations');assert.equal(h.control.snapshot().state,'failed');assert.match(h.control.snapshot().reason!,/时间上限/);
});
test('compacted evidence can be queried by actual owned receipt without rerunning a mutation',async()=>{
 const h=accept();h.control.beforeTool(h.tool('original'));h.control.afterTool('original',{evidence:'real source'},false);
 const result:any=await h.control.command({action:'receipt',receiptIds:['original']});assert.equal(result.receipts[0].result.evidence,'real source');assert.equal(h.control.snapshot().attempts.length,1);
 await assert.rejects(h.control.command({action:'receipt',receiptIds:['foreign']}),/不属于/);
});

test('standalone method assessment completes on a real owned versioned assessment receipt, never list data or another task',async()=>{
 for(const variant of ['list','foreign-task','wrong-version','owned']){
  const h=harness(),source=scientificFixture(h.task.projectId);h.context.methods.set('research_methods',['read','science']);h.plan.executionMode='planned';h.plan.steps[0]!.method='research_methods';h.plan.steps[0]!.permissions=['read','science'];h.plan.steps[0]!.expectedArtifacts=[];
  const pinned={id:source.id,version:source.version,sha256:source.sha256};h.plan.inputVersionRefs=[pinned];Object.assign(h.context,{inputVersions:[pinned]});h.control.acceptPlan(h.plan);
  const input={action:'assess',input:{task:'summarize',question:'Synthetic source summary',samples:[{id:'s',y:{snapshotId:source.id,observationId:'y'}}]}};
  const assessment=assessMethods(h.task.projectId,h.task.taskId,input.input,[source],new Set());
  const value=variant==='list'?[]:variant==='foreign-task'?{...assessment,taskId:source.id}:variant==='wrong-version'?{...assessment,inputHashes:[{...pinned,version:'different'}]}:assessment;
  h.control.beforeTool({id:'assessment',name:'research_methods',args:variant==='list'?{action:'list'}:input,permissions:['read','science']});h.control.afterTool('assessment',{content:[{type:'text',text:JSON.stringify(value)}]},false);
  assert.deepEqual(await h.control.verifyBackendSteps(),variant==='owned'?['execute']:[]);assert.equal(h.control.snapshot().steps[0]!.state,variant==='owned'?'completed':'running');
 }
});
