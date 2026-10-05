import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {defaultMDOptions,mdOptionsSchema,scientificScopeSchema,mdIndexSchema,selectedRunSchema} from '../../contracts/src/atomistic-dynamics.js';
import {hashOwnedFile,readOwnedRange} from './artifact-io.js';import {digest} from './selection.js';
test('MD contracts reject hidden thermostats, mixed tasks, excess steps/sampling and code',()=>{
 assert(mdOptionsSchema.safeParse(defaultMDOptions).success);
 for(const change of [{ensemble:'nve',frictionInverseFs:.01},{ensemble:'nvt',frictionInverseFs:null},{sampleEvery:201},{steps:2001},{timestepFs:2},{seed:-1},{path:'/tmp/trajectory'},{code:'os.system()'}])assert(!mdOptionsSchema.safeParse({...defaultMDOptions,...change}).success);
 const scope={projectId:'project',conversationId:'conversation',structureId:'structure',domain:'inorganic-crystals',mode:'exploratory',permission:'md',mdOptions:defaultMDOptions};assert(scientificScopeSchema.safeParse(scope).success);for(const patch of [{mdOptions:undefined},{permission:'inspect'},{options:{optimizer:'FIRE'}}])assert(!scientificScopeSchema.safeParse({...scope,...patch}).success);
 assert(!selectedRunSchema.safeParse({projectId:'project',proposal:{assessmentId:'a',selectedPotentialId:'chgnet-0.3.0',evidenceIds:['e']},mdOptions:defaultMDOptions,options:{optimizer:'FIRE',cellMode:'fixed',cellConstraint:'none',externalPressureGPa:null,maxSteps:10,fmaxEvPerAngstrom:.05}}).success);
});
test('trajectory index rejects wrong physical time, discontinuous byte ranges and missing initial frame',()=>{
 const range={offset:0,bytes:20,sha256:'a'.repeat(64)},entry={index:0,step:0,timeFs:0,frame:range,extxyz:range};const index={version:'m6.5-v1',runId:'run',planId:'run',structureId:'s',options:defaultMDOptions,atomCount:8,entries:[entry,{...entry,index:1,step:10,timeFs:5,frame:{...range,offset:20},extxyz:{...range,offset:20}}]};assert(mdIndexSchema.safeParse(index).success);
 for(const patch of [{timeFs:10},{index:2},{step:11,timeFs:5.5},{frame:{...range,offset:100}}])assert(!mdIndexSchema.safeParse({...index,entries:[entry,{...index.entries[1],...patch}]}).success);
 assert(!mdIndexSchema.safeParse({...index,entries:[{...entry,step:1,timeFs:.5}]}).success);
});
test('owned streaming hashes and lazy frame ranges are bounded, verified and symlink-safe',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-md-range-'));try{const path=join(dir,'frames.ndjson'),data=Buffer.alloc(7*1024*1024,65);await writeFile(path,data);const hash=await hashOwnedFile(dir,path,digest(data),8*1024*1024);assert.equal(hash.bytes,data.length);const part=data.subarray(5*1024*1024,5*1024*1024+200);assert.deepEqual(await readOwnedRange(dir,path,{offset:5*1024*1024,bytes:200,sha256:digest(part)}),part);
 await assert.rejects(readOwnedRange(dir,path,{offset:-1,bytes:200,sha256:digest(part)}));await assert.rejects(readOwnedRange(dir,path,{offset:data.length,bytes:200,sha256:digest(part)}));await assert.rejects(readOwnedRange(dir,path,{offset:0,bytes:3*1024*1024,sha256:digest(part)}));await assert.rejects(hashOwnedFile(dir,path,null,1024));await assert.rejects(hashOwnedFile(dir,path,'b'.repeat(64),8*1024*1024));await symlink(path,join(dir,'alias'));await assert.rejects(readOwnedRange(dir,join(dir,'alias'),{offset:0,bytes:200,sha256:digest(part)}),/SYMLINK/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
