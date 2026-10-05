import assert from 'node:assert/strict';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fitGaussianProcess,expectedImprovement} from '../../experiments/gaussian-process.mjs';
const exec=promisify(execFile),root=process.cwd(),directory=resolve('runtime/agent/ua-9');
const cases=Array.from({length:12},(_,k)=>{const dimensions=k%3+1,n=8+k%5,points=Array.from({length:n},(_,i)=>Array.from({length:dimensions},(_,j)=>((i*(j*2+3)+k)%29)/28)),values=points.map((x,i)=>50+7*Math.sin(x[0]!*3)+x.reduce((a,b)=>a+b,0)*2+i*.04),queries=Array.from({length:10},(_,i)=>Array.from({length:dimensions},(_,j)=>((i*7+j*5+k)%31)/30));return {points,values,queries};});
const python=String.raw`
import json,math,sys
cases=json.loads(sys.argv[1])
def solve(a,b):
 a=[list(row)+[v] for row,v in zip(a,b)];n=len(b)
 for k in range(n):
  pivot=max(range(k,n),key=lambda i:abs(a[i][k]));a[k],a[pivot]=a[pivot],a[k]
  for i in range(k+1,n):
   ratio=a[i][k]/a[k][k]
   for j in range(k,n+1):a[i][j]-=ratio*a[k][j]
 out=[0.0]*n
 for i in range(n-1,-1,-1):out[i]=(a[i][n]-sum(a[i][j]*out[j] for j in range(i+1,n)))/a[i][i]
 return out
kernel=lambda a,b: math.exp(-sum((x-y)**2 for x,y in zip(a,b))/(2*.25**2))
out=[]
for case in cases:
 points=case['points'];values=case['values'];n=len(points);average=sum(values)/n;scale=math.sqrt(sum((y-average)**2 for y in values)/n)
 matrix=[[kernel(a,b)+(1e-6 if i==j else 0) for j,b in enumerate(points)] for i,a in enumerate(points)]
 alpha=solve(matrix,[(y-average)/scale for y in values]);predictions=[]
 for x in case['queries']:
  cov=[kernel(p,x) for p in points];v=solve(matrix,cov)
  predictions.append({'prediction':average+scale*sum(a*b for a,b in zip(cov,alpha)),'sd':scale*math.sqrt(max(0,1-sum(a*b for a,b in zip(cov,v))))})
 out.append(predictions)
ei=[]
for z in [-6,-2,-.5,0,.5,2,6]:
 delta=z*2;sd=2;ei.append(max(0,delta*.5*(1+math.erf(z/math.sqrt(2)))+sd*math.exp(-z*z/2)/math.sqrt(2*math.pi)))
print(json.dumps({'predictions':out,'ei':ei}))
`;
const {stdout}=await exec('python3',['-c',python,JSON.stringify(cases)],{maxBuffer:1024*1024}),reference=JSON.parse(stdout) as {predictions:Array<Array<{prediction:number;sd:number}>>;ei:number[]};
let fields=0,maxAbsoluteError=0,maxEiError=0;
for(let repeat=0;repeat<3;repeat++)for(const [i,c] of cases.entries()){
  const predict=fitGaussianProcess(c.points,c.values);
  for(const [j,q] of c.queries.entries())for(const name of ['prediction','sd'] as const){const actual=predict(q)[name],expected=reference.predictions[i]![j]![name],error=Math.abs(actual-expected);assert(error<=1e-7*Math.max(1,Math.abs(expected)),`${i}/${j}/${name}: ${actual} != ${expected}`);fields++;maxAbsoluteError=Math.max(error,maxAbsoluteError);}
}
for(const [i,z] of [-6,-2,-.5,0,.5,2,6].entries())for(const direction of ['maximize','minimize'] as const){const actual=expectedImprovement(direction==='maximize'?10+z*2:10-z*2,2,10,direction),error=Math.abs(actual-reference.ei[i]!);assert(error<1e-6);fields++;maxEiError=Math.max(maxEiError,error);}
const files=['experiments/next-design.mjs','experiments/gaussian-process.mjs','experiments/math.mjs'];const hashes=Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile(join(root,p))).digest('hex')])));
await mkdir(directory,{recursive:true});await writeFile(join(directory,'numeric-reference.json'),JSON.stringify({passed:true,syntheticOnly:true,cases:12,runs:3,fields,maxAbsoluteError,maxEiError,tolerance:'GP: 1e-7 * max(1,abs(reference)); EI: absolute 1e-6',reference:'Independent Python standard-library pivoted Gaussian elimination and erf (not JS Cholesky/CDF approximation)',sourceHashes:hashes,scientificStatus:'needs_review',physicalExperimentsExecuted:false,modelSemanticSelectionQualified:false},null,2)+'\n');console.log(JSON.stringify({passed:true,cases:12,runs:3,fields,maxAbsoluteError,maxEiError}));
