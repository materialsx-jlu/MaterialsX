import type {CatalogWeightManager} from './catalog-weights.js';
import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,readdir,rm,statfs,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hashOwnedFile} from './artifact-io.js';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {offlineCollectionSchema,storageSelectionSchema,type PotentialStorageInventory,type PotentialStorageItem} from '../../contracts/src/potential-distribution.js';
import {canonical,hash,ownedText} from './discovery-io.js';
import {digestFile} from './selection.js';
import {PotentialPackageManager} from './package-manager.js';

/** Distribution is limited to already reviewed weights. No runtime/script is executed from an imported folder. */
export class PotentialDistributionService {
 private busy=false;
 private externalStorage:{storageItems():Promise<PotentialStorageItem[]>;cleanup(id:string):Promise<void>}|null=null;
 attachStorage(storage:{storageItems():Promise<PotentialStorageItem[]>;cleanup(id:string):Promise<void>}){this.externalStorage=storage;}
 constructor(private root:string,private userData:string,private packages:PotentialPackageManager,private inUse:(id:string)=>boolean=()=>false,private assertUsable:(id:string)=>void=()=>{},private catalogWeights?:CatalogWeightManager){}
 private guard(id?:string){if(this.busy||id&&(this.inUse(id)||this.packages.operationBusy(id)))throw Error('PACKAGE_OPERATION_BUSY_OR_IN_USE');}
 private async size(path:string,readOnly=false):Promise<number>{
  let s;try{s=await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;throw e;}
  if(s.isSymbolicLink()){if(readOnly)return s.size;throw Error('DISTRIBUTION_SYMLINK');}if(s.isFile())return s.size;if(!s.isDirectory())throw Error('DISTRIBUTION_SPECIAL_FILE');
  let bytes=0;for(const name of await readdir(path))bytes+=await this.size(join(path,name),readOnly);return bytes;
 }
 private async owned(parts:string[]){let path=this.userData;const base=await lstat(path);if(base.isSymbolicLink()||!base.isDirectory())throw Error('DISTRIBUTION_SYMLINK');for(const part of parts){path=join(path,part);try{if((await lstat(path)).isSymbolicLink())throw Error('DISTRIBUTION_SYMLINK');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}return path;}
 async inventory():Promise<PotentialStorageInventory>{
  const items:PotentialStorageItem[]=[];
  for(const e of this.packages.entries()){
   const p=await this.owned(['scientific-packages',e.potentialId,e.sha256]);const bytes=await this.size(p);const busy=this.inUse(e.potentialId)||this.packages.operationBusy(e.potentialId)||this.busy;
   if(bytes)items.push({id:'package:'+e.potentialId,kind:'package',label:{zh:e.potentialId+' · 用户权重',en:e.potentialId+' · user checkpoint'},bytes,removable:!busy,reason:busy?{zh:'计算或安装正在使用，禁止删除。',en:'In use by computation or installation; deletion blocked.'}:{zh:'只卸载本机缓存；保留共享环境、原始结构、结果和复现回执。',en:'Remove local cache only; preserve shared environments, inputs, results and reproduction receipts.'}});
   const part=await this.owned(['scientific-packages',e.potentialId,'checkpoint.part']);const partBytes=await this.size(part);
   if(partBytes)items.push({id:'partial:'+e.potentialId,kind:'partial',label:{zh:e.potentialId+' · 未完成下载',en:e.potentialId+' · incomplete download'},bytes:partBytes,removable:!busy,reason:busy?{zh:'正在使用，禁止清理。',en:'In use; cleanup blocked.'}:{zh:'删除后须重新下载；不删除已安装权重。',en:'A new download will be needed; installed checkpoint is preserved.'}});
  }
  const scientificCacheBytes=await this.size(await this.owned(['scientific-packages']));const remainingCacheBytes=scientificCacheBytes-items.reduce((n,i)=>n+i.bytes,0);if(remainingCacheBytes>0)items.push({id:'protected:other-scientific-cache',kind:'protected',label:{zh:'其他科学缓存与安装身份文件',en:'Other scientific cache and installation identity files'},bytes:remainingCacheBytes,removable:false,reason:{zh:'未列入当前审核权重的内容保留，避免删除跨版本数据。',en:'Content outside current reviewed checkpoint identities is retained to protect cross-version data.'}});
  const discovery=await this.owned(['potential-discovery']);try{for(const name of await readdir(discovery)){if(!/^state\.invalid-\d+\.json$/.test(name))continue;const p=await this.owned(['potential-discovery',name]);items.push({id:'quarantine:'+name,kind:'quarantine',label:{zh:'损坏的发现缓存 '+name,en:'Quarantined discovery cache '+name},bytes:await this.size(p),removable:!this.busy,reason:{zh:'可清理隔离副本；可信目录与证据快照保留。',en:'Remove quarantined copy; preserve trusted catalog and evidence snapshots.'}});}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  for(const [id,path,label] of [
   ['discovery',discovery,{zh:'发现状态与来源证据（含历史快照）',en:'Discovery state and source evidence (including history)'}],
   ['catalog',await this.owned(['potential-catalog']),{zh:'签名目录、密钥轮换与撤回记录',en:'Signed catalog, key rotation and withdrawal history'}],
   ['runtime',join(this.root,existsSync(join(this.root,'atomistic-runtime'))?'atomistic-runtime':`runtime/atomistic/${process.platform==='darwin'?'macos-arm64':'windows-x64'}`),{zh:'内置共享计算环境与核心权重',en:'Bundled shared runtimes and core checkpoints'}],
   ['native-engine',join(this.root,existsSync(join(this.root,'native-engines'))?'native-engines':`runtime/native-engines/${process.platform==='darwin'?'macos-arm64':'windows-x64'}`),{zh:'内置原生 NEP / D3 引擎与身份记录',en:'Bundled native NEP / D3 engines and identity records'}],
   ['skill-python',join(this.root,existsSync(join(this.root,'python-runtime'))?'python-runtime':`runtime/skill-python/${process.platform==='darwin'?'macos-arm64':'windows-x64'}`),{zh:'内置 Skills Python 环境',en:'Bundled Skills Python environment'}],
   ['bundled',join(this.root,'model-packages'),{zh:'随安装包提供的扩展权重',en:'Extension checkpoints bundled with the application'}]
  ] as const){let bytes=await this.size(path,['runtime','native-engine','skill-python','bundled'].includes(id));if(id==='discovery')bytes-=items.filter(i=>i.kind==='quarantine').reduce((n,i)=>n+i.bytes,0);items.push({id:'protected:'+id,kind:'protected',label,bytes,removable:false,reason:{zh:'受保护；项目结构与计算产物不进入清理范围。',en:'Protected; project structures and calculation artifacts are outside cleanup scope.'}});}
  if(this.externalStorage)items.push(...await this.externalStorage.storageItems());
  if(this.catalogWeights)items.push(...await this.catalogWeights.storageItems());
  const ordered=items.sort((a,b)=>a.id.localeCompare(b.id));return {version:'m6.12-v1',items:ordered,totalBytes:ordered.reduce((n,i)=>n+i.bytes,0),reclaimableBytes:ordered.filter(i=>i.removable).reduce((n,i)=>n+i.bytes,0),inventorySha256:hash(canonical(ordered)),scannedAt:new Date().toISOString()};
 }
 async cleanup(input:unknown){this.guard();const q=storageSelectionSchema.parse(input),inventory=await this.inventory();if(q.inventorySha256!==inventory.inventorySha256)throw Error('STORAGE_PREVIEW_STALE');const rows=q.ids.map(id=>{const item=inventory.items.find(i=>i.id===id);if(!item?.removable)throw Error('STORAGE_ITEM_PROTECTED_OR_MISSING');return item;});
  // Revalidate every selection before the first deletion; manager guards are repeated per mutation.
  for(const row of rows)if(row.kind==='catalog'){if(this.catalogWeights?.busy())throw Error('CATALOG_DOWNLOAD_BUSY');}else if(!['quarantine','literature'].includes(row.kind))this.guard(row.id.split(':').slice(1).join(':'));
  this.busy=true;const removed:string[]=[];try{for(const row of rows){const id=row.id.slice(row.id.indexOf(':')+1);if(row.kind==='literature')await this.externalStorage!.cleanup(id);else if(row.kind==='package')await this.packages.uninstall(id);else if(row.kind==='partial')await this.packages.removePartial(id);else if(row.kind==='catalog')await this.catalogWeights!.removeStorage(id);else if(row.kind==='quarantine'){const path=await this.owned(['potential-discovery',id]);const s=await lstat(path);if(!s.isFile()||s.size!==row.bytes)throw Error('STORAGE_PREVIEW_STALE');await rm(path);}removed.push(row.id);}return {removed,bytes:rows.reduce((n,i)=>n+i.bytes,0)};}catch(e){throw Error(`STORAGE_CLEANUP_INTERRUPTED:${removed.join(',')}:${e instanceof Error?e.message:'FAILED'}`);}finally{this.busy=false;}
 }
 async exportCollection(parent:string,ids:string[]){this.guard();if(!ids.length||ids.length>50||new Set(ids).size!==ids.length)throw Error('OFFLINE_SELECTION_INVALID');const entries=ids.map(id=>{this.guard(id);this.assertUsable(id);return this.packages.entry(id);});const dir=join(parent,'MaterialsX-checkpoints-'+randomUUID());this.busy=true;let created=false;
  try{const p=await lstat(parent);if(p.isSymbolicLink()||!p.isDirectory())throw Error('DISTRIBUTION_SYMLINK');const space=await statfs(parent);if(Number(space.bavail)*Number(space.bsize)<entries.reduce((n,e)=>n+e.bytes,0)+256*1048576)throw Error('PACKAGE_DISK_SPACE_LIMIT');
   for(const e of entries){const file=this.packages.weight(e.potentialId);if(await digestFile(file,e.bytes)!==e.sha256)throw Error('PACKAGE_IDENTITY_MISMATCH');}
   await mkdir(dir,{mode:0o700});created=true;const rows=[];
   for(const e of entries){this.assertUsable(e.potentialId);const target=join(dir,e.potentialId);await mkdir(target);await copyFile(this.packages.weight(e.potentialId),join(target,'checkpoint.bin'),constants.COPYFILE_EXCL);if(await digestFile(join(target,'checkpoint.bin'),e.bytes)!==e.sha256)throw Error('PACKAGE_IDENTITY_MISMATCH');const notices=[];for(const [i,n] of e.notices.entries()){const text=ownedText(join(this.root,n.path));if(hash(text)!==n.sha256)throw Error('PACKAGE_NOTICE_MISMATCH');await writeFile(join(target,`NOTICE-${i}.txt`),text,{flag:'wx',mode:0o600});notices.push({sha256:n.sha256,bytes:Buffer.byteLength(text)});}rows.push({potentialId:e.potentialId,sha256:e.sha256,bytes:e.bytes,dependencyLockSha256:e.dependencyLockSha256,sourceRevision:e.sourceRevision,notices});}
   const manifest=offlineCollectionSchema.parse({version:'m6.12-v1',kind:'reviewed-checkpoints',createdAt:new Date().toISOString(),entries:rows});await writeFile(join(dir,'collection.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});return {path:dir,potentialIds:ids};
  }catch(e){if(created)await rm(dir,{recursive:true,force:true});throw e;}finally{this.busy=false;}
 }
 async importCollection(directory:string){this.guard();this.busy=true;const imported:string[]=[];
  try{if((await lstat(directory)).isSymbolicLink()||!(await lstat(directory)).isDirectory())throw Error('DISTRIBUTION_SYMLINK');const m=offlineCollectionSchema.parse(JSON.parse(ownedText(join(directory,'collection.json'),1024*1024)));const expected=new Set(['collection.json',...m.entries.map(e=>e.potentialId)]);if((await readdir(directory)).some(n=>!expected.has(n)))throw Error('OFFLINE_UNDECLARED_FILE');
   for(const row of m.entries){const e=this.packages.entry(row.potentialId);this.assertUsable(row.potentialId);if(this.inUse(row.potentialId)||this.packages.operationBusy(row.potentialId))throw Error('PACKAGE_IN_USE');if(row.sha256!==e.sha256||row.bytes!==e.bytes||row.dependencyLockSha256!==e.dependencyLockSha256||row.sourceRevision!==e.sourceRevision||row.notices.length!==e.notices.length)throw Error('OFFLINE_PACKAGE_INCOMPATIBLE');const dir=join(directory,row.potentialId);if((await lstat(dir)).isSymbolicLink()||!(await lstat(dir)).isDirectory())throw Error('DISTRIBUTION_SYMLINK');const names=['checkpoint.bin',...row.notices.map((_,i)=>`NOTICE-${i}.txt`)];if((await readdir(dir)).some(n=>!names.includes(n)))throw Error('OFFLINE_UNDECLARED_FILE');const actual=await hashOwnedFile(directory,join(dir,'checkpoint.bin'),row.sha256,row.bytes);if(actual.bytes!==row.bytes)throw Error('PACKAGE_IDENTITY_MISMATCH');for(const [i,n] of row.notices.entries()){const text=ownedText(join(dir,`NOTICE-${i}.txt`));if(n.sha256!==e.notices[i]!.sha256||hash(text)!==n.sha256||Buffer.byteLength(text)!==n.bytes)throw Error('PACKAGE_NOTICE_MISMATCH');}}
   // No package mounts before all content and compatibility checks pass. Each weight commits atomically.
   const free=await statfs(this.userData);if(Number(free.bavail)*Number(free.bsize)<m.entries.reduce((n,e)=>n+e.bytes,0)+256*1048576)throw Error('PACKAGE_DISK_SPACE_LIMIT');
   for(const row of m.entries){this.assertUsable(row.potentialId);if(this.inUse(row.potentialId))throw Error('PACKAGE_IN_USE');await this.packages.importFile(row.potentialId,join(directory,row.potentialId,'checkpoint.bin'));imported.push(row.potentialId);}return {imported};
  }catch(e){throw Error(`OFFLINE_IMPORT_FAILED:${imported.join(',')}:${e instanceof Error?e.message:'FAILED'}`);}finally{this.busy=false;}
 }
}
