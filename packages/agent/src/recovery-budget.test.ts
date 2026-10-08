import {test} from 'node:test';import assert from 'node:assert/strict';
import {harness} from './task-supervisor.fixture.js';import {recoveryFault} from './recovery-failures.js';
import {withLocalResponseRecovery} from './model-recovery.js';import {AgentError} from '../../contracts/src/agent.js';
import {admitCorrection} from './recovery-policy.js';
test('correction limits persist across restarts, read-only observations and plan revisions',async()=>{
 const h=harness();h.control.acceptPlan(h.plan);const fault=recoveryFault('arguments');
 assert(h.control.recordRecovery(fault));h.control.beforeTool(h.tool('read','read'));h.control.afterTool('read',{value:'real source'},false);
 const next=structuredClone(h.plan);next.planRevision++;next.steps[0]!.method='write';next.steps[0]!.permissions=['patch'];h.control.revise(next,1,'engine');
 assert(h.control.recordRecovery(fault));assert(!h.control.recordRecovery(fault));assert.equal(h.control.snapshot().recovery?.total,2);
 const resumed=harness({previous:h.control.snapshot(),plan:h.control.plan()!});assert(!resumed.control.recordRecovery(fault));
 let calls=0;await assert.rejects(withLocalResponseRecovery(async()=>{calls++;resumed.control.beforeRequest({input:[],tools:[]},'execute',131072,128);throw new AgentError('PROTOCOL_ERROR','Incomplete tool arguments');},resumed.control),/Recovery budget exhausted/);assert.equal(calls,1);
 assert.equal(resumed.control.snapshot().deadline,h.control.snapshot().deadline);
});
test('failed mutations remain bounded even when legitimate method changes mark old attempts stale',async()=>{
 const h=harness();h.control.acceptPlan(h.plan);
 for(let i=0;i<3;i++){h.control.beforeTool(h.tool('fail'+i,'bash',{command:'failure'+i}));h.control.afterTool('fail'+i,{error:'actual fixture failure'},true);}
 const next=structuredClone(h.plan);next.planRevision++;next.steps[0]!.method='write';next.steps[0]!.permissions=['patch'];h.control.revise(next,1,'engine');
 assert(h.control.snapshot().attempts.every(a=>a.state==='stale'));assert.throws(()=>h.control.beforeTool(h.tool('retry','write')),/两次纠错/);
 await h.control.command({action:'receipt',receiptIds:['fail0']});
 assert.throws(()=>h.control.beforeTool(h.tool('retry2','write')),/Recovery budget exhausted/);
});
test('unknown paid requests and pending owned jobs retain identity and cannot admit corrections or mutations',()=>{
 const h=harness({account:'platform'});h.control.acceptPlan(h.plan);const r=h.control.beforeRequest({input:[],tools:[]},'execute',131072,128);h.control.endRequest(r.id,'unknown');
 assert(!h.control.recordRecovery(recoveryFault('protocol')));assert.equal(h.control.snapshot().requests[0]?.id,r.id);assert.equal(h.control.snapshot().requests[0]?.state,'unknown');
 const job=harness();job.control.acceptPlan(job.plan);job.control.beforeTool(job.tool('submit','materials_science',{action:'singlepoint'}));job.control.afterTool('submit',{runId:'real-owned-job',status:'running'},false);
 assert(!job.control.recordRecovery(recoveryFault('protocol')));assert.throws(()=>job.control.beforeTool(job.tool('repeat','materials_science',{action:'singlepoint'})),(error:any)=>error.recovery?.kind==='job-pending');
 assert.equal(job.control.snapshot().attempts.length,1);assert.match(job.control.summary(),/real-owned-job/);
});
test('completed read-only steps and version-only changes never reopen a no-progress response budget',async()=>{
 let calls=0;const c={canRecoverModelResponse:()=>true,summary:()=>JSON.stringify({execution:{steps:[{id:'read-'+calls,state:'completed'}],planRevision:calls}})} as any;
 await assert.rejects(withLocalResponseRecovery(async()=>{calls++;throw new AgentError('PROTOCOL_ERROR','Incomplete tool arguments');},c),/Recovery budget exhausted/);assert.equal(calls,3);
});
test('new host-verified artifact hashes can open the next two corrections but never reset the total cap',()=>{
 const h=harness();h.control.acceptPlan(h.plan);const state=h.control.snapshot(),fault=recoveryFault('arguments');
 for(let stage=0;stage<4;stage++){
  state.steps[0]!.state='completed';state.steps[0]!.artifacts=[{name:'verified-output',path:'output-'+stage+'.json',sha256:String(stage).repeat(64),bytes:20,verified:true,planRevision:1}];
  assert(admitCorrection(state,fault));assert(admitCorrection(state,fault));
 }
 state.steps[0]!.artifacts![0]!.sha256='f'.repeat(64);assert(!admitCorrection(state,fault));assert.equal(state.recovery?.total,8);
});
test('version-only stale marking cannot replay the same failed script without a real repair receipt',()=>{
 const h=harness();h.control.acceptPlan(h.plan);const args={command:'sh owned-script.sh'};
 h.control.beforeTool(h.tool('failure','bash',args));h.control.afterTool('failure',{content:[{type:'text',text:JSON.stringify({exit_code:7,output:'actual fixture exit'})}]},true);
 const next=structuredClone(h.plan);next.planRevision=2;next.steps[0]!.method='write';next.steps[0]!.permissions=['patch'];h.control.revise(next,1,'engine');
 const back=structuredClone(h.plan);back.planRevision=3;h.control.revise(back,2,'engine');
 assert.equal(h.control.snapshot().attempts[0]!.state,'stale');assert.throws(()=>h.control.beforeTool(h.tool('repeat','bash',args)),/Identical failed command/);
 assert.equal(h.control.snapshot().attempts.length,1);
});
