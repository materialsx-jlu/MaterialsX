import {randomUUID} from 'node:crypto';
import type {ResearchSnapshot} from '../../contracts/src/research-project.js';
import type {QualityReport,ScientificCheck,ScientificClaim} from '../../contracts/src/scientific-quality.js';
import {canonical} from './execution-context.js';
import {sourceHash} from './data-source-router.js';

export type SourceRow=Record<string,unknown>;
export const stable=(v:unknown)=>JSON.stringify(canonical(v));
export function sourceRows(s:ResearchSnapshot,section:string):SourceRow[]{
  const rows=s.data[section]??[];
  if(!Array.isArray(rows)||rows.length>500||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('SCIENTIFIC_ROWS_INVALID_OR_LIMIT');
  return rows as SourceRow[];
}
export const rowKey=(s:ResearchSnapshot,r:SourceRow)=>s.id+':'+String(r.id);
export function ownedRow(s:ResearchSnapshot,section:string,id:string){
  const found=sourceRows(s,section).filter(r=>r.id===id);
  if(found.length!==1)throw Error('SCIENTIFIC_ROW_NOT_UNIQUELY_OWNED');return found[0]!;
}
export const compositionBasis=(r:SourceRow)=>r.amount_basis??r.basis??(r.conditions as SourceRow|undefined)?.composition_basis??null;
export const energyReference=(r:SourceRow)=>r.energy_reference??(r.conditions as SourceRow|undefined)?.energy_reference??null;
export function comparisonSignature(r:SourceRow){
  return stable({property:r.property,unit:r.unit,conditions:r.conditions,basis:compositionBasis(r),energyReference:energyReference(r)});
}
/** Unknown independence never becomes a replicate count. MOOS source is a conservative leakage group. */
export function leakageGroup(s:ResearchSnapshot,r:SourceRow){
  if(s.ref)return 'moos:'+s.ref.connectionId+':'+s.ref.sourceId;
  const declared=r.study_id??r.source_document_id??s.data.sourceDocumentId;
  return declared?'document:'+String(declared):'local:'+s.sha256;
}
export function independentSample(s:ResearchSnapshot,r:SourceRow):string|null{
  if(r.replicate_kind!=='independent'||r.aggregation&&r.aggregation!=='raw')return null;
  const sample=r.specimen_id??r.replicate_id;
  return typeof sample==='string'&&sample.trim()?leakageGroup(s,r)+':'+sample:null;
}
function evidenceCheck(s:ResearchSnapshot,ids:unknown):boolean{
  return Array.isArray(ids)&&ids.length>0&&ids.every(id=>typeof id==='string'&&s.evidence.some(e=>e.locator===id)&&
    sourceRows(s,'readEvidence').some(e=>e.id===id||e.evidence_id===id));
}
function checkClaims(snapshots:ResearchSnapshot[],claims:ScientificClaim[],checks:ScientificCheck[]){
  for(const c of claims){
    let linked=true,kind=true,quantity=c.quantity===undefined;
    const refs:string[]=[];
    for(const f of c.refs){
      const s=snapshots.find(s=>s.id===f.snapshotId);let row:SourceRow|undefined;
      try{if(s)row=ownedRow(s,f.section,f.rowId);}catch{linked=false;}
      refs.push(f.snapshotId+':'+f.rowId+'.'+f.field);
      if(!s||!row||!(f.field in row)||!evidenceCheck(s,f.evidenceIds)||
        !f.evidenceIds.every(id=>Array.isArray(row!.evidence_ids)&&(row!.evidence_ids as unknown[]).includes(id)))linked=false;
      if(row){
        const reportedKind=row.origin??row.value_origin??'reported';
        if(reportedKind!==c.kind)kind=false;
        if(c.quantity&&['value','amount'].includes(f.field)&&row[f.field]===c.quantity.value&&row.unit===c.quantity.unit)quantity=true;
      }
    }
    checks.push({code:'CLAIM_LINK:'+c.id,status:linked?'pass':'blocked',refs,detail:'Every field and evidence ID must belong to the pinned source row; model text is not a source.'},
      {code:'CLAIM_KIND:'+c.id,status:kind?'pass':'blocked',refs,detail:'Reported, calculated and predicted origins cannot be relabeled.'},
      {code:'CLAIM_QUANTITY:'+c.id,status:quantity?'pass':'blocked',refs,detail:'Quantity must exactly match at least one linked original value and unit; no implicit conversion.'},
      {code:'CLAIM_SEMANTICS:'+c.id,status:'warning',refs,detail:'Field linkage does not prove that the natural-language conclusion or causality is correct; scientific review is required.'});
  }
}
/** Domain quality is independent from technical completion. Never stamps validated or mutates physical inputs. */
export function assessScientificQuality(projectId:string,taskId:string|null,snapshots:ResearchSnapshot[],claims:ScientificClaim[]=[],
  invalidSources:ReadonlySet<string>=new Set()):QualityReport{
  const checks:ScientificCheck[]=[];
  const add=(code:string,status:ScientificCheck['status'],refs:string[],detail:string)=>checks.push({code,status,refs,detail});
  const exact=new Map<string,string>(),compared=new Map<string,Array<{ref:string;row:SourceRow}>>();
  for(const s of snapshots){
    add('SOURCE_HASH',sourceHash(s.data)===s.sha256?'pass':'blocked',[s.id],'Pinned input content must match its stored hash.');
    add('SOURCE_VERSION',invalidSources.has(s.id)?'blocked':'pass',[s.id],'Updated, withdrawn, denied or retracted versions cannot support current conclusions.');
    add('EXTRACTION_REVIEW',s.reviewStatus==='verified'?'pass':'warning',[s.id],'Extraction review does not certify scientific accuracy.');
    for(const section of ['observations','ingredients','recipes','processes']){
      const rows=sourceRows(s,section),ids=new Set<string>();
      for(const r of rows){
        const ref=rowKey(s,r),id=typeof r.id==='string'?r.id:'';
        if(!id||ids.has(id))add('ROW_ID','blocked',[ref],'Source rows need unique, nonempty string IDs.');ids.add(id);
        add('FIELD_EVIDENCE',evidenceCheck(s,r.evidence_ids)?'pass':'warning',[ref],'Original evidence must be both registered and read; absent evidence cannot support a claim.');
        if(section==='observations'||section==='ingredients'){
          const value=r.value??r.amount;
          if(typeof value==='number'&&!Number.isFinite(value))add('NONFINITE_VALUE','blocked',[ref],'Nonfinite numeric input is invalid.');
          add('ORIGINAL_UNIT',typeof r.unit==='string'&&!!r.unit.trim()?'pass':'warning',[ref],'Keep original units; missing or mixed units are not converted.');
        }
        if(section==='ingredients')add('COMPOSITION_BASIS',compositionBasis(r)!==null?'pass':'warning',[ref],'Mass, volume, molar and phr bases cannot be interchanged without explicit evidence.');
        if(section==='observations'){
          add('TEST_CONDITIONS',!!r.conditions&&typeof r.conditions==='object'&&Object.keys(r.conditions).length>0?'pass':'warning',[ref],'Temperature, method and other reported measurement conditions are preserved.');
          const key=comparisonSignature(r),old=exact.get(key+':'+stable(r.value)+':'+leakageGroup(s,r)+':'+stable(r.evidence_ids));
          if(old)add('DUPLICATE_REPORT','warning',[old,ref],'Repeated source/condition/value/evidence is not an independent replicate.');
          else exact.set(key+':'+stable(r.value)+':'+leakageGroup(s,r)+':'+stable(r.evidence_ids),ref);
          const group=compared.get(key)??[];group.push({ref,row:r});compared.set(key,group);
          const uncertainty=r.uncertainty;
          if(uncertainty!==undefined)add('UNCERTAINTY_DEFINITION',!!uncertainty&&typeof uncertainty==='object'&&
            ['sd','sem','ci','range','instrument'].includes(String((uncertainty as SourceRow).kind))&&
            typeof (uncertainty as SourceRow).value==='number'&&Number.isFinite((uncertainty as SourceRow).value)&&Number((uncertainty as SourceRow).value)>=0&&
            (uncertainty as SourceRow).unit===r.unit&&typeof (uncertainty as SourceRow).n==='number'&&Number.isInteger((uncertainty as SourceRow).n)&&Number((uncertainty as SourceRow).n)>=2?'pass':'warning',[ref],
            'Keep uncertainty kind, value, original unit and replicate count; SD, SEM, interval and instrument error are distinct.');
          if(/energy|能量/i.test(String(r.property)))add('ENERGY_REFERENCE',energyReference(r)!==null?'pass':'warning',[ref],'Energy reference and total/per-atom basis must be explicit; models are not aligned by averaging or fitted offsets.');
        }
      }
    }
  }
  for(const group of compared.values())if(group.length>1&&new Set(group.map(g=>stable(g.row.value))).size>1)
    add('REPORTED_DISAGREEMENT','warning',group.map(g=>g.ref),'Different values under matching recorded conditions require inspection; incomplete conditions may hide differences. No conflict is averaged away.');
  checkClaims(snapshots,claims,checks);
  if(checks.length>600)throw Error('SCIENTIFIC_CHECK_LIMIT');
  return {id:randomUUID(),projectId,taskId,createdAt:new Date().toISOString(),policyVersion:'ua7-quality-v1',scientificStatus:'needs_review',
    decision:invalidSources.size?'stale':checks.some(c=>c.status==='blocked')?'blocked':'usable-with-limitations',
    inputs:snapshots.map(s=>({id:s.id,version:s.version,sha256:s.sha256})),claims,checks,artifacts:[]};
}
