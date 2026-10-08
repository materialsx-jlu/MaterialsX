import { z } from 'zod';import { lstat,readFile,readdir } from 'node:fs/promises';import { join } from 'node:path';
import { hashOwnedFile } from './artifact-io.js';
const file=z.strictObject({path:z.string().regex(/^[A-Za-z0-9_.\-/+@# ()]+$/).refine(p=>!p.startsWith('/')&&!p.split('/').includes('..')),bytes:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const bundleBaseSchema=z.strictObject({version:z.literal('m6.6-v1'),platform:z.enum(['macos-arm64','windows-x64']),createdAt:z.iso.datetime(),files:z.array(file).min(1).max(100000),expandedRuntimeBytes:z.number().int().positive(),coreWeightsBytes:z.number().int().positive(),scientificQuality:z.literal('needs_review'),signedRelease:z.literal(false)});
const unique=(r:{files:{path:string}[]})=>new Set(r.files.map(f=>f.path)).size===r.files.length;
export const offlineBundleSchema=bundleBaseSchema.refine(unique,'duplicate bundle entry');
export const distributionOfflineBundleSchema=bundleBaseSchema.extend({version:z.literal('m6.12-v1')}).refine(unique,'duplicate bundle entry');
export const molecularOfflineBundleSchema=bundleBaseSchema.extend({version:z.literal('m6.13-v1'),files:z.array(file).min(1).max(200000)}).refine(unique,'duplicate bundle entry');
export const nativeOfflineBundleSchema=bundleBaseSchema.extend({version:z.literal('m6.14-v1'),files:z.array(file).min(1).max(200000)}).refine(unique,'duplicate bundle entry');
export const physicsOfflineBundleSchema=bundleBaseSchema.extend({version:z.literal('m6.15-v1'),files:z.array(file).min(1).max(200000)}).refine(unique,'duplicate bundle entry');
export const offlineManifestSchema=z.union([offlineBundleSchema,distributionOfflineBundleSchema,molecularOfflineBundleSchema,nativeOfflineBundleSchema,physicsOfflineBundleSchema]);
export async function bundleFiles(source:string,target:string){const entries:z.infer<typeof file>[]=[];
 async function walk(base:string,prefix:string){for(const e of await readdir(base,{withFileTypes:true})){const path=join(base,e.name),p=`${prefix}/${e.name}`;const s=await lstat(path);if(s.isSymbolicLink())throw Error('BUNDLE_SYMLINK');if(s.isDirectory())await walk(path,p);else if(s.isFile()){const d=await hashOwnedFile(source,path,null,1024*1048576).catch(async err=>{if(s.size!==0)throw err;return {bytes:0,sha256:(await import('node:crypto')).createHash('sha256').update('').digest('hex')};});entries.push(file.parse({path:p,...d}));}else throw Error('BUNDLE_SPECIAL_FILE');}}
 await walk(source,target);return entries.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function verifyOfflineBundle(root:string){const manifest=join(root,'offline-bundle-manifest.json');if((await lstat(manifest)).size>32*1048576)throw Error('BUNDLE_MANIFEST_SIZE');const receipt=offlineManifestSchema.parse(JSON.parse((await readFile(manifest)).toString()));const platform=process.platform==='darwin'&&process.arch==='arm64'?'macos-arm64':process.platform==='win32'&&process.arch==='x64'?'windows-x64':'unsupported';if(receipt.platform!==platform)throw Error('BUNDLE_PLATFORM_MISMATCH');
 if(receipt.expandedRuntimeBytes>6144*1048576||receipt.coreWeightsBytes>128*1048576)throw Error('BUNDLE_CAPACITY_LIMIT');
 if(receipt.version!=='m6.6-v1'&&!receipt.files.some(f=>f.path==='schemas/m612/OfflineCollection.json'))throw Error('BUNDLE_CONTRACTS_MISSING');
 if(['m6.13-v1','m6.14-v1','m6.15-v1'].includes(receipt.version)&&!receipt.files.some(f=>f.path==='schemas/m613/MolecularExpansion.json'))throw Error('BUNDLE_CONTRACTS_MISSING');
 if(['m6.14-v1','m6.15-v1'].includes(receipt.version)&&!receipt.files.some(f=>f.path==='schemas/m614/NativeExpansion.json'))throw Error('BUNDLE_CONTRACTS_MISSING');
 if(['m6.14-v1','m6.15-v1'].includes(receipt.version)){
  const required=['models/potentials/native-m614.json','vendor/nep-cpu/LICENSE','vendor/nep-cpu/nep.cpp','atomistic/nep_runner.cpp','atomistic/native_nep.py',...(receipt.platform==='macos-arm64'?['native-engines/nep-cpu/nep-runner','native-engines/nep-cpu/RUNTIME.json']:[])];
  if(required.some(path=>!receipt.files.some(f=>f.path===path)))throw Error('BUNDLE_NATIVE_RESOURCES_MISSING');
 }
 if(receipt.version==='m6.15-v1'){
  const required=['schemas/m615/PhysicsExpansion.json','schemas/m615/CompositionResult.json','models/potentials/physics-m615.json','models/potentials/composition-profile-m615.json','atomistic/d3_runner.cpp','atomistic/composed.py',...(receipt.platform==='macos-arm64'?['native-engines/d3-bj/d3-runner','native-engines/d3-bj/RUNTIME.json']:[])];
  if(required.some(path=>!receipt.files.some(f=>f.path===path)))throw Error('BUNDLE_COMPOSITION_RESOURCES_MISSING');
 }
 const expected=new Set(receipt.files.map(f=>f.path));const roots=['atomistic-runtime','model-packages','atomistic','samples/atomistic','models/potentials',...(['m6.14-v1','m6.15-v1'].includes(receipt.version)?['native-engines','vendor/nep-cpu']:[]),...(receipt.version!=='m6.6-v1'?['m6','m61','m62','m63','m64','m65','m66','m67','m68','m69','m610','m611','m612',...(['m6.13-v1','m6.14-v1','m6.15-v1'].includes(receipt.version)?['m613']:[]),...(['m6.14-v1','m6.15-v1'].includes(receipt.version)?['m614']:[]),...(receipt.version==='m6.15-v1'?['m615']:[])]:['m6','m61','m62','m63','m64','m65','m66']).map(s=>`schemas/${s}`)].filter(p=>receipt.files.some(f=>f.path.startsWith(p+'/')));let actual=0;
 async function closure(dir:string,prefix:string){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name),key=`${prefix}/${entry.name}`,info=await lstat(path);if(info.isSymbolicLink())throw Error('BUNDLE_SYMLINK');if(info.isDirectory())await closure(path,key);else if(info.isFile()){if(!expected.has(key))throw Error('BUNDLE_UNDECLARED_FILE');actual++;}else throw Error('BUNDLE_SPECIAL_FILE');}}
 // Only these explicitly manifested trees are an executable/resource trust scope. Extra unrelated docs are allowed.
 for(const prefix of roots)await closure(join(root,prefix),prefix);
 const scoped=receipt.files.filter(f=>roots.some(p=>f.path.startsWith(p+'/'))).length;if(actual!==scoped)throw Error('BUNDLE_FILE_SET_CHANGED');
 let next=0;await Promise.all(Array.from({length:8},async()=>{while(next<receipt.files.length){const f=receipt.files[next++]!;const path=join(root,...f.path.split('/'));if(f.bytes===0){const s=await lstat(path);if(s.isSymbolicLink()||!s.isFile()||s.size!==0)throw Error('BUNDLE_CHANGED');continue;}const d=await hashOwnedFile(root,path,f.sha256,1024*1048576);if(d.bytes!==f.bytes)throw Error('BUNDLE_CHANGED');}}));
 return {version:receipt.version,passed:true,platform:receipt.platform,filesVerified:receipt.files.length,expandedRuntimeBytes:receipt.expandedRuntimeBytes,coreWeightsBytes:receipt.coreWeightsBytes,scientificQuality:'needs_review',signedRelease:false};
}
