import {test} from 'node:test';
import assert from 'node:assert/strict';
import {designNext,factorial,latinHypercube,feasible} from './next-design.mjs';
import {fitGaussianProcess,evaluateSurrogate,expectedImprovement} from './gaussian-process.mjs';
import {studyFixture,designFixture,smoothFeedback} from '../tests/fixtures/agent/ua9-study.js';
import {studyInput,nextDesignResultSchema} from '../packages/contracts/src/next-experiment.js';
for(let dimensions=1;dimensions<=3;dimensions++)for(let levels=2;levels<=5;levels++)test(`full factorial ${dimensions} factors x ${levels} levels balances controls/replicates without dropping points`,()=>{
  const s=studyFixture();s.factors=Array.from({length:dimensions},(_,i)=>({...s.factors[0]!,key:'f'+i,levels:Array.from({length:levels},(_,j)=>j)}));s.control=Object.fromEntries(s.factors.map(f=>[f.key,0]));s.maxRuns=400;
  const d=designNext(s,designFixture());assert.equal(factorial(s).length,levels**dimensions);assert.equal(d.estimatedCostCny>0,true);
  if(levels**dimensions*4>400){assert.equal(d.status,'blocked');assert.equal(d.schedule.length,0);return;}
  assert.equal(d.status,'planned');assert.equal(d.schedule.length,levels**dimensions*4);nextDesignResultSchema.parse(d);
  for(const block of s.blocks){const rows=d.schedule.filter(r=>r.block===block);assert.equal(rows.length,levels**dimensions*2);assert.equal(rows.filter(r=>r.role==='control').length,2);
    for(const p of d.points)assert.equal(rows.filter(r=>r.pointId===p.id).length,2);}
  assert.deepEqual(d,designNext(s,designFixture()));assert.notDeepEqual(d.schedule,designNext(s,{...designFixture(),seed:2027}).schedule);
});
test('LHS preserves continuous strata and enforces bounds/linear constraints without silently resampling or truncating',()=>{
  const s=studyFixture(),q={...designFixture(),method:'latin-hypercube' as const,points:8},p=latinHypercube(s,8,q.seed);assert.equal(new Set(p.map(p=>Math.floor(p.temperature!*8))).size,8);assert(p.every(p=>feasible(s,p)));
  const d=designNext(s,q);assert.equal(d.schedule.length,9*4);s.constraints=[{terms:{temperature:1},min:null,max:.5,reason:'Synthetic constraint'}];const blocked=designNext(s,q);assert.equal(blocked.status,'blocked');assert.equal(blocked.schedule.length,0);
  assert.equal(designNext(s,designFixture()).status,'blocked');s.control.temperature=1;assert.throws(()=>designNext(s,q),/CONTROL/);
});
test('budget caps block complete designs rather than reducing controls/replicates; finite schema rejects malicious output',()=>{
  for(const field of ['maxRuns','maxCostCny','maxMinutes'] as const){const s=studyFixture();s[field]=2;const d=designNext(s,designFixture());assert.equal(d.status,'blocked');assert.equal(d.schedule.length,0);assert.equal(d.points.length,2);}
  const s=studyFixture();s.factors[0]!.levels=[1,0];assert.throws(()=>studyInput.parse(s));const d=designNext(studyFixture(),designFixture());assert.throws(()=>nextDesignResultSchema.parse({...d,estimatedCostCny:Infinity}));assert.throws(()=>nextDesignResultSchema.parse({...d,status:'blocked'}));
});
test('fixed GP gate uses reviewed independent source identities and holds out whole coordinate groups',()=>{
  const s=studyFixture(),feedback=smoothFeedback(),q={...designFixture(),method:'bayesian' as const,points:4};
  assert.equal(evaluateSurrogate(s,feedback.slice(0,7)).info.enabled,false);const good=evaluateSurrogate(s,feedback);assert.equal(good.info.enabled,true);assert(good.info.validation!.rmse<good.info.validation!.baselineRmse);
  assert.equal(good.info.validation!.trainConditions+good.info.validation!.heldoutConditions,24);
  const d=designNext(s,q,feedback);assert.deepEqual(d.optimization,designNext(s,{...q,seed:42},feedback).optimization);assert.equal(d.status,'planned');assert.equal(d.points.length,5);assert(d.points.every(p=>p.prediction!==null&&p.sd!==null));assert(d.points.slice(1).every(p=>!feedback.some(f=>f.input.actualFactors.temperature===p.factors.temperature)));
  const active=designNext(s,{...q,method:'active-learning'},feedback);assert.equal(active.status,'planned');assert.notDeepEqual(d.points.slice(1),active.points.slice(1));
  const duplicate=[...feedback,{...feedback[0]!}];assert.equal(evaluateSurrogate(s,duplicate).info.enabled,false);
  const unreviewed=feedback.map(f=>({...f,input:{...f.input,reviewed:false}}));assert.equal(designNext(s,q,unreviewed).status,'blocked');
  const constant=feedback.map(f=>({...f,value:100}));assert.equal(evaluateSurrogate(s,constant).info.enabled,false);
  const noise=feedback.map((f,i)=>({...f,value:i%2?100:-100}));assert.equal(evaluateSurrogate(s,noise).info.enabled,false);
  const deviated=feedback.map(f=>({...f,deviations:['Changed conditions']}));assert.equal(evaluateSurrogate(s,deviated).info.eligibleRows,0);
});
test('Gaussian posterior interpolates reference points and EI treats maximize/minimize symmetrically',()=>{
  const predict=fitGaussianProcess([[0],[.5],[1]],[10,20,15]);assert(Math.abs(predict([.5]).prediction-20)<1e-4);assert(predict([.5]).sd<predict([.25]).sd);
  assert.equal(expectedImprovement(11,0,10,'maximize'),1);assert.equal(expectedImprovement(9,0,10,'minimize'),1);assert.equal(expectedImprovement(11,0,10,'minimize'),0);
  assert.equal(expectedImprovement(11,2,10,'maximize'),expectedImprovement(9,2,10,'minimize'));
});
