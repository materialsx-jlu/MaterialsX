import {physicsExpansion} from './physics-expansion.js';
import {nativeExpansion} from './native-expansion.js';
import {molecularExpansion} from './molecular-expansion.js';
import {nativeRegistrySchema as currentRegistrySchema} from '../../contracts/src/potential-native.js';
import { approvedPackages } from './approved-packages.js';
import { adapterExpansion } from './adapter-expansion.js';
import { constants,existsSync,readFileSync } from 'node:fs';
import { mkdir,lstat,open,rename,rm,statfs,copyFile } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { readOwnedBytes } from './artifact-io.js';
import { extensionManifestSchema,packageRequestSchema,packageStatusSchema,type PackageStatus } from '../../contracts/src/atomistic-validation.js';
import { parsePotentialRegistry } from './registry.js';
import { digest,digestFile } from './selection.js';

/** Fixed first-party-reviewed source list only. No request can supply a URL, hash or executable. */
export function extensionManifest(root:string){
 const manifest=extensionManifestSchema.parse(JSON.parse(readFileSync(join(root,'models/potentials/extensions-m66.json'),'utf8')));
 for(const e of manifest.entries){if(digest(readFileSync(join(root,'docs/m6/licenses/chgnet-LICENSE.txt')))!==e.licenseSha256||digest(readFileSync(join(root,'docs/m6/licenses/chgnet-r2scan-README.md')))!==e.readmeSha256)throw Error('EXTENSION_LICENSE_IDENTITY_MISMATCH');}
 return manifest;
}
export function effectiveRegistry(root:string){
 const registry=parsePotentialRegistry(JSON.parse(readFileSync(join(root,'models/potentials/registry.json'),'utf8')));
 for(const e of extensionManifest(root).entries){const p=registry.potentials.find(p=>p.id===e.potentialId)!;if(p.weights.url!==e.url||p.environment.codeRevision!==e.sourceRevision)throw Error('EXTENSION_SOURCE_MISMATCH');
 p.weights.sha256=e.sha256;p.weights.bytes=e.bytes;p.weights.verification='download-hashed';p.environment.profileId=e.environmentProfileId;p.licenses.redistribution='permitted-with-notices';p.state='audited';
 }
 for(const reviewed of adapterExpansion(root).potentials){const i=registry.potentials.findIndex(p=>p.id===reviewed.id);if(i<0)throw Error('ADAPTER_NOT_IN_REGISTRY');registry.potentials[i]=reviewed;}
 const molecular=molecularExpansion(root);if(molecular)registry.potentials.push(molecular.potential as typeof registry.potentials[number]);
 const physics=physicsExpansion(root);if(physics)registry.potentials.push(physics.potential as typeof registry.potentials[number]);
 const native=nativeExpansion(root);if(native)registry.potentials.push(native.potential as typeof registry.potentials[number]);
 for(const e of approvedPackages(root)){const p=registry.potentials.find(p=>p.id===e.potentialId)!;p.weights.sha256=e.sha256;p.weights.bytes=e.bytes;p.weights.verification="download-hashed";p.environment.profileId=e.environmentProfileId;p.declared.elements=e.elements;p.licenses.redistribution="permitted-with-notices";p.state="audited";}
 return currentRegistrySchema.parse(registry);
}
export class ModelPackageManager {
 private controller:AbortController|null=null;
 private live:PackageStatus|null=null;
 constructor(private root:string,private userData:string,private network:typeof fetch=fetch,private assertUsable:(id:string)=>void=()=>{},private inUse:(id:string)=>boolean=()=>false){}
 operationBusy(){return !!this.controller;}
 private entry(input:unknown){const q=packageRequestSchema.parse(input);return extensionManifest(this.root).entries.find(e=>e.potentialId===q.potentialId)!;}
 private base(id:string){return join(this.userData,'scientific-packages',id);}
 disabled(id:string){return existsSync(join(this.base(id),'disabled.json'));}
 weight(id:string){const e=this.entry({potentialId:id});const local=join(this.base(id),e.sha256,'checkpoint.bin');return existsSync(local)?local:join(this.root,'model-packages',e.potentialId,e.sha256,'checkpoint.bin');}
 private async directory(id:string){let path=this.userData;for(const part of ['scientific-packages',id]){path=join(path,part);await mkdir(path,{recursive:true});const s=await lstat(path);if(s.isSymbolicLink()||!s.isDirectory())throw Error('UNSAFE_PACKAGE_DIRECTORY');}return path;}
 async status():Promise<PackageStatus[]>{const out:PackageStatus[]=[];for(const e of extensionManifest(this.root).entries){
  if(this.live?.potentialId===e.potentialId&&this.controller){out.push(structuredClone(this.live));continue;}
  let state:PackageStatus['state']='absent',bytes=0,error:string|null=null;
  try{const path=this.weight(e.potentialId),s=await lstat(path);if(s.isSymbolicLink()||!s.isFile()||s.size!==e.bytes||await digestFile(path,e.bytes)!==e.sha256)throw Error('PACKAGE_IDENTITY_MISMATCH');state=this.disabled(e.potentialId)?'disabled':'installed';bytes=s.size;}catch(err){if(existsSync(this.weight(e.potentialId))){state='failed';error='PACKAGE_IDENTITY_MISMATCH';}else{const part=join(this.base(e.potentialId),'checkpoint.part');if(existsSync(part)){const s=await lstat(part);if(!s.isSymbolicLink()){bytes=s.size;state='paused';}}if(this.live?.error){state=this.live.state;error=this.live.error;}}}
  out.push(packageStatusSchema.parse({potentialId:e.potentialId,state,bytes,totalBytes:e.bytes,sha256:e.sha256,error,runtimeReady:false,quality:'needs_review'}));
 }return out;}
 async setDisabled(input:unknown,disabled:boolean){const e=this.entry(input);if(!disabled)this.assertUsable(e.potentialId);const dir=await this.directory(e.potentialId);if(this.controller)throw Error('PACKAGE_OPERATION_BUSY');if(this.inUse(e.potentialId))throw Error('PACKAGE_IN_USE');if(disabled){const f=await open(join(dir,'disabled.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);try{await f.writeFile(JSON.stringify({version:'m6.6-v1',potentialId:e.potentialId,disabledAt:new Date().toISOString()})+'\n');}finally{await f.close();}}else await rm(join(dir,'disabled.json'),{force:true});}
 cancel(){if(!this.controller)return false;this.controller.abort();return true;}
 async importFile(input:unknown,source:string){const e=this.entry(input);this.assertUsable(e.potentialId);if(this.controller)throw Error('PACKAGE_OPERATION_BUSY');if(this.inUse(e.potentialId))throw Error('PACKAGE_IN_USE');this.controller=new AbortController();try{
  const s=await lstat(source);if(s.isSymbolicLink()||!s.isFile()||s.size!==e.bytes||await digestFile(source,e.bytes)!==e.sha256)throw Error('PACKAGE_IDENTITY_MISMATCH');
  const dir=await this.directory(e.potentialId);await this.checkDisk(dir,e.bytes);const temp=join(dir,'checkpoint.part');const f=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);try{await f.writeFile(await readOwnedBytes(dirname(source),source,e.sha256,e.bytes));}finally{await f.close();}await this.commit(e,dir,temp);
 }finally{this.controller=null;}}
 private async checkDisk(dir:string,bytes:number){const d=await statfs(dir);if(Number(d.bavail)*Number(d.bsize)<bytes+256*1048576)throw Error('PACKAGE_DISK_SPACE_LIMIT');}
 private async commit(e:ReturnType<ModelPackageManager['entry']>,dir:string,temp:string){this.assertUsable(e.potentialId);if(await digestFile(temp,e.bytes)!==e.sha256)throw Error('PACKAGE_IDENTITY_MISMATCH');const dest=join(dir,e.sha256);await mkdir(dest,{recursive:true});if((await lstat(dest)).isSymbolicLink())throw Error('UNSAFE_PACKAGE_DIRECTORY');await copyFile(join(this.root,'docs/m6/licenses/chgnet-LICENSE.txt'),join(dest,'LICENSE.txt'));await copyFile(join(this.root,'docs/m6/licenses/chgnet-r2scan-README.md'),join(dest,'README.md'));await rename(temp,join(dest,'checkpoint.bin'));await this.setEnabledFile(dir);this.live=null;}
 private async setEnabledFile(dir:string){await rm(join(dir,'disabled.json'),{force:true});}
 async download(input:unknown){const e=this.entry(input);this.assertUsable(e.potentialId);if(this.controller)throw Error('PACKAGE_OPERATION_BUSY');if(this.inUse(e.potentialId))throw Error('PACKAGE_IN_USE');const controller=new AbortController();this.controller=controller;
  let offset=0;let part:string|undefined;
  try{const dir=await this.directory(e.potentialId);part=join(dir,'checkpoint.part');if(existsSync(part)){const s=await lstat(part);if(s.isSymbolicLink()||!s.isFile()||s.size>e.bytes)throw Error('UNSAFE_PACKAGE_PART');offset=s.size;}await this.checkDisk(dir,e.bytes-offset);
   this.live=packageStatusSchema.parse({potentialId:e.potentialId,state:'downloading',bytes:offset,totalBytes:e.bytes,sha256:e.sha256,error:null,runtimeReady:false,quality:'needs_review'});
   if(offset===e.bytes){await this.commit(e,dir,part);return;}
   const timeout=AbortSignal.timeout(180000);const response=await this.network(e.url,{headers:offset?{Range:`bytes=${offset}-`}:{},signal:AbortSignal.any([controller.signal,timeout])});
   if(!response.ok||!response.body)throw Error('PACKAGE_HTTP_FAILED');
   if(response.status===206){if(response.headers.get('content-range')!==`bytes ${offset}-${e.bytes-1}/${e.bytes}`)throw Error('PACKAGE_RANGE_MISMATCH');}
   else if(response.status===200)offset=0;else throw Error('PACKAGE_HTTP_FAILED');
   const f=await open(part,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW|(offset?constants.O_APPEND:constants.O_TRUNC),0o600);
   try{for await(const chunk of response.body){controller.signal.throwIfAborted();offset+=chunk.length;if(offset>e.bytes)throw Error('PACKAGE_SIZE_LIMIT');await f.write(chunk);this.live.bytes=offset;}await f.sync();}finally{await f.close();}
   if(offset!==e.bytes)throw Error('PACKAGE_TRUNCATED');await this.commit(e,dir,part);
  }catch(err){const paused=controller.signal.aborted;this.live=packageStatusSchema.parse({potentialId:e.potentialId,state:paused?'paused':'failed',bytes:offset,totalBytes:e.bytes,sha256:e.sha256,error:paused?null:err instanceof Error?err.message.slice(0,200):'PACKAGE_FAILED',runtimeReady:false,quality:'needs_review'});if(part&&!paused&&/IDENTITY|SIZE|RANGE/.test(this.live.error??''))await rm(part,{force:true});if(!paused)throw err;
  }finally{this.controller=null;}
 }
}
