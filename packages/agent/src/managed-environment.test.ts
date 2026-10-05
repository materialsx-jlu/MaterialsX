import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ManagedEnvironment} from './managed-environment.js';
import {sha} from './papers/arxiv.js';
/** Fixed shell fixture tests transaction boundaries, not Python's real import health (separate live probe). */
test('Managed repair verifies a fixed isolated copy; failed repair preserves the verified old environment',{skip:process.platform!=='darwin'||process.arch!=='arm64'},async()=>{
 const temp=await mkdtemp(join(tmpdir(),'ua6-env-')),root=join(temp,'root'),data=join(temp,'data'),bundle=join(root,'runtime/skill-python/macos-arm64');
 try{await mkdir(join(bundle,'bin'),{recursive:true});await mkdir(join(root,'vendor/materialsx-runtime-locks'),{recursive:true});await mkdir(data);
 const versions={python:'3.12.12',PyMuPDF:'1.28.2',Pillow:'12.3.0',jsonschema:'4.26.0'},fixture="#!/bin/sh\nprintf '%s\\n' '"+JSON.stringify(versions)+"'\n";
 await writeFile(join(bundle,'bin/python3.12'),fixture,{mode:0o755});const lock={version:'managed-python-v1',platform:'macos-arm64',versions,files:[{path:'bin/python3.12',sha256:sha(fixture)}]};await writeFile(join(root,'vendor/materialsx-runtime-locks/skill-python-macos-arm64.json'),JSON.stringify(lock));
 const environment=new ManagedEnvironment(root,data);assert.equal((await environment.check()).status,'ready');assert.equal((await environment.repair()).status,'repaired');const pointer=await readFile(join(data,'managed-python/active.json'),'utf8');
 await writeFile(join(bundle,'bin/python3.12'),'broken');const failed=await environment.repair();assert.equal(failed.status,'rolled-back');assert.equal(await readFile(join(data,'managed-python/active.json'),'utf8'),pointer);assert.equal((await environment.check()).status,'ready');
 await assert.rejects(new ManagedEnvironment(root,data,()=>false).repair(),/BUSY/);
 await rm(join(data,'managed-python/active.json'));await symlink('/etc/hosts',join(data,'managed-python/active.json'));assert.equal((await environment.check()).status,'unavailable');
 }finally{await rm(temp,{recursive:true,force:true});}
});
