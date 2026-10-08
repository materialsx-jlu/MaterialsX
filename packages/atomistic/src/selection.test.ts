import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {assessPotentials,digest,validateProposal} from './selection.js';import {parsePotentialRegistry} from './registry.js';
import {atomicStructureSchema} from '../../contracts/src/atomistic.js';import {selectionRequestSchema,type CapabilityReceipt} from '../../contracts/src/atomistic-selection.js';
const bytes=readFileSync('models/potentials/registry.json'),registry=parsePotentialRegistry(JSON.parse(bytes.toString()));
const structure=atomicStructureSchema.parse(JSON.parse(readFileSync('samples/atomistic/si-diamond.structure.json','utf8')));
const request=selectionRequestSchema.parse({projectId:'project',structureId:structure.id,domain:'inorganic-crystals',mode:'exploratory',task:'singlepoint'});
const capabilities=registry.potentials.filter(p=>p.role==='core-candidate').map(p=>({potentialId:p.id,sha256:p.weights.sha256,dependencyLockSha256:'a'.repeat(64),elements:['Si'],loadedMemoryMiB:1024,device:'cpu',adapter:{}})) as CapabilityReceipt[];
const assess=(s=structure,r=request,c=capabilities,reg=registry)=>assessPotentials(reg,digest(bytes),s,r,c);
test('only runtime-verified compatible cores pass exploratory gates; no fabricated accuracy rank',()=>{const a=assess();assert.equal(a.selection.candidates.length,2);assert.equal(a.selection.exclusions.length,registry.potentials.length-2);assert.match(a.rankingBasis,/tied/);assert.match(a.selection.validationPlan,/DFT/);assert.equal(a.selection.selectedPotentialId,null);});
test('formal mode, unknown or out-of-policy domains cannot execute',()=>{for(const patch of [{mode:'production' as const},{domain:'unknown' as const},{domain:'polymers' as const},{domain:'molecules' as const},{domain:'surfaces' as const},{domain:'interfaces' as const}])assert.equal(assess(structure,{...request,...patch}).selection.candidates.length,0);});
test('hard gates cover geometry, electronic states, actual element list, bytes and resource floors',()=>{
 const budget={maxAtoms:1,maxSteps:1,maxWallSeconds:10,maxMemoryMiB:256,maxOutputMiB:1,threads:1};
 for(const s of [{...structure,pbc:[true,true,false] as [boolean,boolean,boolean]},{...structure,charge:0},{...structure,spinMultiplicity:1},{...structure,atoms:structure.atoms.map(a=>({...a,occupancy:.5}))},{...structure,issues:[{code:'BAD',severity:'blocking' as const,detail:'invalid'}]},{...structure,atoms:structure.atoms.map(a=>({...a,element:'Xe'}))}])assert.equal(assess(s).selection.candidates.length,0);
 assert.equal(assess(structure,{...request,budget}).selection.candidates.length,0);
 assert.equal(assess(structure,request,[]).selection.candidates.length,0);
 assert.equal(assess(structure,request,capabilities.map(c=>({...c,sha256:'b'.repeat(64)}))).selection.candidates.length,0);
});
test('disabled, unresolved license/head/output and unknown conservative forces are not overcome by a receipt',()=>{
 for(const change of [(p:any)=>p.state='disabled',(p:any)=>p.licenses.weights.status='unknown',(p:any)=>p.licenses.redistribution='unknown',(p:any)=>p.declared.headPolicy='required',(p:any)=>p.declared.forces='unknown',(p:any)=>p.declared.conservative='unknown']){
  const reg=structuredClone(registry);reg.potentials.filter(p=>p.role==='core-candidate').forEach(change);assert.equal(assess(structure,{...request,task:'relaxation'},capabilities,reg).selection.candidates.length,0);
 }
});
test('LLM proposals cannot invent candidates, evidence, assessment IDs or extra parameters',()=>{const a=assess(),c=a.selection.candidates[0]!;const good={assessmentId:a.id,selectedPotentialId:c.potentialId,evidenceIds:c.evidenceIds};assert.equal(validateProposal(a,good).selectedPotentialId,c.potentialId);for(const patch of [{assessmentId:'outside'},{selectedPotentialId:'orb-v3'},{evidenceIds:['fake']},{head:'fake'}])assert.throws(()=>validateProposal(a,{...good,...patch}));const p=assess(structure,{...request,mode:'production'});assert.throws(()=>validateProposal(p,{...good,assessmentId:p.id}),/POTENTIAL_EXCLUDED/);});

test("MD requires verified conservative forces and retains production gates",()=>{assert.equal(assess(structure,{...request,task:"md"}).selection.candidates.length,2);const reg=structuredClone(registry);reg.potentials.filter(p=>p.role==="core-candidate").forEach(p=>p.declared.conservative="unknown");assert.equal(assess(structure,{...request,task:"md"},capabilities,reg).selection.candidates.length,0);});
