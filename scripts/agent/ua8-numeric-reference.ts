import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {analyzeTensile} from '../../experiments/tensile.mjs';
import {tensileFixture,fixtureCsv} from '../../tests/fixtures/agent/ua8-tensile.js';
import {zipFixture,xlsxParts} from '../../tests/fixtures/agent/ua8-xlsx.js';
import {parseExperimentCsv,parseExperimentXlsx} from '../../packages/agent/src/experiment-input.js';
const exec=promisify(execFile),root=process.cwd(),directory=join(root,'runtime/agent/ua-8');
const cases=Array.from({length:12},(_,i)=>{
  const s=tensileFixture(i);s.table.rows.forEach((r,j)=>{if(j<=5)r.values.stress=String(Number(r.values.stress)+(j%3-1)*(s.config.yUnit==='GPa'?.00007:s.config.yUnit==='kN'?.0007:.07));});
  return s;
});
// Independent rational-arithmetic OLS reference. No import of MaterialsX algorithms or fitted outputs.
const reference=String.raw`import json,sys,math
from fractions import Fraction as F
samples=json.loads(sys.argv[1]);results=[]
for s in samples:
 c=s['config'];force=c['mode']=='force-displacement';xs={'1':F(1),'%':F(1,100),'mm':F(1),'m':F(1000)}[c['xUnit']];ys={'Pa':F(1,1000000),'MPa':F(1),'GPa':F(1000),'N':F(1),'kN':F(1000)}[c['yUnit']]
 points=[]
 for r in s['table']['rows']:
  x=F(r['values'][c['xColumn']])*xs/(F(str(c['gaugeLengthMm'])) if force else 1)
  y=F(r['values'][c['yColumn']])*ys/(F(str(c['areaMm2'])) if force else 1)
  points.append((x,y))
 fit=[p for p in points if F(str(c['fitRange'][0]))<=p[0]<=F(str(c['fitRange'][1]))];n=len(fit)
 sx=sum(x for x,y in fit);sy=sum(y for x,y in fit);sxx=sum(x*x for x,y in fit);sxy=sum(x*y for x,y in fit)
 slope=(n*sxy-sx*sy)/(n*sxx-sx*sx);intercept=(sy-slope*sx)/n
 sse=sum((y-intercept-slope*x)**2 for x,y in fit);total=sum((y-sy/n)**2 for x,y in fit);peak=max(points,key=lambda p:p[1])
 results.append({'slopeMPa':float(slope),'interceptMPa':float(intercept),'rSquared':float(1-sse/total),'residualSdMPa':math.sqrt(float(sse)/(n-2)),'rows':n,'observedPeakStressMPa':float(peak[1]),'strainAtObservedPeak':float(peak[0])})
print(json.dumps(results))`;
const python=join(root,process.platform==='win32'?'runtime/skill-python/windows-x64/python.exe':'runtime/skill-python/macos-arm64/bin/python3.12');
const {stdout}=await exec(python,['-I','-B','-c',reference,JSON.stringify(cases)],{timeout:30000,maxBuffer:1024*1024});
const expected=JSON.parse(stdout) as Array<Record<string,number>>;let fields=0,maxAbsoluteError=0;
for(let repeat=0;repeat<3;repeat++)for(const [i,s]of cases.entries()){
  const table=i%2?parseExperimentXlsx(zipFixture(xlsxParts(s.table))):parseExperimentCsv(Buffer.from(fixtureCsv(s.table))),r=analyzeTensile([{...s,table}]),c=r.curves[0]!;
  const values={...c.fit,observedPeakStressMPa:c.observedPeakStressMPa,strainAtObservedPeak:c.strainAtObservedPeak};
  for(const [key,v]of Object.entries(expected[i]!)){const actual=(values as Record<string,unknown>)[key];assert.equal(typeof actual,'number');const error=Math.abs((actual as number)-v),tolerance=1e-8*Math.max(1,Math.abs(v));assert(error<=tolerance,`${i}/${key}: ${actual} vs ${v}`);fields++;maxAbsoluteError=Math.max(error,maxAbsoluteError);}
  assert.equal(r.statistics.fitSlopeMPa.sampleSd,null);assert.equal(r.scientificStatus,'needs_review');
}
const sources=['experiments/tensile.mjs','experiments/math.mjs','packages/agent/src/experiment-input.ts'];const hashes=Object.fromEntries(await Promise.all(sources.map(async p=>[p,createHash('sha256').update(await readFile(join(root,p))).digest('hex')])));
await mkdir(directory,{recursive:true});await writeFile(join(directory,'numeric-reference.json'),JSON.stringify({passed:true,syntheticOnly:true,cases:12,runs:3,fields,maxAbsoluteError,tolerance:'1e-8 * max(1,abs(reference))',reference:'Independent Python standard-library Fraction OLS',formats:['csv','xlsx'],sourceHashes:hashes,realInstrumentQualified:false,scientificStatus:'needs_review',threeScenarioReleaseQualified:false},null,2)+'\n');
console.log(JSON.stringify({passed:true,cases:12,runs:3,fields,maxAbsoluteError}));
