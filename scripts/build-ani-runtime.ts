import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile,rename,rm,cp} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {molecularExpansion} from '../packages/atomistic/src/molecular-expansion.js';
const root=process.cwd(),platform=process.platform==='darwin'&&process.arch==='arm64'?'macos-arm64':null;
if(!platform){console.log('ANI environment not bundled on this platform: not-tested, molecular execution remains blocked.');process.exit(0);}
const e=molecularExpansion(root)!.entry,exec=promisify(execFile),base=join(root,'runtime/atomistic',platform,'ani'),envDir=join(root,'runtime/m6-environments/ani');
const verify=async(python:string)=>{const {stdout}=await exec(python,['-I','-c',"import sys,torch,torchani,ase,numpy; assert sys.version.split()[0]=='3.12.10'; assert torch.__version__.split('+')[0]=='2.8.0'; assert numpy.__version__=='2.2.6'; assert ase.__version__=='3.26.0'; import importlib.metadata; assert importlib.metadata.version('torchani')=='2.7.5'; from torchani.arch import Assembler; print('verified')"],{timeout:60000,maxBuffer:1048576});if(!stdout.includes('verified'))throw Error('ANI_RUNTIME_PROBE_FAILED');};
if(existsSync(join(base,'RUNTIME.json'))&&!process.argv.includes('--rebuild')){const r=JSON.parse(await readFile(join(base,'RUNTIME.json'),'utf8'));if(r.dependencyLockSha256===e.dependencyLockSha256&&r.sourceRevision===e.sourceRevision&&r.sha256===e.sha256&&r.portable){await verify(join(base,r.python));console.log('Retained ANI locked portable environment');process.exit(0);}}
await exec('uv',['sync','--project',join(root,'atomistic/environments/ani'),'--frozen','--no-dev'],{env:{...process.env,UV_PROJECT_ENVIRONMENT:envDir},timeout:600000,maxBuffer:4*1048576});
const {stdout}=await exec('uv',['python','find','3.12.10','--managed-python']);const managed=dirname(dirname(stdout.trim())),stage=base+'.staging',site='lib/python3.12/site-packages';await rm(stage,{recursive:true,force:true});await mkdir(dirname(base),{recursive:true});
await cp(managed,stage,{recursive:true,dereference:true});await rm(join(stage,site),{recursive:true,force:true});
// APFS copy-on-write avoids another physical copy of the existing PyTorch dependency cache.
await exec('cp',['-cR',join(envDir,site),join(stage,site)],{timeout:120000});
await verify(join(stage,'bin/python3.12'));await rm(base,{recursive:true,force:true});await rename(stage,base);
await mkdir(join(base,'licenses'),{recursive:true});for(const n of e.notices)await cp(join(root,n.path),join(base,'licenses',n.path.split('/').at(-1)!));await exec(join(base,'bin/python3.12'),[join(root,'atomistic/dependency_inventory.py'),join(base,'licenses/dependencies')],{timeout:60000,maxBuffer:1048576});
const receipt={version:'m6.13-v1',platform,potentialId:e.potentialId,environmentProfileId:e.environmentProfileId,sourceRevision:e.sourceRevision,dependencyLockSha256:e.dependencyLockSha256,python:'bin/python3.12',portable:true,weight:'checkpoint.bin',sha256:e.sha256,bytes:e.bytes,createdAt:new Date().toISOString(),scientificQuality:'needs_review'};await writeFile(join(base,'RUNTIME.json'),JSON.stringify(receipt,null,2)+'\n');console.log('ANI portable environment ready; reviewed weights are installed separately.');
