import type {ResearchBinding,ResearchSnapshot,DeliveryRecord} from '../../contracts/src/research-project.js';
import type {ResearchRow} from './research-delivery.js';
import {canonical} from './execution-context.js';
/** Frozen scientific criteria; technical file existence/hash checks stay in research-delivery. */
export function validateDeliveryScience(binding:ResearchBinding,snapshots:ResearchSnapshot[],rows:ResearchRow[],result:any):Pick<DeliveryRecord,'checks'|'limitations'|'status'>{
  const checks:DeliveryRecord['checks']=[],limitations: string[]=[], c=binding.delivery;
  const add=(id:string,ok:boolean,detail:string,limitation?:string)=>{
    const allowed=!ok&&!!limitation&&c.allowedLimitations.includes(limitation as any);
    checks.push({id,status:ok?'pass':allowed?'allowed':'fail',detail});if(!ok&&limitation)limitations.push(limitation);
  };
  if(result.scientificQuality){
    add('source-quality',result.scientificQuality.decision==='usable-with-limitations','Source integrity and version gate; review warnings remain separate from file acceptance');
    for(const q of result.scientificQuality.checks??[])if(q.status==='warning')limitations.push(q.code);
  }
  add('review',snapshots.every(s=>s.reviewStatus==='verified'),'Reviewed extraction is not independent scientific validation',c.requireReviewed?undefined:'unreviewed');
  add('evidence',!c.requireEvidence||(snapshots.length>0&&snapshots.every(s=>s.evidence.length>0)),'At least one read evidence receipt per selected source');
  for(const s of snapshots)for(const row of rows.filter(r=>r.snapshotId===s.id&&r.section!=='missing-input')){
    if(c.requireEvidence)add('evidence:'+row.id,row.evidenceIds.length>0&&row.evidenceIds.every(id=>s.evidence.some(e=>e.locator===id)),'Every row evidence ID must have a real source receipt');
    if(row.section==='observations'){
      add('unit:'+row.id,!!row.unit,'Original reported unit', 'missing-unit');
      add('condition:'+row.id,!!row.conditions&&Object.keys(row.conditions as object).length>0,'Reported measurement conditions','missing-condition');
    }
  }
  if(c.kind==='comparison')add('comparability',Array.isArray(result.assessments)&&result.assessments.length>0&&result.assessments.every((a:any)=>a.state==='comparable'),'MOOS conservative comparison; no average, rank or causal inference for incompatible observations','not-comparable');
  if(c.kind==='simulation-gaps')add('simulation',false,'Reported simulation declaration only; no calculation was executed','simulation-not-executed');
  for(const [i,criterion]of c.checks.entries()){
    let expectedCondition:unknown;try{expectedCondition=JSON.parse(criterion.condition);}catch{expectedCondition=undefined;}
    const candidates=rows.filter(r=>r.property===criterion.property&&r.unit===criterion.unit&&expectedCondition!==undefined&&JSON.stringify(canonical(r.conditions))===JSON.stringify(canonical(expectedCondition)));
    const ok=candidates.length===1&&typeof candidates[0]!.value==='number'&&Math.abs(candidates[0]!.value-criterion.expected)<=criterion.tolerance;
    add('value:'+i,ok,'Exact property, original unit, conditions and absolute tolerance; ambiguous matches do not pass');
  }
  return {checks,limitations:[...new Set(limitations)],status:checks.some(c=>c.status==='fail')?'blocked':'accepted-with-limitations'};
}
