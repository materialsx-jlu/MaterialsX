import {mkdir,lstat} from 'node:fs/promises';import {resolve,join} from 'node:path';
import {PotentialPackageManager} from '../packages/atomistic/src/package-manager.js';
import {digestFile} from '../packages/atomistic/src/selection.js';
const root=process.cwd(),state=resolve('runtime');await mkdir(state,{recursive:true});const manager=new PotentialPackageManager(root,state);
const candidates:Record<string,string[]>={
 'nep-si-2022-nep4-3body':['runtime/m6/m614-source/checkpoint.bin'],
 'ani-2x-ensemble':['runtime/m6/m613-source/checkpoint.bin'],
 'chgnet-r2scan':['runtime/m6/extension-sources/chgnet-r2scan/checkpoint.bin'],
 'mace-mp-0b2-small':['runtime/m6/m68-sources/mace-mp-0b2-small/checkpoint.bin'],
 'mace-mpa-0-medium':['runtime/m6/m68-sources/mace-mpa-0-medium/checkpoint.bin'],
 'sevennet-0-11jul2024':['runtime/m6/m610-source/checkpoint.bin','runtime/atomistic/macos-arm64/sevennet/checkpoint.bin','runtime/atomistic/windows-x64/sevennet/checkpoint.bin']
};const files=[];
for(const e of manager.entries().filter(e=>e.potentialId!=='mace-mp-0b3-medium-d3-bj-pbe-si')){let source:string|null=null;for(const file of [manager.weight(e.potentialId),...(candidates[e.potentialId]??[]).map(p=>join(root,p))]){try{const s=await lstat(file);if(!s.isSymbolicLink()&&s.isFile()&&s.size===e.bytes&&await digestFile(file,e.bytes)===e.sha256){source=file;break;}}catch{/* Try another fixed local cache. */}}if(!source)throw Error('REVIEWED_CACHE_REQUIRED:'+e.potentialId);files.push({id:e.potentialId,source});}
for(const f of files)await manager.importFile(f.id,f.source);
console.log(JSON.stringify({stage:'M6.12',reviewedCheckpoints:files.length,sharedCompositionProfiles:1,weightsDownloaded:0}));
