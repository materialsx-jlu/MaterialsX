import {mean} from './math.mjs';
export function seededRandom(seed){let n=seed>>>0;return ()=>{n=(Math.imul(1664525,n)+1013904223)>>>0;return n/4294967296;};}
export function shuffle(values,random){const a=[...values];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function coordinates(study,point){return study.factors.map(f=>(point[f.key]-f.levels[0])/(f.levels.at(-1)-f.levels[0]));}
export function pointKey(study,point){return JSON.stringify(study.factors.map(f=>Number(point[f.key].toPrecision(12))));}
function kernel(a,b){return Math.exp(-a.reduce((n,v,i)=>n+(v-b[i])**2,0)/(2*.25**2));}
function lowerSolve(l,b){const out=[];for(let i=0;i<b.length;i++){let v=b[i];for(let j=0;j<i;j++)v-=l[i][j]*out[j];out.push(v/l[i][i]);}return out;}
function upperSolve(l,b){const out=Array(b.length).fill(0);for(let i=b.length-1;i>=0;i--){let v=b[i];for(let j=i+1;j<b.length;j++)v-=l[j][i]*out[j];out[i]=v/l[i][i];}return out;}
/** Fixed RBF, normalized factor coordinates, training-only response scaling, fixed noise. No tuning on validation. */
export function fitGaussianProcess(points,values){
  const average=mean(values),scale=Math.sqrt(mean(values.map(v=>(v-average)**2)));if(!(scale>0)||!Number.isFinite(scale))throw Error('CONSTANT_OR_INVALID_RESPONSE');
  const n=points.length,l=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let v=kernel(points[i],points[j])+(i===j?1e-6:0);for(let k=0;k<j;k++)v-=l[i][k]*l[j][k];
    if(i===j){if(!(v>0))throw Error('SURROGATE_MATRIX_NOT_POSITIVE');l[i][j]=Math.sqrt(v);}else l[i][j]=v/l[j][j];
  }
  const alpha=upperSolve(l,lowerSolve(l,values.map(y=>(y-average)/scale)));
  return point=>{const k=points.map(p=>kernel(p,point)),v=lowerSolve(l,k),prediction=average+scale*k.reduce((s,w,i)=>s+w*alpha[i],0),sd=scale*Math.sqrt(Math.max(0,1-v.reduce((s,w)=>s+w*w,0)));
    if(!Number.isFinite(prediction)||!Number.isFinite(sd))throw Error('SURROGATE_NUMERICAL_RANGE');return {prediction,sd};};
}
export function evaluateSurrogate(study,feedback){
  const reasons=[],groups=new Map(),identities=new Set();let eligibleRows=0;
  for(const f of feedback){
    if(f.input.outcome!=='measured'||!f.input.reviewed||f.value===null||f.deviations.length||!f.sourceIdentity)continue;
    if(identities.has(f.sourceIdentity)){reasons.push('DUPLICATE_SOURCE_IDENTITY');continue;}identities.add(f.sourceIdentity);eligibleRows++;
    const key=pointKey(study,f.input.actualFactors),group=groups.get(key)??{x:coordinates(study,f.input.actualFactors),ys:[]};group.ys.push(f.value);groups.set(key,group);
  }
  if(groups.size<8)reasons.push('NEED_EIGHT_DISTINCT_REVIEWED_CONDITIONS');
  if(groups.size>64)reasons.push('SURROGATE_LIMIT_64_CONDITIONS');
  const info={enabled:false,eligibleRows,uniqueConditions:groups.size,validation:null,reasons};
  if(reasons.length)return {info,predict:null};
  const rows=shuffle([...groups.values()].map(g=>({x:g.x,y:mean(g.ys)})),seededRandom(8675309)),heldout=Math.max(3,Math.ceil(rows.length*.25)),train=rows.slice(heldout),test=rows.slice(0,heldout);
  try{
    const predict=fitGaussianProcess(train.map(r=>r.x),train.map(r=>r.y)),baseline=mean(train.map(r=>r.y));
    const rmse=Math.sqrt(mean(test.map(r=>(predict(r.x).prediction-r.y)**2))),baselineRmse=Math.sqrt(mean(test.map(r=>(baseline-r.y)**2)));
    info.validation={trainConditions:train.length,heldoutConditions:test.length,rmse,baselineRmse,requiredRelativeImprovement:.05,validationSeed:8675309};
    if(!(baselineRmse>0&&rmse<=.95*baselineRmse)){info.reasons.push('SURROGATE_DID_NOT_BEAT_TRAINING_MEAN_BASELINE');return {info,predict:null};}
    info.enabled=true;return {info,predict:fitGaussianProcess(rows.map(r=>r.x),rows.map(r=>r.y))};
  }catch(e){info.reasons.push(e.message);return {info,predict:null};}
}
function cdf(z){const t=1/(1+.2316419*Math.abs(z)),p=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI),tail=p*t*(.31938153+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return z>=0?1-tail:tail;}
export function expectedImprovement(prediction,sd,best,direction){const improvement=(direction==='maximize'?1:-1)*(prediction-best);if(sd<=1e-12)return Math.max(0,improvement);const z=improvement/sd;return Math.max(0,improvement*cdf(z)+sd*Math.exp(-z*z/2)/Math.sqrt(2*Math.PI));}
