import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

// APFS clones avoid another physical copy of the approximately 1 GiB environment.
assert.equal(process.platform,'darwin','Only the verified macOS CPU matrix is accepted.');
assert.equal(process.arch,'arm64');
const root=process.cwd(),source=join(root,'runtime/atomistic/macos-arm64/sevennet');
const receipt=JSON.parse(await readFile(join(source,'RUNTIME.json'),'utf8'));
assert(receipt.portable,'Build with npm run m610:runtime first.');
const temp=await mkdtemp(join(tmpdir(),'mx-m610-portable-')),target=join(temp,'sevennet');
const evidence=join(root,'runtime/m6/acceptance/m610/portability');await mkdir(evidence,{recursive:true});
try {
 execFileSync('cp',['-cR',source,target],{timeout:120000});
 const python=join(target,receipt.python);
 const modules=JSON.parse(execFileSync(python,['-I','-c',`import pathlib,sys,json,torch,sevenn,ase,e3nn\nbase=pathlib.Path(sys.executable).resolve().parents[1]\nmods={m.__name__:str(pathlib.Path(m.__file__).resolve().relative_to(base)) for m in (torch,sevenn,ase,e3nn)}\nassert base==pathlib.Path(${JSON.stringify(target)}).resolve()\nprint(json.dumps(mods))`],{timeout:60000,encoding:'utf8'}));
 const checks=join(evidence,'derivatives.json');
 execFileSync(python,['-I',join(root,'atomistic/check_sevennet.py'),root,process.argv[2]??join(root,'runtime/m6/m610-source/checkpoint.bin'),checks],{timeout:600000,stdio:'inherit'});
 const result=JSON.parse(await readFile(checks,'utf8'));assert(result.passed);
 await writeFile(join(evidence,'receipt.json'),JSON.stringify({stage:'M6.10',passed:true,platform:'macos-arm64',device:'cpu',portable:true,modules,dependencyLockSha256:receipt.dependencyLockSha256,weightSha256:receipt.sha256,checks:result.checks,scientificQuality:'needs_review',scope:'Relocated managed Python and independent site-packages load a real local checkpoint without network; derivative/rotation/permutation checks. Not a signed installer or independent DFT validation.'},null,2)+'\n');
 console.log('M6.10 relocated portable CPU inference passed');
} finally {await rm(temp,{recursive:true,force:true});}
