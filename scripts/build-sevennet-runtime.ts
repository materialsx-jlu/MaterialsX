import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { cp,mkdir,readFile,writeFile,rename,rm,readdir,statfs } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { adapterExpansion } from '../packages/atomistic/src/adapter-expansion.js';

const root=process.cwd(),development=process.argv.includes('--development');
const platform=process.platform==='darwin'&&process.arch==='arm64'?'macos-arm64':process.platform==='win32'&&process.arch==='x64'?'windows-x64':null;
if(!platform)throw Error('SevenNet runtime build supports macOS arm64 / Windows x64 layouts only');
const entry=adapterExpansion(root).entries[0]!;if(!entry)throw Error('APPROVED_ADAPTER_REQUIRED');
const base=join(root,'runtime/atomistic',platform,'sevennet'),envDir=join(root,'runtime/m6-environments/sevennet');
const exec=promisify(execFile);
const verify=async(python:string,portable=false)=>{
 const {stdout}=await exec(python,['-I','-c',`import sys,pathlib,torch,numpy,ase,e3nn,sevenn,torch_geometric; assert sys.version.split()[0]=='3.12.10'; assert torch.__version__.split('+')[0]=='2.8.0'; assert numpy.__version__=='2.2.6'; assert ase.__version__=='3.26.0'; assert e3nn.__version__=='0.5.8'; assert sevenn.__version__=='0.13.0'; assert torch_geometric.__version__=='2.7.0'; base=pathlib.Path(sys.executable).resolve().parent if sys.platform=='win32' else pathlib.Path(sys.executable).resolve().parent.parent; assert not ${portable?'True':'False'} or all(base in pathlib.Path(m.__file__).resolve().parents for m in [torch,numpy,ase,e3nn,sevenn,torch_geometric]); print('verified')`],{timeout:60000,maxBuffer:1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 if(!stdout.includes('verified'))throw Error('ADAPTER_ENVIRONMENT_PROBE_FAILED');
};
if(existsSync(join(base,'RUNTIME.json'))&&!process.argv.includes('--rebuild'))try{
 const r=JSON.parse(await readFile(join(base,'RUNTIME.json'),'utf8'));
 if(r.version==='m6.10-v1'&&r.platform===platform&&r.environmentProfileId===entry.environmentProfileId&&r.sourceRevision===entry.sourceRevision&&r.dependencyLockSha256===entry.dependencyLockSha256&&r.sha256===entry.sha256&&(development||r.portable)){
  await verify(r.portable?join(base,r.python):r.python,r.portable);console.log('Retained matching SevenNet environment; weights remain on demand');process.exit(0);
 }
}catch{/* Explicitly rebuild invalid/mismatched environments from the immutable lock. */}
const disk=await statfs(root);if(Number(disk.bavail)*Number(disk.bsize)<(development?2048:4096)*1048576)throw Error('ADAPTER_ENVIRONMENT_DISK_LIMIT');
async function uv(args:string[],extra?:NodeJS.ProcessEnv):Promise<string>{return new Promise((res,rej)=>{
 const child=spawn('uv',args,{cwd:root,env:{...process.env,...extra},stdio:['ignore','pipe','pipe'],windowsHide:true});let out='';
 child.stdout.on('data',(b:Buffer)=>out+=b.toString());child.stderr.on('data',(b:Buffer)=>process.stderr.write(b));child.once('error',rej);child.once('exit',c=>c===0?res(out.trim()):rej(Error('LOCKED_ADAPTER_BUILD_FAILED')));
});}
await uv(['python','install','3.12.10']);await uv(['sync','--project',join(root,'atomistic/environments/sevennet'),'--frozen','--no-dev'],{UV_PROJECT_ENVIRONMENT:envDir});
const site=process.platform==='win32'?'Lib/site-packages':'lib/python3.12/site-packages';
// Upstream packages include four older checkpoints. Remove only environment-local files, never mutate shared uv cache contents.
const weights=join(envDir,site,'sevenn/pretrained_potentials');
async function strip(dir:string){if(!existsSync(dir))return;for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await strip(p);else if(/\.(pth|pt)$/.test(e.name))await rm(p);}}
await strip(weights);
let python=process.platform==='win32'?join(envDir,'Scripts/python.exe'):join(envDir,'bin/python');
if(!development){
 const managed=await uv(['python','find','3.12.10','--managed-python']),pythonRoot=process.platform==='win32'?dirname(managed):dirname(dirname(managed)),stage=base+'.staging';
 await rm(stage,{recursive:true,force:true});await cp(pythonRoot,stage,{recursive:true,dereference:true});await rm(join(stage,site),{recursive:true,force:true});await cp(join(envDir,site),join(stage,site),{recursive:true,dereference:true});
 await verify(join(stage,process.platform==='win32'?'python.exe':'bin/python3.12'),true);
 await rm(base,{recursive:true,force:true});await mkdir(dirname(base),{recursive:true});await rename(stage,base);python=join(base,process.platform==='win32'?'python.exe':'bin/python3.12');
}else await mkdir(base,{recursive:true});
await verify(python,!development);
await mkdir(join(base,'licenses'),{recursive:true});for(const n of entry.notices)await cp(join(root,n.path),join(base,'licenses',n.path.split('/').at(-1)!));
await exec(python,[join(root,'atomistic/dependency_inventory.py'),join(base,'licenses/dependencies')],{timeout:60000,maxBuffer:1024*1024});
const receipt={version:'m6.10-v1',platform,potentialId:entry.potentialId,environmentProfileId:entry.environmentProfileId,sourceRevision:entry.sourceRevision,dependencyLockSha256:entry.dependencyLockSha256,python:development?python:process.platform==='win32'?'python.exe':'bin/python3.12',portable:!development,weight:'checkpoint.bin',sha256:entry.sha256,bytes:entry.bytes,createdAt:new Date().toISOString(),runtimeValidation:'pending',scientificQuality:'needs_review'};
await writeFile(join(base,'RUNTIME.json.tmp'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});await rename(join(base,'RUNTIME.json.tmp'),join(base,'RUNTIME.json'));
console.log(`SevenNet ${development?'isolated development':'portable'} environment ready; no checkpoint implicitly installed. Windows/GPU execution remains blocked until matrix approval.`);
