import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sealContext,projectContext,attachReadings} from './working-context.js';
import {workingContextSchema} from '../../contracts/src/working-context.js';
import {fitRequest} from './execution-context.js';
import {assessAnswer} from './answer-assessment.js';
import {harness} from './task-supervisor.fixture.js';
import {assessDelivery} from './delivery-assessment.js';
import {answerPathIssues} from './answer-paths.js';
const sha='a'.repeat(64);
function context(){return sealContext({schemaVersion:'working-context-v1',revision:1,sha256:sha,projectId:randomUUID(),conversationId:randomUUID(),accountRef:'local',authorizationHash:null,
 references:[{kind:'file',id:'actual-file',label:'actual.txt',projectId:randomUUID(),version:sha,sha256:sha,status:'bound',range:'selected only',originTaskId:null,exportScope:'local-only',readings:[]}],history:[],notices:[],ambiguities:[],omitted:{history:0,references:0,receipts:0}});}
test('context fingerprints ignore revision counters, remain stable and change when evidence changes',()=>{
 const a=context();assert.deepEqual(workingContextSchema.parse(a),a);assert.deepEqual(sealContext(a,a),a);
 const b=sealContext({...a,references:a.references.map(r=>({...r,status:'stale'}))},a);assert.equal(b.revision,2);assert.notEqual(a.sha256,b.sha256);
});
test('bounded projection names omissions, retains provenance hash and leaves original manifest unchanged',()=>{
 const a=context();a.history=Array.from({length:8},()=>({taskId:randomUUID(),planRevision:1,request:'old'.repeat(2000),state:'completed_with_limitations',receipts:[],artifacts:[]}));
 const pinned=sealContext(a),projected=projectContext(pinned,10000);
 assert(projected.omitted.history>0||projected.omittedRequests.length>0);assert(Buffer.byteLength(JSON.stringify(projected))<10000);assert.equal(projected.manifestSha256,pinned.sha256);assert.equal(pinned.history.length,8);
 assert.match(projected.policy,/never this task completion/);
});
test('real line-read receipt records exact coverage and partial status; search metadata does not count as a read',()=>{
 const h=harness(),a=context();h.control.acceptPlan(h.plan);
 h.control.beforeTool(h.tool('read-it','read',{action:'read',id:'actual-file',startLine:2,endLine:3}));
 h.control.afterTool('read-it',{content:[{type:'text',text:JSON.stringify({id:'actual-file',sha256:sha,startLine:2,endLine:3,totalLines:50,partial:true})}]},false);
 const b=attachReadings(a,h.control.snapshot(),ref=>h.results.get(ref));assert.equal(b.references[0]!.readings[0]!.range,'lines 2–3');assert.match(b.references[0]!.readings[0]!.omitted,/50/);
 assert.equal(b.references[0]!.readings[0]!.taskId,h.task.taskId);
 const changed=structuredClone(a);changed.references[0]!.sha256='b'.repeat(64);assert.equal(attachReadings(changed,h.control.snapshot(),ref=>h.results.get(ref)).references[0]!.readings.length,0);
});
test('repeated compaction removes obsolete checkpoints and preserves one current manifest, native schemas and call pairs',()=>{
 const original={messages:[{role:'system',content:'hard constraint: no network'}, {role:'user',content:'first'},
  {role:'assistant',tool_calls:[{id:'first-call'}],content:'old'.repeat(5000)},{role:'tool',tool_call_id:'first-call',content:'old'.repeat(5000)},
  {role:'user',content:'continue at 300 K'}, {role:'assistant',tool_calls:[{id:'new-call'}]}, {role:'tool',tool_call_id:'new-call',content:'actual current evidence'}],tools:[{name:'original'}]};
 const one=fitRequest(original,5000,100,'manifest-v1');assert(one.compacted);
 const two=fitRequest(one.payload,5000,100,'manifest-v2');assert(!JSON.stringify(two.payload).includes('manifest-v1'));
 assert.equal(two.payload.messages.filter((m:any)=>m.content?.startsWith('MaterialsX current task state')).length,1);
 const text=JSON.stringify(two.payload);assert(text.includes('300 K'));assert(text.includes('hard constraint'));assert(text.includes('new-call'));assert(!text.includes('first-call'));
});
test('measurement claims require the actual numeric value, unit and source in one current successful owned receipt',()=>{
 const h=harness();h.control.acceptPlan(h.plan);h.control.beforeTool(h.tool('measurement','read'));h.control.afterTool('measurement',{value:3.2,unit:'g',source:'page-2'},false);
 const claim={kind:'measurement' as const,receiptId:'measurement',valuePointer:'/value',value:3.2,unitPointer:'/unit',unit:'g',sourcePointer:'/source',source:'page-2'};
 assert.equal(assessAnswer('3.2 g', [claim],null,h.control.snapshot(),ref=>h.results.get(ref)).status,'claims_verified');
 for(const wrong of [{unit:'kg'},{value:32},{source:'page-99'},{receiptId:'foreign'}])assert.equal(assessAnswer('wrong',[{...claim,...wrong}],null,h.control.snapshot(),ref=>h.results.get(ref)).status,'blocked');
});
test('scientific needs_review never hides missing artifacts, while actual completed steps allow separate technical completion',()=>{
 const h=harness();h.control.acceptPlan(h.plan);h.plan.acceptance.requiredArtifacts=['result.json'];
 assert.equal(assessDelivery(h.plan,h.control.snapshot()).technical,'incomplete');
 h.control.finish('completed_with_limitations');assert.equal(h.control.snapshot().deliveryAssessment!.technical,'complete');assert.equal(h.control.snapshot().deliveryAssessment!.scientific,'needs_review');
 assert.equal(assessDelivery(h.plan,h.control.snapshot()).technical,'partial');assert.deepEqual(assessDelivery(h.plan,h.control.snapshot()).missing,['result.json']);
});
test('file links must exist in current project; changes after file acceptance cannot pass final delivery',async()=>{
 const root=mkdtempSync(join(tmpdir(),'mx-ap5-artifacts-')),outside=join(tmpdir(),'mx-ap5-outside-'+randomUUID()+'.txt');
 try{
  writeFileSync(join(root,'result.json'),'{}');writeFileSync(outside,'outside');symlinkSync(outside,join(root,'escape.txt'));
  const h=harness({root});h.plan.steps[0]!.expectedArtifacts=['result.json'];h.plan.acceptance.requiredArtifacts=['result.json'];h.control.acceptPlan(h.plan);
  h.control.beforeTool(h.tool('created','write'));h.control.afterTool('created',{created:true},false);await h.control.command({action:'complete',stepId:'execute',receiptIds:['created']});
  assert.deepEqual(answerPathIssues('[report](result.json)',root,h.control.snapshot()),[]);
  assert.equal(answerPathIssues('[x](missing.json) [escape](escape.txt) [web](https://example.org/paper)',root,h.control.snapshot()).length,2);
  writeFileSync(join(root,'result.json'),'{"changed":true}');
  h.control.finish('completed_with_limitations');assert.equal(h.control.snapshot().state,'blocked');assert.equal(h.control.snapshot().deliveryAssessment!.technical,'partial');assert.deepEqual(h.control.snapshot().deliveryAssessment!.verified,[]);assert.deepEqual(h.control.snapshot().deliveryAssessment!.missing,['result.json']);assert.match(h.control.snapshot().reason!,/变更/);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{force:true});}
});
