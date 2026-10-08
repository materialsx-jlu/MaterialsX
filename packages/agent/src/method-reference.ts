import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash,canonical,ownedText} from '../../atomistic/src/discovery-io.js';
import {describe,fitLine} from './research-math.js';
import {methodReferenceSchema,type MethodPackage,type MethodPackagePin} from '../../contracts/src/method-packages.js';
export const numericModulePath=fileURLToPath(new URL('../../../experiments/math.mjs',import.meta.url));
export function packageDigest(manifest:MethodPackage):MethodPackagePin{return {id:manifest.id,version:manifest.version,sha256:hash(canonical(manifest))};}
/** Reference input and expected numbers are application-pinned, never supplied by the model. */
export function reproduceMethod(root:string,manifest:MethodPackage){
  if(!['nist-pidigits','nist-norris'].includes(manifest.reference.id))throw Error('METHOD_REFERENCE_ADAPTER_UNAVAILABLE');
  const input=ownedText(join(root,'methods/references',manifest.reference.file),128*1024);
  if(hash(input)!==manifest.reference.sha256)throw Error('METHOD_REFERENCE_CHANGED');
  const certified=manifest.reference.id==='nist-pidigits'?{mean:Number(input.match(/Sample Mean[^\n]*ybar:\s*([-+\d.Ee]+)/)?.[1]),sampleSd:Number(input.match(/Sample Standard Deviation[^\n]*s:\s*([-+\d.Ee]+)/)?.[1])}:
    {intercept:Number(input.match(/\bB0\s+([-+]?\d[\d.Ee+-]*)/)?.[1]),slope:Number(input.match(/\bB1\s+([-+]?\d[\d.Ee+-]*)/)?.[1]),residualSd:Number(input.match(/Residual\s+Standard Deviation\s+([-+\d.Ee]+)/)?.[1]),rSquared:Number(input.match(/R-Squared\s+([-+\d.Ee]+)/)?.[1])};
  if(Object.values(certified).some(v=>!Number.isFinite(v))||canonical(certified)!==canonical(manifest.reference.expected))throw Error('METHOD_CERTIFIED_VALUES_MISMATCH');
  const executionSha256=hash(readFileSync(numericModulePath));
  if(executionSha256!==manifest.execution.files.find(f=>f.path==='experiments/math.mjs')?.sha256)throw Error('METHOD_EXECUTABLE_CHANGED');
  const rows=input.slice(input.indexOf('Data:')).split(/\r?\n/).filter(l=>/^\s*[-+\d.]+(?:\s+[-+\d.Ee]+)?\s*$/.test(l)).map(l=>l.trim().split(/\s+/).map(Number)).filter(r=>r.every(Number.isFinite));
  let actual:Record<string,number>;
  if(manifest.execution.backend==='summary-v1'){
    if(rows.length!==5000||rows.some(r=>r.length!==1))throw Error('METHOD_REFERENCE_ROWS_INVALID');
    const s=describe(rows.map(r=>r[0]!),true);actual={mean:s.mean,sampleSd:s.sampleSd!};
  }else if(manifest.execution.backend==='ols-v1'){
    if(rows.length!==36||rows.some(r=>r.length!==2))throw Error('METHOD_REFERENCE_ROWS_INVALID');
    const f=fitLine(rows.map(r=>({x:r[1]!,y:r[0]!})));actual={intercept:f.intercept,slope:f.slope,residualSd:f.residualSd,rSquared:f.rSquared!};
  }else throw Error('METHOD_ADAPTER_UNAVAILABLE');
  if(canonical(Object.keys(actual).sort())!==canonical(Object.keys(manifest.reference.expected).sort()))throw Error('METHOD_REFERENCE_FIELDS_INVALID');
  const checks=Object.entries(manifest.reference.expected).map(([field,expected])=>{const value=actual[field]!,error=Math.abs(value-expected),tolerance=manifest.reference.absoluteTolerance+manifest.reference.relativeTolerance*Math.abs(expected);return {field,actual:value,expected,error,tolerance,passed:error<=tolerance};});
  return methodReferenceSchema.parse({id:randomUUID(),at:new Date().toISOString(),pin:packageDigest(manifest),referenceSha256:hash(input),executionSha256,
    environment:{node:process.versions.node,platform:process.platform,arch:process.arch},status:checks.every(c=>c.passed)?'passed':'failed',checks,domainValidated:false,productionApproved:false});
}
