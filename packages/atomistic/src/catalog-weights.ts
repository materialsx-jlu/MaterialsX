import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,lstat,open,readdir,rename,rm,copyFile,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {PotentialCatalog,HubEntry} from '../../contracts/src/potential-hub.js';
import {catalogId} from '../../contracts/src/potential-hub.js';
import type {PotentialStorageItem} from '../../contracts/src/potential-distribution.js';
import type {CatalogWeightStatus} from '../../contracts/src/catalog-weights.js';
import {hashOwnedFile,readOwnedBytes} from './artifact-io.js';
const MAX_BYTES=3*1024**3;
const hosts=new Set(['github.com','raw.githubusercontent.com','release-assets.githubusercontent.com','objects.githubusercontent.com','huggingface.co','cdn-lfs.huggingface.co','cdn-lfs-us-1.hf.co','cas-bridge.xethub.hf.co','us.aws.cdn.hf.co','orbitalmaterials-public-models.s3.us-west-1.amazonaws.com']);
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const recordSchema=z.strictObject({potentialId:catalogId,sourceUrl:z.url(),revision:z.string().nullable(),observedSha256:z.string().regex(/^[a-f0-9]{64}$/),expectedSha256:z.string().nullable(),bytes:z.number().int().positive().max(MAX_BYTES),completedAt:z.iso.datetime()});
/** Catalog downloads are inert files. They never extend the approved executable package registry. */
export class CatalogWeightManager {
 private active:{id:string;controller:AbortController}|null=null;
 private live:CatalogWeightStatus|null=null;
 private errors=new Map<string,string>();
 constructor(private userData:string,private catalog:()=>PotentialCatalog,private assertUsable:(id:string)=>void=()=>{},private network:typeof fetch=fetch,private changed:()=>void=()=>{}){}
 allowed(e:HubEntry){if(e.entityType!=='checkpoint'||!e.asset.url||!e.asset.revision||e.access==='commercial')return false;try{this.url(e.asset.url);return true;}catch{return false;}}
 private url(value:string){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.has(u.hostname))throw Error('CATALOG_DOWNLOAD_SOURCE_UNSUPPORTED');return u;}
 private entry(id:string){catalogId.parse(id);this.assertUsable(id);const e=this.catalog().entries.find(e=>e.id===id);if(!e||!this.allowed(e))throw Error('CATALOG_WEIGHT_SOURCE_UNAVAILABLE');return e;}
 private identity(e:HubEntry){return digest(JSON.stringify([e.id,e.asset.url,e.asset.revision,e.asset.sha256,e.asset.bytes]));}
 private async folder(e:HubEntry){let path=this.userData;const root=await lstat(path);if(!root.isDirectory()||root.isSymbolicLink())throw Error('CATALOG_CACHE_UNSAFE');for(const name of ['catalog-weights',e.id,this.identity(e)]){path=join(path,name);await mkdir(path,{recursive:true});const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink())throw Error('CATALOG_CACHE_UNSAFE');}return path;}
 private async fileSize(file:string){try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('CATALOG_CACHE_UNSAFE');return s.size;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;throw e;}}
 private blank(e:HubEntry):CatalogWeightStatus{return {potentialId:e.id,state:'absent',bytes:0,totalBytes:e.asset.bytes,observedSha256:null,expectedSha256:e.asset.sha256,verifiedAgainstCatalog:false,error:null};}
 async status(id:string):Promise<CatalogWeightStatus>{const e=this.entry(id);if(this.active?.id===id&&this.live)return {...this.live};const out=this.blank(e),dir=await this.folder(e);
  try{const bytes=await this.fileSize(join(dir,'checkpoint.bin'));if(bytes){out.bytes=bytes;const r=recordSchema.parse(JSON.parse((await readOwnedBytes(this.userData,join(dir,'record.json'),null,16384)).toString()));if(r.potentialId!==id||r.sourceUrl!==e.asset.url||r.revision!==e.asset.revision||r.bytes!==bytes||r.expectedSha256!==e.asset.sha256||(e.asset.bytes!==null&&bytes!==e.asset.bytes)||(e.asset.sha256!==null&&r.observedSha256!==e.asset.sha256))throw Error('CATALOG_CACHE_IDENTITY_MISMATCH');Object.assign(out,{state:'downloaded',bytes,totalBytes:bytes,observedSha256:r.observedSha256,verifiedAgainstCatalog:e.asset.sha256!==null});}else{const partial=await this.fileSize(join(dir,'checkpoint.part'));if(partial)Object.assign(out,{state:'paused',bytes:partial});}
   const error=this.errors.get(id);if(error)Object.assign(out,{state:'failed',error});
  }catch(e){Object.assign(out,{state:'failed',error:e instanceof Error?e.message:'CATALOG_CACHE_INVALID'});}return out;
 }
 busy(id?:string){return !!this.active&&(!id||this.active.id===id);}
 cancel(id:string){catalogId.parse(id);if(this.active?.id!==id)return false;this.active.controller.abort();return true;}
 async cachedFile(id:string){const e=this.entry(id),dir=await this.folder(e),s=await this.status(id);if(s.state!=='downloaded')throw Error('CATALOG_WEIGHT_NOT_DOWNLOADED');await hashOwnedFile(this.userData,join(dir,'checkpoint.bin'),s.observedSha256,MAX_BYTES);return join(dir,'checkpoint.bin');}

 private async commit(e:HubEntry,dir:string,signal?:AbortSignal){signal?.throwIfAborted();this.assertUsable(e.id);if(this.identity(this.entry(e.id))!==this.identity(e))throw Error('CATALOG_SOURCE_CHANGED');const h=await hashOwnedFile(this.userData,join(dir,'checkpoint.part'),e.asset.sha256,MAX_BYTES);signal?.throwIfAborted();if(this.identity(this.entry(e.id))!==this.identity(e))throw Error('CATALOG_SOURCE_CHANGED');if(e.asset.bytes!==null&&h.bytes!==e.asset.bytes)throw Error('CATALOG_WEIGHT_SIZE_MISMATCH');await this.fileSize(join(dir,'checkpoint.bin'));await this.fileSize(join(dir,'record.json'));const record={potentialId:e.id,sourceUrl:e.asset.url!,revision:e.asset.revision,expectedSha256:e.asset.sha256,observedSha256:h.sha256,bytes:h.bytes,completedAt:new Date().toISOString()};const f=await open(join(dir,'record.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|(process.platform==='win32'?0:constants.O_NOFOLLOW),0o600);try{await f.writeFile(JSON.stringify(record));await f.sync();}finally{await f.close();}await rename(join(dir,'checkpoint.part'),join(dir,'checkpoint.bin'));}
 private async space(dir:string,bytes:number){const s=await statfs(dir);if(Number(s.bavail)*Number(s.bsize)<bytes+256*1024**2)throw Error('CATALOG_DISK_SPACE_LOW');}
 async importFile(id:string,path:string){if(this.busy())throw Error('CATALOG_DOWNLOAD_BUSY');const e=this.entry(id);if(!e.asset.sha256||!e.asset.bytes)throw Error('CATALOG_IMPORT_EXPECTED_HASH_REQUIRED');if(e.asset.bytes>MAX_BYTES)throw Error('CATALOG_WEIGHT_TOO_LARGE');const c=new AbortController();this.active={id,controller:c};try{const s=await lstat(path);if(s.isSymbolicLink()||!s.isFile()||s.size!==e.asset.bytes)throw Error('CATALOG_WEIGHT_SIZE_MISMATCH');const dir=await this.folder(e);await this.space(dir,s.size);await this.fileSize(join(dir,'checkpoint.part'));await copyFile(path,join(dir,'checkpoint.part'));c.signal.throwIfAborted();await this.commit(e,dir,c.signal);this.errors.delete(id);}catch(err){this.errors.set(id,err instanceof Error?err.message:'CATALOG_IMPORT_FAILED');throw err;}finally{this.active=null;this.live=null;this.changed();}}
 private async response(url:string,offset:number,signal:AbortSignal){
  for(let n=0;n<6;n++){
   this.url(url);const headerTimeout=new AbortController(),timer=setTimeout(()=>headerTimeout.abort(),60000);let r:Response;
   try{r=await this.network(url,{redirect:'manual',signal:AbortSignal.any([signal,headerTimeout.signal]),headers:offset?{Range:`bytes=${offset}-`,'Accept-Encoding':'identity'}:{'Accept-Encoding':'identity'}});}
   catch(e){if(headerTimeout.signal.aborted&&!signal.aborted)throw Error('CATALOG_DOWNLOAD_CONNECT_TIMEOUT');throw e;}
   finally{clearTimeout(timer);}
   if([301,302,303,307,308].includes(r.status)){const loc=r.headers.get('location');await r.body?.cancel();if(!loc)throw Error('CATALOG_DOWNLOAD_REDIRECT_INVALID');url=new URL(loc,url).href;continue;}return r;
  }throw Error('CATALOG_DOWNLOAD_REDIRECT_LIMIT');
 }
 async download(id:string){if(this.busy())throw Error('CATALOG_DOWNLOAD_BUSY');const e=this.entry(id),controller=new AbortController();this.active={id,controller};this.errors.delete(id);let lastNotify=0;let offset=0;
  const timeout=setTimeout(()=>controller.abort(),30*60*1000);
  try{const dir=await this.folder(e);if(e.asset.bytes!==null&&e.asset.bytes>MAX_BYTES)throw Error('CATALOG_WEIGHT_TOO_LARGE');offset=await this.fileSize(join(dir,'checkpoint.part'));if(offset>MAX_BYTES)throw Error('CATALOG_WEIGHT_TOO_LARGE');if(e.asset.bytes!==null&&offset===e.asset.bytes){controller.signal.throwIfAborted();await this.commit(e,dir,controller.signal);return;}
   await this.space(dir,(e.asset.bytes??MAX_BYTES)-offset);
   this.live={...this.blank(e),state:'downloading',bytes:offset};this.changed();let r=await this.response(e.asset.url!,offset,controller.signal);
   // Unknown or mutable sources restart; a known digest allows validating resumed bytes at commit.
   if(offset&&(!e.asset.sha256||r.status===200)){await r.body?.cancel();offset=0;r=await this.response(e.asset.url!,0,controller.signal);}
   if(r.status===401||r.status===403){await r.body?.cancel();throw Error('CATALOG_SOURCE_ACCESS_REQUIRED');}if(!r.ok||!r.body){await r.body?.cancel();throw Error('CATALOG_DOWNLOAD_HTTP_'+r.status);}
   if(!offset&&r.status!==200){await r.body.cancel();throw Error('CATALOG_DOWNLOAD_RANGE_INVALID');}
   if(offset){const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range')??'');if(r.status!==206||!range||Number(range[1])!==offset||e.asset.bytes!==null&&Number(range[3])!==e.asset.bytes){await r.body.cancel();throw Error('CATALOG_DOWNLOAD_RANGE_INVALID');}}
   const length=r.headers.get('content-length');const declared=length===null?null:Number(length)+offset;
   if(declared!==null&&(!Number.isSafeInteger(declared)||declared<=0||declared>MAX_BYTES||e.asset.bytes!==null&&declared!==e.asset.bytes)){await r.body.cancel();throw Error('CATALOG_WEIGHT_SIZE_MISMATCH');}
   if(/text\/html|application\/json/i.test(r.headers.get('content-type')??'')){await r.body.cancel();throw Error('CATALOG_SOURCE_NOT_WEIGHT_FILE');}
   this.live.totalBytes=e.asset.bytes??declared;this.live.bytes=offset;
   const file=await open(join(dir,'checkpoint.part'),constants.O_WRONLY|constants.O_CREAT|(offset?constants.O_APPEND:constants.O_TRUNC)|(process.platform==='win32'?0:constants.O_NOFOLLOW),0o600);
   try{for await(const chunk of r.body){controller.signal.throwIfAborted();offset+=chunk.byteLength;if(offset>MAX_BYTES||this.live.totalBytes!==null&&offset>this.live.totalBytes)throw Error('CATALOG_WEIGHT_TOO_LARGE');let written=0;while(written<chunk.byteLength){const b=await file.write(chunk,written,chunk.byteLength-written);if(!b.bytesWritten)throw Error('CATALOG_CACHE_WRITE_FAILED');written+=b.bytesWritten;}this.live.bytes=offset;if(Date.now()-lastNotify>200){lastNotify=Date.now();this.changed();}}await file.sync();}finally{await file.close();}
   controller.signal.throwIfAborted();if(this.live.totalBytes!==null&&offset!==this.live.totalBytes)throw Error('CATALOG_WEIGHT_SIZE_MISMATCH');if(this.identity(this.entry(id))!==this.identity(e))throw Error('CATALOG_SOURCE_CHANGED');await this.commit(e,dir,controller.signal);
  }catch(err){if(!controller.signal.aborted)this.errors.set(id,err instanceof Error?err.message:'CATALOG_DOWNLOAD_FAILED');throw err;}finally{clearTimeout(timeout);this.active=null;this.live=null;this.changed();}
 }
 private async owned(parts:string[]){let path=this.userData;for(const part of ['',...parts]){if(part)path=join(path,part);const s=await lstat(path);if(s.isSymbolicLink()||!s.isDirectory())throw Error('CATALOG_CACHE_UNSAFE');}return path;}
 async storageItems():Promise<PotentialStorageItem[]>{
  const items:PotentialStorageItem[]=[];let root:string;
  try{root=await this.owned(['catalog-weights']);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return items;throw e;}
  for(const id of await readdir(root)){if(!catalogId.safeParse(id).success)continue;const parent=await this.owned(['catalog-weights',id]);
   for(const key of await readdir(parent)){if(!/^[a-f0-9]{64}$/.test(key))continue;const dir=await this.owned(['catalog-weights',id,key]);let bytes=0;for(const file of await readdir(dir))bytes+=await this.fileSize(join(dir,file));if(!bytes)continue;
    const name=this.catalog().entries.find(e=>e.id===id)?.name??id;
    items.push({id:`catalog:${id}:${key}`,kind:'catalog',label:{zh:name+' · 目录下载',en:name+' · catalog download'},bytes,removable:!this.busy(),reason:this.busy()?{zh:'模型文件下载中，请完成或暂停后清理。',en:'Wait for the download to finish or pause before cleanup.'}:{zh:'删除下载副本；保留计算环境和计算结果。',en:'Remove the downloaded copy; preserve compute environments and results.'}});
   }
  }return items;
 }
 async removeStorage(key:string){if(this.busy())throw Error('CATALOG_DOWNLOAD_BUSY');const [id,digestKey,...extra]=key.split(':');catalogId.parse(id);if(extra.length||!digestKey||!/^[a-f0-9]{64}$/.test(digestKey))throw Error('CATALOG_CACHE_UNSAFE');const path=await this.owned(['catalog-weights',id!,digestKey]);await rm(path,{recursive:true,force:true});this.errors.delete(id!);this.changed();}
 dispose(){this.active?.controller.abort();}
}
