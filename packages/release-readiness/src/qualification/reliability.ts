import {z} from 'zod';
import {benchmarkResult,qualificationFingerprint,type QualificationFingerprint} from '../../../contracts/src/qualification.js';
import {reliabilityCases,reliabilityTuningUses} from '../../../../fixtures/agent/ap6-cases.js';
import {canonical,hash} from '../../../atomistic/src/discovery-io.js';
import {percentile} from './metrics.js';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const reliabilityBatch=z.strictObject({
 schemaVersion:z.literal('ua14-ap6-batch-evidence-v1'),batchIndex:z.number().int().min(1),runId:z.string().min(1),
 fingerprint:qualificationFingerprint,sourceUnchanged:z.boolean(),buildMatched:z.boolean(),
 continuityComplete:z.boolean(),continuityLogSha256:digest,continuityReportSha256:digest.nullable(),
 mode:z.enum(['real-supplier','scripted-engineering']),startedAt:z.iso.datetime(),finishedAt:z.iso.datetime(),
 expectedKeys:z.array(z.string()),usedForTuning:z.array(z.string()),logSha256:digest,reportSha256:digest.nullable(),
 rows:z.array(z.strictObject({benchmark:benchmarkResult,intentPassed:z.boolean(),constraintsPassed:z.boolean(),
  terminalVerified:z.boolean(),requestToolSha256:digest.nullable(),timing:z.strictObject({
   requestUnionMs:z.number().nonnegative(),toolUnionMs:z.number().nonnegative(),unclassifiedMs:z.number().nonnegative(),
  })})),
});
export type ReliabilityBatch=z.infer<typeof reliabilityBatch>;
const cell=(r:{caseId:string;locale:string;subject:string})=>r.caseId+':'+r.locale+':'+r.subject;
export const reliabilityKeys=reliabilityCases.flatMap(c=>['codex','reference-codex'].map(subject=>cell({caseId:c.id,locale:c.locale,subject})));
/** Supplemental UA.14 qualification, never substitutes scripted results for real calls or drops failed batches. */
export function qualifyReliability(raw:unknown[],fp:QualificationFingerprint){
 const checks:Array<{id:string;passed:boolean;reason:string}>=[];
 const add=(id:string,passed:boolean,reason:string)=>checks.push({id,passed,reason});
 const parsed=raw.map(r=>reliabilityBatch.safeParse(r));
 const batches=parsed.flatMap(p=>p.success?[p.data]:[]);
 const current=parsed.length===batches.length&&batches.length>=3&&batches.every(b=>b.mode==='real-supplier'&&b.sourceUnchanged&&b.buildMatched&&canonical(b.fingerprint)===canonical(fp));
 add('ap6-current-real-batches',current,'At least three frozen real-supplier batches; scripted engineering cannot qualify.');
 const chronological=batches.every((b,i)=>b.batchIndex===i+1&&Date.parse(b.startedAt)<=Date.parse(b.finishedAt)&&(i===0||Date.parse(b.startedAt)>=Date.parse(batches[i-1]!.finishedAt)));
 add('ap6-history-not-spliced',chronological&&new Set(batches.map(b=>b.runId)).size===batches.length,'Ordered complete batches, no reused IDs, selective retries or duplicates.');
 const complete=current&&batches.every(b=>canonical([...b.expectedKeys].sort())===canonical([...reliabilityKeys].sort())&&
  b.rows.length===reliabilityKeys.length&&new Set(b.rows.map(r=>cell(r.benchmark))).size===reliabilityKeys.length&&reliabilityKeys.every(k=>b.rows.some(r=>cell(r.benchmark)===k)));
 add('ap6-complete-paired-bilingual',complete,'Every frozen bilingual case must appear for MaterialsX and reference; omissions are not successes.');
 const heldout=reliabilityCases.filter(c=>c.heldout).map(c=>c.id+':'+c.locale);
 add('ap6-real-continuity',complete&&batches.every(b=>b.continuityComplete),'Three actual linked tasks including changed requirements and restart, in each batch; protocol simulation cannot substitute.');
 add('ap6-heldout-not-tuned',complete&&batches.every(b=>![...reliabilityTuningUses,...b.usedForTuning].some(k=>heldout.includes(k))),'Held-out cases used to tune a repair are no longer held out; source-recorded use cannot be erased in a batch report.');
 const summaries=batches.map(b=>{
  const product=b.rows.filter(r=>r.benchmark.subject==='codex');
  const heldoutRows=product.filter(r=>heldout.includes(r.benchmark.caseId+':'+r.benchmark.locale));
  const rate=(fn:(r:typeof product[number])=>boolean)=>product.length?product.filter(fn).length/product.length:null;
  const groups=[...new Set(reliabilityCases.map(c=>c.family))].map(family=>{
   const keys=reliabilityCases.filter(c=>c.family===family).map(c=>c.id+':'+c.locale);
   const rows=product.filter(r=>keys.includes(r.benchmark.caseId+':'+r.benchmark.locale));
   return {family,count:rows.length,passed:rows.filter(r=>r.benchmark.passed).length};
  });
  return {batchIndex:b.batchIndex,cases:product.length,intentRate:rate(r=>r.intentPassed),
   heldoutIntent:{count:heldoutRows.length,passed:heldoutRows.filter(r=>r.intentPassed).length,rate:heldoutRows.length?heldoutRows.filter(r=>r.intentPassed).length/heldoutRows.length:null},
   completionRate:rate(r=>r.benchmark.passed),groups,
   languages:['zh','en'].map(locale=>{const rows=product.filter(r=>r.benchmark.locale===locale);return {locale,count:rows.length,passed:rows.filter(r=>r.benchmark.passed).length};})};
 });
 add('ap6-intent-95',complete&&summaries.every(s=>s.heldoutIntent.count===heldout.length&&s.heldoutIntent.rate!==null&&s.heldoutIntent.rate>=.95),'Bounded held-out assertions ≥95% per complete batch; training/advice cases cannot dilute failure; broader semantic/expert review separate.');
 add('ap6-completion-90',complete&&summaries.every(s=>s.completionRate!==null&&s.completionRate>=.9&&s.groups.every(g=>g.count>0&&g.passed/g.count>=.9)),'≥90% in each full batch and family; advice cannot hide execution failures.');
 add('ap6-constraints-all',complete&&batches.every(b=>b.rows.every(r=>r.constraintsPassed)),'Every declared boundary assertion must pass, for both subjects.');
 add('ap6-real-terminal-usage',complete&&batches.every(b=>b.rows.every(r=>r.terminalVerified&&r.benchmark.metrics.inputTokens!==null&&r.benchmark.metrics.outputTokens!==null)),'Unknown terminal/usage is not zero, success or settled credit.');
 const paired=batches.flatMap(b=>reliabilityCases.map(c=>{
  const p=b.rows.find(r=>cell(r.benchmark)===cell({caseId:c.id,locale:c.locale,subject:'codex'}));
  const r=b.rows.find(r=>cell(r.benchmark)===cell({caseId:c.id,locale:c.locale,subject:'reference-codex'}));
  const comparable=!!p&&!!r&&p.benchmark.passed&&r.benchmark.passed&&p.terminalVerified&&r.terminalVerified&&
   p.benchmark.conditionSha256===r.benchmark.conditionSha256&&p.benchmark.inputSha256===r.benchmark.inputSha256&&
   canonical(p.benchmark.model)===canonical(r.benchmark.model)&&p.benchmark.machineSha256===r.benchmark.machineSha256&&
   p.requestToolSha256!==null&&p.requestToolSha256===r.requestToolSha256;
  return {batch:b.batchIndex,caseId:c.id,locale:c.locale,comparable,product:p?.benchmark.metrics,reference:r?.benchmark.metrics,
   productObserved:p?.timing,referenceObserved:r?.timing};
 }));
 add('ap6-same-route-tool-budget',complete&&paired.every(p=>p.comparable),'Actual same route/protocol/schema/input/machine/budget, complete results; advertised identity only.');
 const matched=paired.filter(p=>p.comparable);
 const summary=(subject:'product'|'reference')=>({
  count:matched.length,p50TotalMs:percentile(matched.map(p=>p[subject]!.totalMs),.5),p95TotalMs:percentile(matched.map(p=>p[subject]!.totalMs),.95),
  p50FirstContentMs:percentile(matched.flatMap(p=>p[subject]!.firstOutputMs===null?[]:[p[subject]!.firstOutputMs!]),.5),
  p95FirstContentMs:percentile(matched.flatMap(p=>p[subject]!.firstOutputMs===null?[]:[p[subject]!.firstOutputMs!]),.95),
  p50Requests:percentile(matched.map(p=>p[subject]!.requests),.5),
 });
 const performance={product:summary('product'),reference:summary('reference'),matched:matched.length,total:paired.length,
  causalHostOverheadQualified:false,interpretation:'Request time includes gateway/network/supplier; residual includes native coordination and setup, not pure host overhead. No performance uplift claim from unmatched or failed cases.'};
 const increments=matched.map(p=>p.productObserved!.unclassifiedMs-p.referenceObserved!.unclassifiedMs);
 const medianIncrement=percentile(increments,.5),referenceMedian=performance.reference.p50TotalMs;
 Object.assign(performance,{p50ObservedCoordinationIncrementMs:medianIncrement,observedIncrementRatio:medianIncrement!==null&&referenceMedian?medianIncrement/referenceMedian:null});
 add('ap6-observed-coordination-20',complete&&paired.every(p=>p.comparable)&&medianIncrement!==null&&referenceMedian!==null&&referenceMedian>0&&medianIncrement<=referenceMedian*.2,'Observed coordination residual median increment ≤20% of reference total; not isolated causal host overhead.');
 return {schemaVersion:'ua14-ap6-qualification-v1',fingerprint:fp,passed:checks.every(c=>c.passed),checks,summaries,performance,
  scientificQualification:false,tuningUses:reliabilityTuningUses,modelIdentity:'advertised supplier model; weights not independently verified',
  evidenceSha256:hash(canonical(batches)),sampleScope:'Additional AP.6 synthetic cases only, not the existing 60-case UA.14 suite or commercial Codex parity'};
}

/** Disk-backed receipts are mandatory; flags in an imported JSON alone cannot grant qualification. */
export async function verifyReliabilityEvidence(raw:unknown[],load:(runId:string,file:string)=>Promise<Buffer|null>){
 for(const input of raw){
  const parsed=reliabilityBatch.safeParse(input);if(!parsed.success)return false;const b=parsed.data;
  const log=await load(b.runId,'run.log'),report=await load(b.runId,'report.json'),continuityLog=await load(b.runId,'continuity/run.log'),continuity=await load(b.runId,'continuity/report.json');
  if(!continuityLog||hash(continuityLog)!==b.continuityLogSha256||!continuity||hash(continuity)!==b.continuityReportSha256)return false;
  if(!log||hash(log)!==b.logSha256||!report||hash(report)!==b.reportSha256)return false;
  try{
   const chain=JSON.parse(continuity.toString());
   if(b.continuityComplete!==(chain.passed===3&&chain.executedTasks===3&&chain.sourceUnchanged===true))return false;
   const original=JSON.parse(report.toString()),rows=original.results.filter((r:any)=>r.benchmark);
   if(rows.length!==b.rows.length||rows.some((r:any,i:number)=>canonical(r.benchmark)!==canonical(b.rows[i]!.benchmark)))return false;
   const before=JSON.parse((await load(b.runId,'baseline-before.json'))!.toString());
   const after=JSON.parse((await load(b.runId,'baseline-after.json'))!.toString());
   if(before.buildMatchesSource!==true||after.unchanged!==true||canonical(before.fingerprint)!==canonical(b.fingerprint)||canonical(after.fingerprint)!==canonical(b.fingerprint))return false;
  }catch{return false;}
 }
 return raw.length>=3;
}
