import {normalizeSearch,rankDocuments} from '../../search/src/lexical.js';
import { potentialCatalogSchema,catalogSupplementSchema,catalogSearchSchema,skillSearchSchema,type PotentialCatalog,type HubEntry } from '../../contracts/src/potential-hub.js';
import type { PotentialRegistry } from '../../contracts/src/atomistic.js';
import type { SkillSummary } from '../../contracts/src/desktop.js';
const bi=(zh:string,en:string)=>({zh,en});
/** The historical registry stays immutable. The Hub is a read-only view, never execution authority. */
export function buildPotentialCatalog(legacy:PotentialRegistry,extra:unknown):PotentialCatalog {
 const data=catalogSupplementSchema.parse(extra);
 const entries:HubEntry[]=legacy.potentials.map(p=>{
  const refs=[p.source.id,...p.evidence.map(e=>e.id)];const fieldEvidence:Record<string,string[]>={};
  const capabilities:HubEntry['capabilities']={energy:p.declared.energy,forces:p.declared.forces,stress:p.declared.stress,forceRelation:'unknown',elements:p.declared.elements,periodicity:p.declared.periodicity,domains:p.declared.domains,heads:p.declared.heads.map(name=>({name,dataset:p.energyReference.dataset,functional:p.energyReference.functional,energyReference:p.energyReference.convention})),headPolicy:p.declared.headPolicy,charge:p.declared.chargeInput,spin:{input:p.declared.spinInput,semantics:'unknown'},electricField:'unknown',particleSemantics:'unknown',cutoffAngstrom:null,longRange:[],compositionRole:'unknown',requiredComponents:[],functional:p.energyReference.functional,dataset:p.energyReference.dataset,units:{energy:p.declared.nativeUnits.energy,forces:p.declared.nativeUnits.forces,stress:p.declared.nativeUnits.stress},temperatureK:p.declared.temperatureRangeK,pressureGPa:p.declared.pressureRangeGPa,tasks:[]};
  for(const key of Object.keys(capabilities))fieldEvidence[`capabilities.${key}`]=refs;fieldEvidence.asset=refs;fieldEvidence.licenses=refs;
  const sources=[p.source,...p.evidence].filter((s,i,a)=>a.findIndex(v=>v.id===s.id)===i).map(s=>({id:s.id,url:s.url,revision:s.revision,sha256:s.sha256,status:'pinned' as const,note:bi('M6.0 冻结来源；声明不代表本机验收。','Frozen M6.0 evidence; declared capability is not local validation.')}));
  return {id:p.id,name:p.name,aliases:[p.checkpoint],entityType:'checkpoint',family:p.family,category:p.declared.periodicity.includes('molecule')?'molecules':'materials',description:p.description,examples:p.examples,limitations:p.limitations,sources,fieldEvidence,capabilities,asset:{url:p.weights.url,revision:p.weights.revision,sha256:p.weights.sha256,bytes:p.weights.bytes},licenses:{code:p.licenses.code.expression,weights:p.licenses.weights.expression,trainingData:p.licenses.trainingData.expression,redistribution:p.licenses.redistribution},execution:{legacyId:p.id,adapter:p.environment.adapter,profileId:p.environment.profileId,diskEstimateMiB:p.environment.diskEstimateMiB,memoryEstimateMiB:p.environment.memoryEstimateMiB,platforms:p.environment.matrix,state:'legacy_candidate',blockers:['LOCAL_IDENTITY_AND_TASK_CHECK_REQUIRED'],runtimeEvidenceIds:p.runtimeEvidenceIds,taskEvidenceIds:p.taskEvidenceIds},maintenance:'unknown',access:'unknown',reviewedAt:data.reviewedAt,nextStage:'M6.8',relatedIds:[]};
 });
 return potentialCatalogSchema.parse({...data,entries:[...entries,...data.entries]});
}
export function findCatalogEntry(c:PotentialCatalog,id:string):HubEntry {const entry=c.entries.find(e=>e.id===id);if(!entry)throw Error('UNKNOWN_CATALOG_ID');return entry;}
/** Full local matches; public/agent search still applies its bounded page. */
export function matchCatalogEntries(c:PotentialCatalog,input:unknown){
 const q=catalogSearchSchema.parse(input);
 const term=normalizeSearch(q.query),exact=c.entries.filter(e=>normalizeSearch(e.id)===term||(e.entityType==='checkpoint'||e.entityType==='property_model')&&[e.name,...e.aliases].some(n=>normalizeSearch(n)===term));
 const entries=c.entries.filter(e=>{
  if(exact.length&&!exact.includes(e))return false;
  if(q.entityType&&q.entityType!==e.entityType||q.family&&q.family!==e.family||q.category&&q.category!==e.category||q.status&&q.status!==e.execution.state||q.task&&!e.capabilities.tasks.includes(q.task))return false;
  // Unknown compatibility is excluded from constrained matches. These are declared candidates, not run permits.
  if(q.elements&&(!e.capabilities.elements||q.elements.some(el=>!e.capabilities.elements!.includes(el))))return false;
  if(q.periodicity&&!e.capabilities.periodicity.includes(q.periodicity)||q.requireForces&&e.capabilities.forces!=='yes')return false;
  return true;
 });
 return rankDocuments(entries,q.query,e=>({id:e.id,names:[e.name,...e.aliases,e.family],text:[e.entityType,e.category,e.description.zh,e.description.en,...e.capabilities.domains,...e.capabilities.tasks,...(e.capabilities.elements??[]),e.capabilities.functional??'',e.capabilities.dataset??'']})).map(r=>r.value);
}
export function searchCatalog(c:PotentialCatalog,input:unknown){
 const q=catalogSearchSchema.parse(input),entries=matchCatalogEntries(c,q);
 return {schemaVersion:c.schemaVersion,releaseId:c.releaseId,total:entries.length,offset:q.offset,entries:entries.slice(q.offset,q.offset+q.limit),hasMore:q.offset+q.limit<entries.length,executionAuthority:false};
}
export function searchSkills(skills:SkillSummary[],input:unknown){
 const q=skillSearchSchema.parse(input),matched=rankDocuments(skills,q.query,s=>({id:s.name,text:[s.descriptionZh,s.descriptionEn,s.categoryLabelZh,s.categoryLabelEn,...s.examples.flatMap(e=>[e.zh,e.en])]}));
 return {total:matched.length,skills:matched.slice(0,q.limit).map(({value:s})=>({name:s.name,description:{zh:s.descriptionZh,en:s.descriptionEn},examples:s.examples.slice(0,2),enabled:s.enabled,availability:s.availability??'ready',source:s.source,license:s.license,
  state:s.availability==='planned'?'not-installed':!s.enabled?'disabled':'instructions-available',dependencyPolicy:'Installed instructions do not certify runtime readiness. Read the selected version and check dependencies before use.'})),scope:'installed-local-index',network:false};
}
