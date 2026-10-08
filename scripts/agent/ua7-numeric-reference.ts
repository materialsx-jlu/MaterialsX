import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {describe,fitLine,errorMetrics} from '../../packages/agent/src/research-math.js';
// Independent standard-library reference; no installation or trained model.
const datasets=Array.from({length:12},(_,k)=>Array.from({length:17},(_,i)=>({x:i+k/10,y:(k+1)*i/3+2+Math.sin(i*1.3+k)/5})));
const python=[
  'import json,statistics,math,sys',
  'answer=[]',
  'for rows in json.load(sys.stdin):',
  "    x=[r['x'] for r in rows];y=[r['y'] for r in rows]",
  '    slope,intercept=statistics.linear_regression(x,y)',
  '    errors=[b-(slope*a+intercept) for a,b in zip(x,y)]',
  '    answer.append(dict(mean=statistics.mean(y),sampleSd=statistics.stdev(y),standardError=statistics.stdev(y)/math.sqrt(len(y)),',
  '        slope=slope,intercept=intercept,mae=statistics.mean([abs(e) for e in errors]),rmse=math.sqrt(statistics.mean([e*e for e in errors]))))',
  'json.dump(answer,sys.stdout)',
].join('\n');
const expected=JSON.parse(execFileSync('python3',['-I','-c',python],{input:JSON.stringify(datasets),encoding:'utf8',timeout:10000}));
let checkedFields=0,maxAbsoluteError=0;
for(let repeat=0;repeat<3;repeat++)for(const [i,points]of datasets.entries()){
  const summary=describe(points.map(p=>p.y),true),fit=fitLine(points),errors=errorMetrics(points.map(p=>p.y),points.map(p=>fit.predict(p.x)));
  const actual={mean:summary.mean,sampleSd:summary.sampleSd,standardError:summary.standardError,slope:fit.slope,intercept:fit.intercept,mae:errors.mae,rmse:errors.rmse};
  for(const [key,value]of Object.entries(actual)){const difference=Math.abs(value!-expected[i][key]);assert(difference<=1e-10,key+' differs from independent Python reference');maxAbsoluteError=Math.max(maxAbsoluteError,difference);checkedFields++;}
}
const report={stage:'UA.7',syntheticNumericDatasets:12,distinctGoldFields:84,independentExecutions:3,checkedFields,maxAbsoluteError,absoluteTolerance:1e-10,reference:'Python isolated standard-library statistics.linear_regression/stdev/mean',scientificValidation:false};
await mkdir(resolve('runtime/agent/ua-7'),{recursive:true});await writeFile(resolve('runtime/agent/ua-7/numeric-reference.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

