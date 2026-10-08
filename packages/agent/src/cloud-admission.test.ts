import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './task-supervisor.fixture.js';
import {hasUnresolvedPaidRequests,taskExecutionSchema} from '../../contracts/src/task-execution.js';
import {cloudHostToolNames} from '../../contracts/src/cloud-tool-names.js';
import {readFile} from 'node:fs/promises';
import {recoveryFailureMessage} from './recovery-presentation.js';
import {recoveryError} from './recovery-failures.js';
test('gateway client-tool registry is generated from the shared capability names',async()=>{
 assert.deepEqual(JSON.parse(await readFile('services/control-plane/internal/gateway/client-tool-names.json','utf8')),cloudHostToolNames);
 for(const name of ['research_data','recipe_proposal','research_delivery','find_tools','task_control'])assert(cloudHostToolNames.includes(name));
});
test('cloud requests continue beyond 32 and 64 while retaining duplicate, deadline and unknown-result checks',()=>{
 const h=harness({account:'platform'});h.control.acceptPlan(h.plan);
 for(let i=0;i<70;i++){const r=h.control.beforeRequest({input:[{role:'user',content:'fixture'}]},'execute',131072,128,String(i));h.control.endRequest(r.id,'completed');}
 assert.equal(taskExecutionSchema.parse(h.control.snapshot()).requests.length,70);
 assert.throws(()=>h.control.beforeRequest({input:[{role:'user',content:'fixture'}]},'execute',131072,128,'0'),/已使用/);
 h.tick(60001);assert.throws(()=>h.control.beforeRequest({input:[{role:'user',content:'fixture'}]},'execute',131072,128,'late'),/时间/);
});
test('confirmed no-dispatch rejection is not presented as unknown billed work',()=>{
 const h=harness({account:'platform'});h.control.acceptPlan(h.plan);
 const r=h.control.beforeRequest({input:[{role:'user',content:'fixture'}]},'execute',131072,128);
 h.control.endRequest(r.id,'failed',null,true);
 assert(!hasUnresolvedPaidRequests(h.control.snapshot()));
 assert.doesNotMatch(recoveryFailureMessage(recoveryError('UNAVAILABLE','平台请求被拒绝','arguments','rejected',{dispatched:false}),h.control.snapshot()),/原操作结果待核对/);
 const second=h.control.beforeRequest({input:[{role:'user',content:'fixture'}]},'execute',131072,128);h.control.endRequest(second.id,'unknown');
 assert(hasUnresolvedPaidRequests(h.control.snapshot()));
});
