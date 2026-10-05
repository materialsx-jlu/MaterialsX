import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {scientificFixture} from '../../../tests/fixtures/agent/ua7-source.js';
import {assessMethods,executeFixedMethod,splitChecks} from './method-registry.js';
import {methodInput} from '../../contracts/src/research-methods.js';
import {sourceHash} from './data-source-router.js';
import {describe,fitLine,errorMetrics} from './research-math.js';
import {requiredInteraction} from '../../atomistic/src/interaction-requirements.js';
test('shared M6 physics requirements cannot be downgraded to a short-range routing request',()=>{
  for(const [question,expected]of [['需要长程静电','long-range-required'],['spin polarization','spin-required'],['electric field','field-required'],['delta learning','delta-required'],['multi-head potential','multi-head-required'],['PBE D3 色散','dispersion-required']] as const)assert.equal(requiredInteraction(question,'short-range'),expected);
  assert.equal(requiredInteraction('ordinary crystal energy','long-range-required'),'long-range-required');
});
test('three independent executions reproduce fixed numeric gold fields; statistics do not fabricate uncertainty',()=>{
  const projectId=randomUUID(),sources=Array.from({length:7},(_,i)=>scientificFixture(projectId,i));
  for(let repeat=0;repeat<3;repeat++){
    const request=methodInput.parse({task:'validate',question:'synthetic fixed linear relation',samples:sources.map((s,i)=>({id:'p'+i,y:{snapshotId:s.id,observationId:'y'},x:{snapshotId:s.id,observationId:'x'},split:i<3?'train':i<5?'validation':'test'}))});
    const assessment=assessMethods(projectId,null,request,sources,new Set());assert.equal(assessment.candidates[0]?.methodId,'grouped-linear-validation');
    const r=executeFixedMethod(assessment,sources).result as any;
    assert.equal(r.slope,2);assert.equal(r.intercept,3);assert.equal(r.rSquared,1);assert.equal(r.residualSd,0);
    assert.deepEqual(r.trainingDomain,{min:0,max:2});assert.equal(r.validation[0].linear.mae,0);assert.equal(r.validation[1].linear.rmse,0);
    assert.equal(r.validation[0].baseline.mae,5);assert.equal(r.validation[1].baseline.mae,9);
    assert(r.validation.every((g:any)=>g.predictions.every((p:any)=>p.extrapolation)));
  }
  const actual=describe([1,2,3],true);assert.equal(actual.mean,2);assert.equal(actual.sampleSd,1);assert(Math.abs(actual.standardError!-1/Math.sqrt(3))<1e-14);assert.equal(actual.confidenceInterval,null);
  assert.equal(describe([1,2,3],false).sampleSd,null);assert.equal(describe([1],true).sampleSd,null);
  assert.throws(()=>fitLine([{x:1,y:2},{x:1,y:3},{x:1,y:4}]),/DEGENERATE/);
  assert.deepEqual(errorMetrics([1,2],[2,1]),{rows:2,mae:1,rmse:1});
});
test('hard conditions exclude incompatible units, missing evidence, duplicates, unknown energy references and source leakage',()=>{
  const p=randomUUID(),sources=Array.from({length:6},(_,i)=>scientificFixture(p,i));
  const request={task:'validate',question:'heldout fixture',samples:sources.map((s,i)=>({id:'s'+i,y:{snapshotId:s.id,observationId:'y'},x:{snapshotId:s.id,observationId:'x'},split:i<3?'train':i===3?'validation':'test'}))};
  for(const [mutate,code]of [
    [(s:any)=>s.data.observations[0].unit='Pa','UNITS_PROPERTY_BASIS_OR_CONDITIONS_NOT_COMPARABLE'],
    [(s:any)=>s.evidence=[],'READ_EVIDENCE_REQUIRED'],
    [(s:any)=>s.data.observations[0].property='total energy','ENERGY_REFERENCE_REQUIRED'],
    [(s:any)=>s.data.observations[1].conditions.temperature='400 K','PAIR_CONDITION_OR_SOURCE_MISMATCH'],
    [(s:any)=>s.data.observations[1].basis=undefined,'X_COMPOSITION_BASIS_REQUIRED'],
    [(s:any)=>s.data.observations[0].origin='predicted','PREDICTED_TARGET_IS_NOT_REFERENCE'],
  ] as const){const changed=structuredClone(sources);mutate(changed[0]);changed[0]!.sha256=sourceHash(changed[0]!.data);const a=assessMethods(p,null,request,changed,new Set());assert(!a.candidates.length);assert(a.exclusions.some(e=>e.reasons.includes(code)));}
  const bad=methodInput.parse({...request,samples:request.samples.map(s=>({...s,split:'train'}))});
  assert(!assessMethods(p,null,bad,sources,new Set()).candidates.length);
  assert(splitChecks([{sourceGroup:'same',split:'train'},{sourceGroup:'same',split:'test'}] as any).includes('SOURCE_GROUP_LEAKAGE'));
  const dup={task:'summarize',question:'duplicate',samples:[{id:'one',y:request.samples[0]!.y},{id:'two',y:request.samples[0]!.y}]};
  assert(assessMethods(p,null,dup,sources,new Set()).exclusions.some(e=>e.reasons.includes('DUPLICATE_SOURCE_OBSERVATION')));
  assert(!assessMethods(p,null,request,sources,new Set([sources[0]!.id])).candidates.length);
  assert(!assessMethods(p,null,request,[{...sources[0]!,sha256:'a'.repeat(64)},...sources.slice(1)],new Set()).candidates.length);
});
