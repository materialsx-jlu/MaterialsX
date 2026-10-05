import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPotentialCatalog,findCatalogEntry,searchCatalog,searchSkills } from './potential-hub.js';
import { parsePotentialRegistry } from './registry.js';
import { potentialCatalogSchema,hubEntrySchema } from '../../contracts/src/potential-hub.js';
import { runnablePotentialId } from '../../contracts/src/atomistic-runtime.js';
import { planUserSkill } from './skill-draft.js';
import type { SkillSummary } from '../../contracts/src/desktop.js';
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const legacy=parsePotentialRegistry(json('models/potentials/registry.json'));
const c=buildPotentialCatalog(legacy,json('models/potentials/catalog-m67.json'));
test('broad catalog assembles without modifying frozen M6.0 identities or claiming runtime passes',()=>{
 assert.equal(c.entries.length,173);assert.equal(c.entries.filter(e=>e.entityType==='checkpoint').length,20);
 assert.equal(c.coverage.length,194);assert.equal(legacy.potentials.length,16);
 for(const p of legacy.potentials){const e=findCatalogEntry(c,p.id);assert.deepEqual(e.asset,{url:p.weights.url,revision:p.weights.revision,sha256:p.weights.sha256,bytes:p.weights.bytes});assert.equal(e.execution.legacyId,p.id);}
 for(const e of c.entries){assert.ok(e.description.zh&&e.description.en);assert.equal(e.examples.length,2);assert.equal(e.execution.runtimeEvidenceIds.length,0);assert.equal(e.execution.taskEvidenceIds.length,0);}
 for(const name of ['MACE-MP-0a','MACE-MH-0','CHGNet','MatterSim-MT','SevenNet-MF-ompa','GRACE-3L','NequIP-OAM','Allegro-OAM','PET-OAM','ALIGNN-FF','Matlantis','DPA-4','ANI-1xnr','AIMNet2-RXN','FeNNix-Bio1','GemNet-OC','eSEN','SOAP-GAP','MTP','ACE','qSNAP','fast POD','HDNNP','ænet-PyTorch','PANNA','DeepPot-SE','NEP89','CACE','AGNI','RANN','TensorNet2','TorchMD-NET ET','SpookyNet','NewtonNet','sGDML','DPLR','DeepSpin','Latent Ewald Summation','4G-HDNNP','Δ-learning','GAP-HfO2','GAP-LiCl-KCl','Li–C GAP','MACE-MDP','PET-MAD-DOS','SOAP','ACSF','bispectrum','GPUMD','DP-GEN','AMBER','CHARMM','qNEP','DPA4C','FIREANN','RuNNer','Amp','OpenKIM','NIST IPR','metatomic'])assert.ok(c.coverage.some(r=>r.name===name),name);
});
test('aliases, bilingual terms, filters and pagination use the same catalog; unknown compatibility is excluded',()=>{
 assert.ok(searchCatalog(c,{query:'电解液'}).entries.some(e=>e.name==='BAMBOO'));
 assert.equal(searchCatalog(c,{query:'pacemaker'}).entries[0]?.name,'PACE');
 assert.ok(searchCatalog(c,{query:'CHGNet r2SCAN'}).entries.some(e=>e.id==='chgnet-r2scan'));
 assert.deepEqual(searchCatalog(c,{query:'分子'}).entries,searchCatalog(c,{query:'molecular'}).entries);
 const a=searchCatalog(c,{entityType:'checkpoint',limit:10}),b=searchCatalog(c,{entityType:'checkpoint',offset:10,limit:10});assert.equal(a.total,20);assert.equal(a.entries.length,10);assert.equal(b.entries.length,10);assert.ok(a.entries.every(e=>!b.entries.some(v=>v.id===e.id)));
 const constrained=searchCatalog(c,{elements:['Si'],periodicity:'bulk',requireForces:true,limit:50});assert.ok(constrained.entries.every(e=>e.capabilities.elements?.includes('Si')&&e.capabilities.forces==='yes'));assert.ok(!constrained.entries.some(e=>e.entityType==='property_model'));
 assert.equal(searchCatalog(c,{query:'MACE-MDP',requireForces:true}).total,0);
 assert.equal(searchCatalog(c,{query:'CGNEP',periodicity:'bulk'}).total,0);
 assert.equal(searchCatalog(c,{query:'nonexistent'}).total,0);
 assert.throws(()=>searchCatalog(c,{query:'x',limit:100}));assert.throws(()=>searchCatalog(c,{query:'x',elements:['Xx']}));assert.throws(()=>searchCatalog(c,{query:'x',python:'os.system()'}));
});
test('catalog cannot promote unknown compatibility, duplicate mirrored weights or injected links/code',()=>{
 const e=findCatalogEntry(c,'hub-bamboo');assert.equal(e.maintenance,'archived');assert.equal(e.asset.url,null);assert.equal(runnablePotentialId.safeParse(e.id).success,false);
 assert.equal(hubEntrySchema.safeParse({...e,capabilities:{...e.capabilities,forces:'yes'}}).success,false);
 assert.equal(hubEntrySchema.safeParse({...e,asset:{...e.asset,url:'https://host/model'}}).success,false);
 assert.equal(hubEntrySchema.safeParse({...e,sources:[{...e.sources[0],url:'file:///etc/passwd'}]}).success,false);
 assert.equal(hubEntrySchema.safeParse({...e,fieldEvidence:{'capabilities.energy':['fake']}}).success,false);
 assert.equal(hubEntrySchema.safeParse({...e,python:'import os'}).success,false);
 assert.equal(potentialCatalogSchema.safeParse({...c,entries:[...c.entries,c.entries[0]]}).success,false);
 const p=c.entries[0]!;assert.equal(potentialCatalogSchema.safeParse({...c,entries:[...c.entries,{...p,id:'mirror-model'}]}).success,false);
 assert.throws(()=>findCatalogEntry(c,'../../secret'));
 assert.ok(c.entries.filter(e=>e.entityType!=='checkpoint').every(e=>!e.asset.url&&!e.execution.legacyId));
 const cutoff=c.entries.filter(e=>e.name.startsWith('SevenNet-Nano '));assert.deepEqual(cutoff.map(e=>e.capabilities.cutoffAngstrom),[4.5,5,5.5,6]);
});
test('local Skill index lookup is bounded and creator contract cannot overwrite builtins or escape its directory',()=>{
 const s:SkillSummary={name:'materials-demo',category:'science',categoryLabelZh:'科学',categoryLabelEn:'Science',source:'MaterialsX',description:'Read crystal',descriptionZh:'读取晶体',descriptionEn:'Read crystal',examples:[{zh:'分析晶体',en:'Analyze crystal'}],license:'AGPL-3.0-only',enabled:true};
 assert.equal(searchSkills([s],{query:'@materials-demo'}).skills[0]?.name,s.name);assert.equal(searchSkills([s],{query:'晶体'}).total,1);assert.equal(searchSkills([s],{query:'crystal'}).total,1);assert.equal(searchSkills([s],{query:'missing'}).total,0);assert.equal(searchSkills([s],{query:''}).network,false);
 const bi={zh:'示例说明',en:'Example instructions'};const draft={schemaVersion:'m6.7-v1',name:'my-crystal-skill',description:bi,instructions:bi,examples:[bi],potentialIds:['chgnet-0.3.0'],requiredTools:['potential_search','materials_science']};
 assert.equal(planUserSkill(draft,[s.name],c).relativePath,'my-crystal-skill/SKILL.md');assert.equal(planUserSkill(draft,[],c).writerAvailable,false);
 for(const name of ['../escape','/tmp/file','CON','con'])assert.throws(()=>planUserSkill({...draft,name},[],c));assert.throws(()=>planUserSkill({...draft,name:s.name},[s.name],c),/BUILTIN_SKILL/);assert.throws(()=>planUserSkill({...draft,potentialIds:['invented']},[],c),/UNKNOWN_CATALOG/);
 assert.throws(()=>planUserSkill({...draft,script:'os.system()'},[],c));
});
