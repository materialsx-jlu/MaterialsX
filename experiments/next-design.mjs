import {seededRandom,shuffle,pointKey,coordinates,evaluateSurrogate,expectedImprovement} from './gaussian-process.mjs';
export function feasible(study,point){
  if(Object.keys(point).length!==study.factors.length)return false;
  for(const f of study.factors){const v=point[f.key];if(!Number.isFinite(v)||v<f.levels[0]||v>f.levels.at(-1)||f.kind==='discrete'&&!f.levels.includes(v))return false;}
  return study.constraints.every(c=>{const v=Object.entries(c.terms).reduce((n,[k,a])=>n+a*point[k],0);return Number.isFinite(v)&&(c.min===null||v>=c.min-1e-10)&&(c.max===null||v<=c.max+1e-10);});
}
export function estimatedCost(study,point){const n=study.baseCostCny+study.factors.reduce((sum,f)=>sum+f.costPerUnitCny*(point[f.key]-f.levels[0]),0);if(!(n>0)||!Number.isFinite(n))throw Error('INVALID_COST_ESTIMATE');return n;}
export function factorial(study){let points=[{}];for(const f of study.factors)points=points.flatMap(p=>f.levels.map(v=>({...p,[f.key]:v})));return points;}
function continuousPoint(study,random){return Object.fromEntries(study.factors.map(f=>[f.key,f.kind==='discrete'?f.levels[Math.floor(random()*f.levels.length)]:f.levels[0]+random()*(f.levels.at(-1)-f.levels[0])]));}
export function latinHypercube(study,count,seed){const random=seededRandom(seed),columns=study.factors.map(f=>shuffle(Array.from({length:count},(_,i)=>f.kind==='discrete'?f.levels[i%f.levels.length]:f.levels[0]+(i+random())/count*(f.levels.at(-1)-f.levels[0])),random));
  return Array.from({length:count},(_,i)=>Object.fromEntries(study.factors.map((f,j)=>[f.key,columns[j][i]])));}
export function designNext(study,request,feedback=[]){
  if(!feasible(study,study.control))throw Error('CONTROL_VIOLATES_FACTOR_OR_LINEAR_CONSTRAINT');
  const active=request.method==='active-learning',optimizing=active||request.method==='bayesian',evaluation=evaluateSurrogate(study,feedback),random=seededRandom(request.seed),
    allFactorial=factorial(study),doe=allFactorial.filter(p=>feasible(study,p)),pool=[],keys=new Set(),completed=new Set(feedback.filter(f=>f.input.outcome==='measured'&&f.value!==null).map(f=>pointKey(study,f.input.actualFactors)));
  const best=feedback.filter(f=>f.input.outcome==='measured'&&f.input.reviewed&&f.value!==null&&!f.deviations.length).reduce((n,f)=>study.response.direction==='maximize'?Math.max(n,f.value):Math.min(n,f.value),study.response.direction==='maximize'?-Infinity:Infinity);
  const score=p=>{const predicted=evaluation.predict?.(coordinates(study,p));return predicted?{...predicted,score:(active?predicted.sd:expectedImprovement(predicted.prediction,predicted.sd,best,study.response.direction))/estimatedCost(study,p)}:{prediction:null,sd:null,score:null};};
  for(let i=0;i<4096&&pool.length<256;i++){const p=continuousPoint(study,random),key=pointKey(study,p);if(!keys.has(key)&&feasible(study,p)){keys.add(key);pool.push(p);}}
  const prospective=p=>!completed.has(pointKey(study,p))&&pointKey(study,p)!==pointKey(study,study.control);
  const randomBaseline=shuffle(pool.filter(prospective),seededRandom(request.seed^0x9e3779b9)).slice(0,request.points);
  const baselines=[['factorial',doe.filter(prospective).slice(0,request.points)],['random',randomBaseline]].map(([method,points])=>({method,points:points.length,meanAcquisitionPerCost:evaluation.predict&&points.length?points.reduce((n,p)=>n+score(p).score,0)/points.length:null,meaning:'Prospective model acquisition proxy, not measured performance or demonstrated superiority.'}));
  const reasons=[];let chosen=[];
  if(optimizing){if(!evaluation.info.enabled)reasons.push(...evaluation.info.reasons);else chosen=pool.filter(prospective).sort((a,b)=>score(b).score-score(a).score).slice(0,request.points);}
  else if(request.method==='factorial'){if(doe.length!==allFactorial.length)reasons.push('CONSTRAINTS_BREAK_FULL_FACTORIAL: choose a constrained space-filling design');chosen=doe;}
  else{
    const original=latinHypercube(study,request.points,request.seed);if(original.some(p=>!feasible(study,p)))reasons.push('CONSTRAINTS_BREAK_LATIN_HYPERCUBE: adjust bounds; no silent rejection resampling');
    chosen=original;
  }
  if(optimizing&&evaluation.info.enabled&&chosen.length<request.points)reasons.push('INSUFFICIENT_NEW_FEASIBLE_POINTS');
  chosen=chosen.filter(p=>pointKey(study,p)!==pointKey(study,study.control));
  if(!chosen.length&&!reasons.length)reasons.push('NO_NEW_TREATMENT_POINTS');
  if(new Set(chosen.map(p=>pointKey(study,p))).size!==chosen.length)reasons.push('DUPLICATE_TREATMENT_POINTS');
  const points=[study.control,...chosen].map((p,i)=>({id:'point-'+String(i+1).padStart(3,'0'),factors:p,costCny:estimatedCost(study,p),minutes:study.minutesPerRun,
    ...(optimizing?score(p):{prediction:null,sd:null,score:null}),uncertaintySource:optimizing&&evaluation.info.enabled?'Fixed RBF GP posterior; not calibrated measurement uncertainty':'Design-only; no predictive uncertainty estimate',manufacturability:'needs_review'}));
  const schedule=[];for(const block of study.blocks){const rows=[];for(const p of points)for(let replicate=1;replicate<=study.replicates;replicate++)rows.push({pointId:p.id,role:p.id===points[0].id?'control':'treatment',block,replicate,factors:p.factors,costCny:p.costCny,minutes:p.minutes,status:'planned'});
    for(const r of shuffle(rows,random))schedule.push({...r,id:'planned-'+String(schedule.length+1).padStart(4,'0'),order:schedule.length+1});}
  const cost=schedule.reduce((n,r)=>n+r.costCny,0),minutes=schedule.reduce((n,r)=>n+r.minutes,0);
  if(schedule.length>study.maxRuns||schedule.length>400)reasons.push('RUN_BUDGET_EXCEEDED');if(cost>study.maxCostCny)reasons.push('ESTIMATED_COST_BUDGET_EXCEEDED');if(minutes>study.maxMinutes)reasons.push('ESTIMATED_TIME_BUDGET_EXCEEDED');
  return {status:reasons.length?'blocked':'planned',reasons,points:points.slice(0,126),schedule:reasons.length?[]:schedule,estimatedCostCny:cost,estimatedMinutes:minutes,optimization:evaluation.info,baselines,
    limitations:['Candidates are planned experiments, not completed physical tests or unique molecular structures.',
      'Hypotheses, alternatives and falsification criteria are proposals; no causal conclusion is inferred.',
      'Bounds and linear constraints do not certify manufacturability. Cost/time are user estimates, not spending authorization.',
      'GP qualification is a fixed coordinate-grouped holdout check against a training-only mean; domain/causal validation and uncertainty calibration are not established.',
      'LHS stratifies continuous coordinates; discrete coordinates use balanced levels. Design size is not an automatic power or significance calculation.',
      'Randomization is within complete blocks. Independent experimental units must be prepared; repeated curve points are not replicates.'],scientificStatus:'needs_review',productionApproved:false};
}
