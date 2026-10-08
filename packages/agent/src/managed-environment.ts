import {researchLimits} from "./papers/limits.js";
import {cp,lstat,mkdir,readlink,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,relative,resolve,dirname,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sha} from './papers/arxiv.js';
import {readOwnedBytes} from '../../atomistic/src/artifact-io.js';
import {configureManagedPython} from '../../pi-adapter/src/managed-python.js';
import type {EnvironmentReceipt} from '../../contracts/src/papers.js';
const exec=promisify(execFile);
const lockSchema=z.strictObject({version:z.literal('managed-python-v1'),platform:z.enum(['macos-arm64','windows-x64','linux-x64']),versions:z.record(z.string(),z.string()),files:z.array(z.strictObject({path:z.string().max(400),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),link:z.string().max(400).optional()})).min(1).max(10000)});
export class ManagedEnvironment {
  private busy=false;
  constructor(private root:string,private userData:string,private canRepair:(ownerTask?:string)=>boolean=()=>true){}
  private platform(){if(process.platform==='darwin'&&process.arch==='arm64')return 'macos-arm64';if(process.platform==='win32'&&process.arch==='x64')return 'windows-x64';if(process.platform==='linux'&&process.arch==='x64')return 'linux-x64';throw Error('UNSUPPORTED_MANAGED_PYTHON_PLATFORM');}
  private async identity(){const platform=this.platform(),path=join(this.root,'vendor/materialsx-runtime-locks/skill-python-'+platform+'.json'),bytes=await readOwnedBytes(this.root,path,null,2*1024*1024),lock=lockSchema.parse(JSON.parse(bytes.toString('utf8')));
    if(lock.platform!==platform)throw Error('RUNTIME_PLATFORM_MISMATCH');const keys=new Set<string>();for(const f of lock.files){if(!f.sha256&&!f.link||f.sha256&&f.link||f.path.includes('\\')||f.path.split('/').some(p=>!p||p==='..'||p==='.')||keys.has(f.path))throw Error('INVALID_RUNTIME_LOCK');keys.add(f.path);}return {lock,sha256:sha(bytes)};
  }
  private bundled(){return existsSync(join(this.root,'python-runtime'))?join(this.root,'python-runtime'):join(this.root,'runtime/skill-python',this.platform());}
  private async verify(base:string,identity:Awaited<ReturnType<ManagedEnvironment['identity']>>,signal?:AbortSignal){
    const root=await lstat(base);if(root.isSymbolicLink()||!root.isDirectory())throw Error('RUNTIME_ROOT_INVALID');
    const expected=new Set(identity.lock.files.map(f=>f.path));
    async function contents(dir:string):Promise<void>{for(const name of await readdir(dir)){if(name==='__pycache__'||name.endsWith('.pyc'))throw Error('RUNTIME_UNEXPECTED_BYTECODE');if(name==='BUILD')continue;const path=join(dir,name),s=await lstat(path);if(s.isDirectory())await contents(path);else if(!expected.has(relative(base,path).split(sep).join('/')))throw Error('RUNTIME_UNEXPECTED_FILE');}}
    await contents(base);
    for(const f of identity.lock.files){signal?.throwIfAborted();const path=join(base,f.path);if(f.link){const actual=await readlink(path),target=resolve(dirname(path),actual),rel=relative(resolve(base),target);if(actual!==f.link||rel.startsWith('..')||rel.startsWith(sep)||!rel)throw Error('RUNTIME_LINK_MISMATCH');}else if(sha(await readOwnedBytes(base,path,null,200*1024*1024,true))!==f.sha256)throw Error('RUNTIME_DIGEST_MISMATCH:'+f.path);}
    const python=join(base,this.platform()==='windows-x64'?'python.exe':'bin/python3.12');
    const code="import sys,json,importlib.metadata as m; import pymupdf,PIL,jsonschema,python_calamine; print(json.dumps({'python':sys.version.split()[0],**{n:m.version(n) for n in ['PyMuPDF','Pillow','jsonschema','python-calamine']}}))";
    const {stdout}=await exec(python,['-I','-B','-c',code],{timeout:30000,maxBuffer:65536,env:{PATH:dirname(python),PYTHONNOUSERSITE:'1'},...(signal?{signal}:{})});const versions=JSON.parse(stdout);
    if(Object.keys(identity.lock.versions).some(k=>versions[k]!==identity.lock.versions[k]))throw Error('RUNTIME_DEPENDENCY_VERSION_MISMATCH');return {python,versions};
  }
  private async active(identity:Awaited<ReturnType<ManagedEnvironment['identity']>>){
    try{const raw=JSON.parse((await readOwnedBytes(this.userData,join(this.userData,'managed-python/active.json'),null,16384)).toString('utf8'));if(!/^environment-[a-f0-9-]+$/.test(raw.directory))throw Error('RUNTIME_POINTER_INVALID');return raw.lockSha256===identity.sha256?join(this.userData,'managed-python',raw.directory):this.bundled();}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return this.bundled();throw e;}
  }
  async storageBytes(){
    const base=join(this.userData,'managed-python');
    async function size(path:string):Promise<number>{let s;try{s=await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;throw e;}if(s.isSymbolicLink())return s.size;if(s.isFile())return s.size;if(!s.isDirectory())throw Error('RUNTIME_STORAGE_TYPE');let n=0;for(const name of await readdir(path))n+=await size(join(path,name));return n;}
    if(existsSync(base)&&(await lstat(base)).isSymbolicLink())throw Error('RUNTIME_CACHE_SYMLINK');return size(base);
  }
  async check(signal?:AbortSignal):Promise<EnvironmentReceipt>{
    try{const identity=await this.identity(),checked=await this.verify(await this.active(identity),identity,signal);configureManagedPython(this.root,checked.python);return {status:'ready',...checked,lockSha256:identity.sha256,detail:'Fixed bundled dependencies verified; no system Python used.',at:new Date().toISOString()};}
    catch(e){signal?.throwIfAborted();return {status:'unavailable',python:'',lockSha256:null,versions:{},detail:e instanceof Error?e.message:'RUNTIME_UNAVAILABLE',at:new Date().toISOString()};}
  }
  async repair(signal?:AbortSignal,ownerTask?:string):Promise<EnvironmentReceipt>{
    if(this.busy||!this.canRepair(ownerTask))throw Error('RUNTIME_REPAIR_BUSY');this.busy=true;let stage='';
    try{const identity=await this.identity();await this.verify(this.bundled(),identity,signal);
      const base=join(this.userData,'managed-python');await mkdir(base,{recursive:true});if((await lstat(base)).isSymbolicLink())throw Error('RUNTIME_CACHE_SYMLINK');
      let sourceBytes=0;for(const f of identity.lock.files)sourceBytes+=(await lstat(join(this.bundled(),f.path))).size;
      if(await this.storageBytes()+sourceBytes>researchLimits.managedPythonBytes)throw Error('MANAGED_PYTHON_STORAGE_BUDGET');
      stage=join(base,'environment-'+randomUUID());await cp(this.bundled(),stage,{recursive:true,filter:source=>!source.includes(`${sep}__pycache__${sep}`)&&!source.endsWith('.pyc'),verbatimSymlinks:true});
      const checked=await this.verify(stage,identity,signal);signal?.throwIfAborted();const pointer=join(base,'active.json'),temporary=join(base,randomUUID()+'.json');
      if(existsSync(pointer)&&(await lstat(pointer)).isSymbolicLink())throw Error('RUNTIME_POINTER_SYMLINK');
      await writeFile(temporary,JSON.stringify({lockSha256:identity.sha256,directory:stage.split(sep).at(-1)}),{flag:'wx',mode:0o600});await rename(temporary,pointer);configureManagedPython(this.root,checked.python);stage='';
      return {status:'repaired',...checked,lockSha256:identity.sha256,detail:'Verified isolated copy activated; previous environment preserved for rollback.',at:new Date().toISOString()};
    }catch(e){if(stage)await rm(stage,{recursive:true,force:true});signal?.throwIfAborted();const previous=await this.check();return {...previous,status:previous.status==='ready'?'rolled-back':'unavailable',detail:'Repair did not activate: '+(e instanceof Error?e.message:'FAILED')};}finally{this.busy=false;}
  }
}
