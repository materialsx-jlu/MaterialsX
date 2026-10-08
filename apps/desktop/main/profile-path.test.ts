import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {profilePath} from './profile-path.js';
test('an explicit isolated profile cannot silently replace the default or use root, relative paths or symlinks',async()=>{
 assert.equal(profilePath(undefined),null);assert.equal(profilePath(''),null);assert.throws(()=>profilePath('/'));assert.throws(()=>profilePath('relative'));
 const root=await mkdtemp(join(tmpdir(),'mx-profile-'));
 try{const path=profilePath(join(root,'new'));assert(path?.endsWith('/new'));await symlink(path!,join(root,'link'));assert.throws(()=>profilePath(join(root,'link')));}
 finally{await rm(root,{recursive:true,force:true});}
});
