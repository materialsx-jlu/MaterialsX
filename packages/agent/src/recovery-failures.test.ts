import {test} from 'node:test';import assert from 'node:assert/strict';import {z} from 'zod';
import {AgentError,engineErrorSchema} from '../../contracts/src/agent.js';
import {argumentError,failureFor,recoveryError,recoveryFault,failureFromReceipt} from './recovery-failures.js';
import {canRecoverLocalResponse} from './model-recovery.js';
import {recoveryFailureMessage,failureGuidance} from './recovery-presentation.js';
import {harness} from './task-supervisor.fixture.js';
test('structured errors are independent of message language and round-trip the shared error contract',()=>{
 for(const message of ['参数错误','opaque provider text','Incomplete tool arguments']){
  const error=recoveryError('PERMISSION_DENIED',message,'science-scope');assert.equal(failureFor(error).kind,'science-scope');
  assert.equal(engineErrorSchema.parse(error.toJSON()).recovery?.next,'stop');assert.equal(canRecoverLocalResponse(error,{canRecoverModelResponse:()=>true} as any),false);
 }
 assert.equal(failureFor(new AgentError('BUDGET_EXCEEDED','Incomplete model response')).kind,'budget');
});
test('schema rejection returns exact original parameters and field expectations, never copies bad values or invents IDs',()=>{
 const schema=z.strictObject({sourceId:z.string(),count:z.number().int().min(1)}),parameters=z.toJSONSchema(schema);
 const parsed=schema.safeParse({count:'secret-fixture-value',undeclared:5});assert(!parsed.success);
 const error=argumentError('owned_reader',parameters,parsed.error);assert.equal(error.recovery?.phase,'rejected');assert.deepEqual(error.recovery?.parameters,parameters);
 assert.deepEqual(error.recovery?.issues?.map(i=>i.path),['sourceId','count','undeclared']);
 assert(!JSON.stringify(error.toJSON()).includes('secret-fixture-value'));assert(!JSON.stringify(error.toJSON()).includes('sourceId":"moos-'));
});
test('actual failed native receipts distinguish script/dependency/unknown operations; ordinary stdout never triggers repair',()=>{
 const receipt=(exit_code:number,output:string)=>[{type:'text',text:JSON.stringify({exit_code,output})}];
 assert.equal(failureFromReceipt('exec_command','owned',receipt(1,'KeyError: actual missing key'),true)?.next,'inspect-script');
 assert.equal(failureFromReceipt('exec_command','owned',receipt(1,'ModuleNotFoundError: known missing dependency'),true)?.next,'check-environment');
 assert.equal(failureFromReceipt('exec_command','owned',receipt(0,'ModuleNotFoundError: quoted source example'),false),undefined);
 assert.equal(failureFromReceipt('exec_command','owned',null,false,true)?.next,'reconcile');
 const typed=recoveryError('UNAVAILABLE','Managed lock missing','environment');assert.equal(failureFromReceipt('paper_read','owned',{error:typed.toJSON()},true)?.kind,'environment');
});
test('every failure category has a bounded action; pending and unknown operations cannot enter response retries',()=>{
 const h=harness();h.control.acceptPlan(h.plan);
 for(const [kind,next] of [['arguments','correct-arguments'],['transport','reconcile'],['script','inspect-script'],['environment','check-environment'],['source','supplement-source'],['job-pending','query-original'],['operation-unknown','reconcile'],['permission','stop'],['budget','stop'],['science-scope','stop']] as const){
  const fault=recoveryFault(kind,kind==='job-pending'?'pending':kind==='operation-unknown'?'unknown':'rejected');assert.equal(fault.next,next);assert(failureGuidance(fault).instruction.length);
  if(['transport','job-pending','operation-unknown','permission','budget','science-scope'].includes(kind))assert(!canRecoverLocalResponse(new AgentError('EXECUTION_FAILED','arbitrary',false,fault),h.control));
 }
 const original=h.control.beforeRequest({input:[],tools:[]},'execute',131072,128);h.control.endRequest(original.id,'unknown');
 const state=h.control.snapshot();state.accountRef='platform';assert.match(recoveryFailureMessage(argumentError('tool',{},null),state),/原操作结果待核对/);assert.match(recoveryFailureMessage(argumentError('tool',{},null),state),/不再次扣费/);
});
