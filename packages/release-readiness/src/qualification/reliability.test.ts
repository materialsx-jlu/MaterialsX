import assert from 'node:assert/strict';
import {test} from 'node:test';
import {benchmarkResult,qualificationFingerprint} from '../../../contracts/src/qualification.js';
import {hash} from '../../../atomistic/src/discovery-io.js';
import {reliabilityCases} from '../../../../fixtures/agent/ap6-cases.js';
import {qualifyReliability,reliabilityKeys,verifyReliabilityEvidence,type ReliabilityBatch} from './reliability.js';
const sha='a'.repeat(64),fp=qualificationFingerprint.parse({sourceSha256:sha,suiteSha256:sha,lockSha256:sha,version:'fixture',pi:'fixture',codex:'fixture',mcp:'fixture'});
function batches():ReliabilityBatch[]{return [1,2,3].map(i=>({schemaVersion:'ua14-ap6-batch-evidence-v1',batchIndex:i,runId:'fixture-only-'+i,fingerprint:fp,
 continuityComplete:true,continuityLogSha256:sha,continuityReportSha256:sha,sourceUnchanged:true,buildMatched:true,mode:'real-supplier',startedAt:`2026-10-06T00:0${i}:00.000Z`,finishedAt:`2026-10-06T00:0${i}:01.000Z`,expectedKeys:reliabilityKeys,usedForTuning:[],logSha256:sha,reportSha256:sha,
 rows:reliabilityCases.flatMap(c=>(['codex','reference-codex'] as const).map(subject=>({
  benchmark:benchmarkResult.parse({caseId:c.id,locale:c.locale,subject,conditionSha256:sha,inputSha256:sha,
   model:{id:'model-'+sha.slice(0,32),source:'platform',modelId:'fixture',endpoint:null,protocol:'responses',contextWindow:131072,maxOutputTokens:4096,revision:'fixture'},weightsSha256:null,
   platform:'darwin-arm64',machineSha256:sha,startedAt:`2026-10-06T00:0${i}:00.000Z`,passed:true,checks:{fixtureOnly:true},
   grant:null,taskState:'completed_with_limitations',metrics:{totalMs:100,firstOutputMs:10,inputTokens:100,outputTokens:10,cachedInputTokens:1,requests:1,tools:0,recoveries:0},
   artifacts:[],finalTextSha256:sha,error:null,journalSha256:sha}),intentPassed:true,constraintsPassed:true,terminalVerified:true,requestToolSha256:sha,
  timing:{requestUnionMs:80,toolUnionMs:10,unclassifiedMs:10},
 }))),}));}
const passed=(raw:any[],id:string)=>qualifyReliability(raw,fp).checks.find(c=>c.id===id)!.passed;
test('AP.6 adds frozen bilingual cases and declared held-out pairs without replacing UA.14',()=>{
 assert.equal(reliabilityCases.length,20);assert.equal(reliabilityKeys.length,40);assert.equal(new Set(reliabilityKeys).size,40);
 assert.equal(reliabilityCases.filter(c=>c.heldout).length,6);
 assert.deepEqual(qualifyReliability(batches(),fp).checks.filter(c=>!c.passed).map(c=>c.id),['ap6-heldout-not-tuned'],'source-recorded tuning still blocks an otherwise perfect synthetic batch');
 assert.equal(qualifyReliability(batches(),fp).scientificQualification,false);
});
test('empty imported tuning flags cannot hide source-recorded held-out use',()=>{
 const b=batches();assert(b.every(batch=>batch.usedForTuning.length===0));
 assert(!passed(b,'ap6-heldout-not-tuned'));
 assert.deepEqual(qualifyReliability(b,fp).tuningUses,['UA14-069:zh','UA14-069:en']);
});
test('scripted runs, stale source and selective retry batches cannot grant qualification',()=>{
 const b=batches();b[0]!.mode='scripted-engineering';assert(!passed(b,'ap6-current-real-batches'));
 b[0]!.mode='real-supplier';b[0]!.continuityComplete=false;assert(!passed(b,'ap6-real-continuity'));b[0]!.continuityComplete=true;b[0]!.sourceUnchanged=false;assert(!qualifyReliability(b,fp).passed);
 b[0]!.sourceUnchanged=true;b[1]!.runId=b[0]!.runId;assert(!passed(b,'ap6-history-not-spliced'));
 assert(!qualifyReliability([b[0]],fp).passed);assert(!qualifyReliability([{passed:true}],fp).passed);
});
test('all failed rows remain in denominator; missing languages or duplicate cells never pass',()=>{
 const b=batches();b[0]!.rows[0]!.benchmark.passed=false;assert(!passed(b,'ap6-completion-90'));
 b[0]!.rows[0]!.benchmark.passed=true;b[0]!.rows.pop();assert(!passed(b,'ap6-complete-paired-bilingual'));
 b[0]!.rows.push(b[0]!.rows[0]!);assert(!passed(b,'ap6-complete-paired-bilingual'));
});
test('unknown receipt or usage is not zero and mismatched actual schemas do not compare',()=>{
 const b=batches();b[0]!.rows[0]!.benchmark.metrics.inputTokens=null;assert(!passed(b,'ap6-real-terminal-usage'));
 b[0]!.rows[0]!.benchmark.metrics.inputTokens=100;b[0]!.rows[0]!.terminalVerified=false;assert(!passed(b,'ap6-same-route-tool-budget'));
 b[0]!.rows[0]!.terminalVerified=true;b[0]!.rows[0]!.requestToolSha256='b'.repeat(64);assert(!passed(b,'ap6-same-route-tool-budget'));
 b[0]!.rows[0]!.requestToolSha256=sha;b[0]!.rows[0]!.benchmark.conditionSha256='c'.repeat(64);assert(!passed(b,'ap6-same-route-tool-budget'));
});
test('one permission violation blocks, held-out tuning is recorded, no advice dilution',()=>{
 const b=batches();b[0]!.rows[0]!.constraintsPassed=false;assert(!passed(b,'ap6-constraints-all'));
 b[0]!.rows[0]!.constraintsPassed=true;const c=reliabilityCases.find(c=>c.heldout)!;b[0]!.usedForTuning=[c.id+':'+c.locale];assert(!passed(b,'ap6-heldout-not-tuned'));
});
test('nineteen successful product cases cannot dilute one held-out intent failure',()=>{
 const b=batches(),c=reliabilityCases.find(c=>c.heldout)!;
 b[0]!.rows.find(r=>r.benchmark.subject==='codex'&&r.benchmark.caseId===c.id&&r.benchmark.locale===c.locale)!.intentPassed=false;
 const q=qualifyReliability(b,fp);assert.equal(q.summaries[0]!.intentRate,.95);
 assert.equal(q.summaries[0]!.heldoutIntent.passed,5);
 assert(!passed(b,'ap6-intent-95'));
});
test('performance uses only actual successful pairs; observed residual is not pure host overhead',()=>{
 const b=batches();b[0]!.rows[0]!.benchmark.passed=false;const q=qualifyReliability(b,fp);assert.equal(q.performance.matched,59);
 assert.equal(q.performance.causalHostOverheadQualified,false);
 for(const batch of b)for(const row of batch.rows)if(row.benchmark.subject==='codex')row.timing.unclassifiedMs=99;
 assert(!passed(b,'ap6-observed-coordination-20'));
});
test('batch evidence verifies actual log/report bytes and original baselines, rejects tampering',async()=>{
 const b=batches(),files=new Map<string,Buffer>();
 for(const batch of b){
  const log=Buffer.from('fixture only'),report=Buffer.from(JSON.stringify({results:batch.rows.map(r=>({benchmark:r.benchmark}))}));
  batch.logSha256=hash(log);batch.reportSha256=hash(report);
  const chain=Buffer.from(JSON.stringify({passed:3,executedTasks:3,sourceUnchanged:true}));batch.continuityLogSha256=hash(log);batch.continuityReportSha256=hash(chain);files.set(batch.runId+'/continuity/run.log',log);files.set(batch.runId+'/continuity/report.json',chain);
  for(const [file,data] of [['run.log',log],['report.json',report],['baseline-before.json',Buffer.from(JSON.stringify({fingerprint:fp,buildMatchesSource:true}))],['baseline-after.json',Buffer.from(JSON.stringify({fingerprint:fp,unchanged:true}))]] as const)files.set(batch.runId+'/'+file,data);
 }
 const load=async(id:string,file:string)=>files.get(id+'/'+file)??null;
 assert(await verifyReliabilityEvidence(b,load));b[0]!.rows[0]!.benchmark.passed=false;assert(!await verifyReliabilityEvidence(b,load));
});
