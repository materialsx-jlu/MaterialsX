import { z } from "zod";
import { elementSymbols } from "./atomistic.js";

export const HUB_VERSION = "m6.7-v1";
export const catalogId = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,127}$/);
const evidenceId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/);
const text = z.string().min(1).max(4096);
const bilingual = z.strictObject({ zh: text, en: text });
const https = z.url().refine(u => { const p=new URL(u); return p.protocol==='https:'&&!p.username&&!p.password; });
const claim = z.enum(["yes", "no", "unknown"]);
export const entityType = z.enum(["checkpoint","family","architecture","training_framework","descriptor","engine","workflow","property_model","commercial_service","classical_forcefield","repository","interop"]);
const nullableText = text.nullable();
const source = z.strictObject({id:evidenceId,url:https,revision:nullableText,sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),status:z.enum(["pinned","documented","candidate"]),note:bilingual});
export const hubEntrySchema = z.strictObject({
  id:catalogId,name:text,aliases:z.array(text).max(30),entityType,family:text,
  category:z.enum(["materials","molecules","catalysis","specialized","physics","resources","properties"]),
  description:bilingual,examples:z.array(bilingual).min(1).max(2),limitations:z.array(bilingual).min(1).max(10),
  sources:z.array(source).min(1).max(25),fieldEvidence:z.record(z.string(),z.array(evidenceId).min(1).max(25)),
  capabilities:z.strictObject({energy:claim,forces:claim,stress:claim,forceRelation:z.enum(["energy_gradient","direct_force","other","unknown"]),
    elements:z.array(z.enum(elementSymbols as [string,...string[]])).min(1).max(118).nullable(),
    periodicity:z.array(z.enum(["bulk","slab","molecule"])).max(3),domains:z.array(text).max(20),
    heads:z.array(z.strictObject({name:text,dataset:nullableText,functional:nullableText,energyReference:nullableText})).max(20),
    headPolicy:z.enum(["single","required","unknown"]),charge:z.enum(["required","unsupported","optional","unknown"]),
    spin:z.strictObject({input:z.enum(["required","unsupported","optional","unknown"]),semantics:z.enum(["multiplicity","per_atom","model_specific","unknown"])}),
    electricField:claim,particleSemantics:z.enum(["all_atom","coarse_grained","virtual_sites","unknown"]),
    cutoffAngstrom:z.number().positive().finite().nullable(),longRange:z.array(z.enum(["electrostatics","dispersion","repulsion","unknown"])).max(4),
    compositionRole:z.enum(["standalone","baseline","correction","composite","unknown"]),requiredComponents:z.array(text).max(20),
    functional:nullableText,dataset:nullableText,units:z.strictObject({energy:nullableText,forces:nullableText,stress:nullableText}),
    temperatureK:z.tuple([z.number().finite(),z.number().finite()]).nullable(),pressureGPa:z.tuple([z.number().finite(),z.number().finite()]).nullable(),tasks:z.array(text).max(20)}),
  asset:z.strictObject({url:https.nullable(),revision:nullableText,sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),bytes:z.number().int().positive().nullable()}),
  licenses:z.strictObject({code:nullableText,weights:nullableText,trainingData:nullableText,redistribution:z.enum(["permitted-with-notices","review-required","restricted","unknown"])}),
  execution:z.strictObject({legacyId:catalogId.nullable(),adapter:nullableText,profileId:nullableText,diskEstimateMiB:z.number().positive().nullable(),memoryEstimateMiB:z.number().positive().nullable(),platforms:z.array(z.strictObject({platform:text,device:text,status:z.enum(['not-tested','unsupported','verified']),evidenceId:evidenceId.nullable()})).max(20),state:z.enum(["legacy_candidate","needs_review","awaiting_adapter","not_a_potential","commercial"]),blockers:z.array(text).min(1).max(20),runtimeEvidenceIds:z.array(evidenceId).max(20),taskEvidenceIds:z.array(evidenceId).max(20)}),
  maintenance:z.enum(["active","archived","discontinued","unknown"]),access:z.enum(["public","gated","commercial","unknown"]),
  reviewedAt:z.iso.datetime(),nextStage:z.enum(["M6.8","M6.10","M6.11","M6.13","M6.14","M6.15"]),relatedIds:z.array(catalogId).max(30),
}).superRefine((e,ctx)=>{
  const ids=new Set(e.sources.map(s=>s.id));
  if(ids.size!==e.sources.length)ctx.addIssue({code:'custom',message:'duplicate source'});
  for(const [field,refs] of Object.entries(e.fieldEvidence))if(refs.some(r=>!ids.has(r)))ctx.addIssue({code:'custom',message:`unknown field evidence: ${field}`});
  for(const [key,value] of Object.entries(e.capabilities)){
    const known=value!==null&&value!=='unknown'&&!(Array.isArray(value)&&value.length===0)&&!(typeof value==='object'&&!Array.isArray(value));
    if(known&&!e.fieldEvidence[`capabilities.${key}`])ctx.addIssue({code:'custom',message:`missing field evidence: ${key}`});
  }
  for(const [field,value] of Object.entries(e.capabilities.spin)){if(value!=='unknown'&&!e.fieldEvidence[`capabilities.spin.${field}`]&&!e.fieldEvidence['capabilities.spin'])ctx.addIssue({code:'custom',message:`missing spin evidence: ${field}`});}
  for(const [field,value] of Object.entries(e.capabilities.units)){if(value!==null&&value!=='unknown'&&!e.fieldEvidence[`capabilities.units.${field}`]&&!e.fieldEvidence['capabilities.units'])ctx.addIssue({code:'custom',message:`missing units evidence: ${field}`});}
  for(const s of e.sources)if(s.status==='pinned'&&(!s.revision||!s.sha256))ctx.addIssue({code:'custom',message:'pinned source requires revision and digest'});
  for(const p of e.execution.platforms)if(p.status==='verified'&&(!p.evidenceId||!e.execution.runtimeEvidenceIds.includes(p.evidenceId)))ctx.addIssue({code:'custom',message:'verified platform requires runtime evidence'});
  for(const range of [e.capabilities.temperatureK,e.capabilities.pressureGPa])if(range&&range[0]>range[1])ctx.addIssue({code:'custom',message:'inverted range'});
  if(e.entityType!=='checkpoint'&&(e.asset.url||e.execution.legacyId))ctx.addIssue({code:'custom',message:'non-checkpoint cannot have executable identity'});
  if(e.asset.sha256&&(!e.asset.url||!e.asset.revision||!e.asset.bytes))ctx.addIssue({code:'custom',message:'incomplete weight identity'});
  if(e.asset.url&&!e.fieldEvidence.asset)ctx.addIssue({code:'custom',message:'missing asset evidence'});
});
export const potentialCatalogSchema = z.strictObject({schemaVersion:z.literal(HUB_VERSION),releaseId:catalogId,reviewedAt:z.iso.datetime(),scope:bilingual,entries:z.array(hubEntrySchema).min(1).max(5000),coverage:z.array(z.strictObject({name:text,entryId:catalogId,reason:bilingual})).min(1).max(5000)}).superRefine((c,ctx)=>{
  const ids=new Set(c.entries.map(e=>e.id));if(ids.size!==c.entries.length)ctx.addIssue({code:'custom',message:'duplicate catalog ID'});
  const identities=new Set<string>();for(const e of c.entries){if(e.asset.sha256){const key=e.asset.sha256+JSON.stringify({heads:e.capabilities.heads,cutoff:e.capabilities.cutoffAngstrom,longRange:e.capabilities.longRange,role:e.capabilities.compositionRole,components:e.capabilities.requiredComponents,particles:e.capabilities.particleSemantics,charge:e.capabilities.charge,spin:e.capabilities.spin});if(identities.has(key))ctx.addIssue({code:'custom',message:'duplicate weight/configuration identity; register mirrors as sources'});identities.add(key);}
    if(e.relatedIds.some(id=>!ids.has(id)))ctx.addIssue({code:'custom',message:'unknown related ID'});}
  if(c.coverage.some(r=>!ids.has(r.entryId)))ctx.addIssue({code:'custom',message:'unmapped coverage name'});
  if(new Set(c.coverage.map(r=>r.name.toLowerCase())).size!==c.coverage.length)ctx.addIssue({code:'custom',message:'duplicate coverage name'});
});
export const catalogSearchSchema = z.strictObject({query:z.string().max(256).default(''),entityType:entityType.optional(),family:text.optional(),category:hubEntrySchema.shape.category.optional(),task:text.optional(),status:hubEntrySchema.shape.execution.shape.state.optional(),elements:z.array(z.enum(elementSymbols as [string,...string[]])).max(118).optional(),periodicity:z.enum(['bulk','slab','molecule']).optional(),requireForces:z.boolean().optional(),offset:z.number().int().min(0).max(5000).default(0),limit:z.number().int().min(1).max(50).default(20)});
export const skillSearchSchema=z.strictObject({query:z.string().max(256),limit:z.number().int().min(1).max(20).default(8)});
/** Content only: no executable scripts, arbitrary paths, dependencies or overwrite permission. Writer comes in M6.9. */
export const userSkillDraftSchema=z.strictObject({schemaVersion:z.literal(HUB_VERSION),name:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).refine(n=>! /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n),'reserved platform name'),description:bilingual,instructions:bilingual,examples:z.array(bilingual).min(1).max(2),potentialIds:z.array(catalogId).max(20),requiredTools:z.array(z.enum(['potential_search','skill_search','materials_science','inspect_atomic_structure','get_atomistic_job','read','write','edit','bash','ls','find','grep','git_status','task_control','research_data','research_delivery','find_tools','read_skill'])).max(20)});
export const userSkillDirectoryContract={root:'<MaterialsX userData>/skills',entry:'<name>/SKILL.md',builtinOverwrite:false,automaticExecution:false,writerStage:'M6.9'} as const;
export type HubEntry=z.infer<typeof hubEntrySchema>;
export type PotentialCatalog=z.infer<typeof potentialCatalogSchema>;
export type CatalogSearchInput=z.input<typeof catalogSearchSchema>;
/** Supplemental records may refer to historical checkpoint IDs; cross-reference checks run after assembly. */
export const catalogSupplementSchema=z.strictObject(potentialCatalogSchema.shape);
