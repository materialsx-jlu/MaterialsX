import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {mkdtemp,mkdir,writeFile,cp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {adapterExpansionSchema} from '../../contracts/src/potential-adapters.js';
import {adapterExpansion} from './adapter-expansion.js';import {effectiveRegistry} from './model-packages.js';import {mountReviewedCatalog} from './mounted-catalog.js';import {buildPotentialCatalog,searchCatalog} from './potential-hub.js';import {parsePotentialRegistry} from './registry.js';import {assessPotentials,digest} from './selection.js';
const root=process.cwd(),manifest=JSON.parse(readFileSync('models/potentials/adapters-m610.json','utf8'));
test('reviewed new adapter separates actual CPU scope from public Nano identities and immutable historical registry',()=>{
 const before=readFileSync('models/potentials/registry.json');const extra=adapterExpansion(root);assert.equal(extra.entries[0]!.family,'sevennet');assert.equal(extra.entries[0]!.elements.length,89);
 assert(extra.entries[0]!.platforms.every(r=>r.status!=='verified'||r.platform==='macos-arm64'&&r.device==='cpu'));
 const registry=effectiveRegistry(root),catalog=mountReviewedCatalog(root,buildPotentialCatalog(parsePotentialRegistry(JSON.parse(before.toString())),JSON.parse(readFileSync('models/potentials/catalog-m67.json','utf8'))));assert.equal(catalog.entries.length,176);
 assert.equal(catalog.entries.find(e=>e.id==='sevennet-0-11jul2024')?.licenses.weights,'MIT');
 const nano=searchCatalog(catalog,{query:'SevenNet-Nano',entityType:'checkpoint'}).entries;assert.equal(nano.length,4);assert(nano.every(e=>e.asset.sha256&&e.asset.bytes&&e.execution.legacyId===null&&e.execution.profileId===null));
 const structure=JSON.parse(readFileSync('samples/atomistic/si-diamond.structure.json','utf8'));const e=extra.entries[0]!;const capability={potentialId:e.potentialId,sha256:e.sha256,dependencyLockSha256:e.dependencyLockSha256,elements:e.elements,loadedMemoryMiB:e.loadedMemoryMiB,device:'cpu' as const,adapter:{}};
 const request={projectId:'project',structureId:structure.id,domain:'inorganic-crystals' as const,mode:'exploratory' as const,task:'singlepoint' as const};
 assert(assessPotentials(registry,digest(JSON.stringify(registry)),structure,request,[capability]).selection.candidates.some(c=>c.potentialId===e.potentialId));
 for(const patch of [{pbc:[true,true,false]},{charge:1},{spinMultiplicity:2},{atoms:structure.atoms.map((a:any)=>({...a,element:'Po'}))}]){
  const a=assessPotentials(registry,digest(JSON.stringify(registry)),{...structure,...patch},request,[capability]);assert(!a.selection.candidates.some(c=>c.potentialId===e.potentialId));
 }
 assert.deepEqual(readFileSync('models/potentials/registry.json'),before);
});
test('new adapter contracts reject altered identities, mismatched dependencies, fabricated backend passes and candidate promotion',()=>{
 for(const mutate of [(m:any)=>m.entries[0].adapter='arbitrary-python',(m:any)=>m.entries[0].basePotentialId='chgnet-0.3.0',(m:any)=>m.entries[0].dtype='float64',(m:any)=>m.entries[0].platforms[1].status='verified',(m:any)=>m.potentials[0].weights.sha256='a'.repeat(64),(m:any)=>m.candidates[0].execution.legacyId='sevennet-0-11jul2024']){
  const m=structuredClone(manifest);mutate(m);assert(!adapterExpansionSchema.safeParse(m).success);
 }
});
test('new environment lock and notices are application assets; changed bytes cannot authorize execution',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'mx-m610-lock-'));try{
  await mkdir(join(temp,'models/potentials'),{recursive:true});await writeFile(join(temp,'models/potentials/adapters-m610.json'),JSON.stringify(manifest));
  await cp(join(root,'docs/m6/licenses'),join(temp,'docs/m6/licenses'),{recursive:true});await mkdir(join(temp,'atomistic/environments/sevennet'),{recursive:true});await cp(join(root,'atomistic/environments/sevennet/uv.lock'),join(temp,'atomistic/environments/sevennet/uv.lock'));
  assert.equal(adapterExpansion(temp).entries.length,1);await writeFile(join(temp,'atomistic/environments/sevennet/uv.lock'),'different lock');assert.throws(()=>adapterExpansion(temp),/ENVIRONMENT_MISMATCH/);
  await cp(join(root,'atomistic/environments/sevennet/uv.lock'),join(temp,'atomistic/environments/sevennet/uv.lock'));await writeFile(join(temp,'docs/m6/licenses/sevennet-LICENSE.txt'),'different notice');assert.throws(()=>adapterExpansion(temp),/NOTICE_MISMATCH/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
