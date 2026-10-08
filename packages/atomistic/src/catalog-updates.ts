import {currentPotentialCatalogSchema as potentialCatalogSchema} from '../../contracts/src/potential-physics.js';
import {catalogBundleSchema} from '../../contracts/src/potential-distribution.js';
import {createPublicKey,type KeyObject} from 'node:crypto';
import {signMetadata,verifyMetadataSignature} from './signed-metadata.js';
import {existsSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {catalogTrustSchema,catalogReleasePayloadSchema,signedCatalogReleaseSchema,type CatalogReleasePayload,type SignedCatalogRelease} from '../../contracts/src/potential-discovery.js';
import {type PotentialCatalog} from '../../contracts/src/potential-hub.js';
import {approvedPackages} from './approved-packages.js';
import {buildPotentialCatalog} from './potential-hub.js';
import {mountReviewedCatalog} from './mounted-catalog.js';
import {parsePotentialRegistry} from './registry.js';
import {effectiveRegistry} from './model-packages.js';
import {atomicJson,canonical,fetchMetadata,hash,ownedText,safeDirectory} from './discovery-io.js';

/** Frozen M6.11 publisher channel pins six adapters. New application-only adapters are pinned separately by their immutable reviewed manifest; remote catalogs cannot override them. */
export function executionPins(root:string){const registry=effectiveRegistry(root),packages=approvedPackages(root);return registry.potentials.filter(p=>p.id!=='mace-mp-0b3-medium-d3-bj-pbe-si'&&!['ANI','NEP'].includes(p.family)&&(p.role==='core-candidate'||packages.some(e=>e.potentialId===p.id))).map(p=>({id:p.id,weightSha256:p.weights.sha256!,dependencyLockSha256:packages.find(e=>e.potentialId===p.id)?.dependencyLockSha256??hash(ownedText(join(root,'atomistic/environments',p.environment.adapter==='mace-ase'?'mace':'chgnet','uv.lock'))),sourceRevision:p.environment.codeRevision!})).sort((a,b)=>a.id.localeCompare(b.id));}
export function signCatalog(payload:CatalogReleasePayload,keyId:string,key:KeyObject):SignedCatalogRelease{return signedCatalogReleaseSchema.parse(signMetadata(catalogReleasePayloadSchema.parse(payload),keyId,key));}
const cacheSchema=z.strictObject({version:z.literal('m6.11-v1'),releases:z.array(signedCatalogReleaseSchema).min(1).max(256)});
const lexists=(path:string)=>{try{lstatSync(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}};
export class CatalogUpdateService{
 private readonly trust:z.infer<typeof catalogTrustSchema>;private readonly dir:string;private readonly pins:ReturnType<typeof executionPins>;private readonly frozen:Set<string>;private readonly baseline:SignedCatalogRelease;private readonly baseCatalog:PotentialCatalog;private releases:SignedCatalogRelease[]=[];private keys=new Map<string,string>();
 private withdrawn=new Map<string,CatalogReleasePayload['withdrawals'][number]>();private corrupt=false;private error:string|null=null;private controller:AbortController|null=null;private lastCheck:number|null=null;private changed:(catalogChanged:boolean)=>void=()=>{};
 constructor(root:string,userData:string,private network:typeof fetch=fetch,private clock:()=>number=Date.now){
  this.trust=catalogTrustSchema.parse(JSON.parse(ownedText(join(root,'models/potentials/discovery-trust.json'))));this.dir=safeDirectory(userData,'potential-catalog');this.pins=executionPins(root);this.frozen=new Set(effectiveRegistry(root).potentials.map(p=>p.id));this.baseline=signedCatalogReleaseSchema.parse(JSON.parse(ownedText(join(root,'models/potentials/catalog-release.json'))));this.baseCatalog=mountReviewedCatalog(root,buildPotentialCatalog(parsePotentialRegistry(JSON.parse(ownedText(join(root,'models/potentials/registry.json')))),JSON.parse(ownedText(join(root,'models/potentials/catalog-m67.json')))));this.resetKeys();
  try{const cached=join(this.dir,'state.json');const chain=lexists(cached)?cacheSchema.parse(JSON.parse(ownedText(cached,32*1024*1024))).releases:[this.baseline];
   for(const r of chain)this.validateAndApply(r,false);this.catalog(this.baseCatalog);if(!lexists(cached))this.save();
   const refresh=join(this.dir,'refresh.json');try{if(existsSync(refresh)){const value=JSON.parse(ownedText(refresh));if(Number.isFinite(value.lastCheck)&&value.lastCheck<=this.clock())this.lastCheck=value.lastCheck;}}catch{/* Cadence metadata is not catalog trust; discard it without invalidating signed content. */}
  }catch{this.resetKeys();this.releases=[];this.withdrawn.clear();this.corrupt=true;this.error='TRUSTED_CATALOG_CACHE_INVALID';}
 }
 private resetKeys(){this.keys=new Map(this.trust.keys.map(k=>[k.id,k.publicKey]));}
 onChanged(fn:(catalogChanged:boolean)=>void){this.changed=fn;}
 private save(){const data={version:'m6.11-v1',releases:this.releases};if(Buffer.byteLength(JSON.stringify(data))>32*1024*1024)throw Error('CATALOG_HISTORY_LIMIT');atomicJson(this.dir,'state.json',data);}
 private validateAndApply(input:unknown,enforceLifetime=true){
  const r=signedCatalogReleaseSchema.parse(input);if(!verifyMetadataSignature(r,this.keys))throw Error('CATALOG_SIGNATURE_INVALID');
  const p=r.payload,last=this.releases.at(-1);if(enforceLifetime&&(Date.parse(p.issuedAt)>this.clock()+300000||Date.parse(p.expiresAt)<=this.clock()||Date.parse(p.expiresAt)-Date.parse(p.issuedAt)>180*86400000))throw Error('CATALOG_RELEASE_EXPIRED_OR_FUTURE');
  if(last&&p.sequence<=last.payload.sequence){if(p.sequence===last.payload.sequence&&r.payloadSha256===last.payloadSha256)return false;throw Error('CATALOG_ROLLBACK_REJECTED');}
  if(p.action==='rollback'&&(!this.releases.some(r=>r.payload.sequence===p.rollbackOf)||p.rollbackOf!>=p.sequence))throw Error('CATALOG_ROLLBACK_TARGET_UNKNOWN');
  if(canonical(p.executionPins)!==canonical(this.pins))throw Error('CATALOG_EXECUTION_PINS_CHANGED');
  if(p.entries.some(e=>this.frozen.has(e.id)))throw Error('CATALOG_EXECUTABLE_OVERRIDE_REJECTED');
  const ids=new Set<string>();for(const row of p.withdrawals){if(ids.has(row.id))throw Error('DUPLICATE_WITHDRAWAL');ids.add(row.id);}
  // Every new snapshot carries all revocations, including after a rollback or
  // rotation, so a client that skips ordinary versions still receives them.
  for(const id of this.withdrawn.keys())if(!ids.has(id))throw Error('CATALOG_WITHDRAWAL_REMOVAL_REJECTED');
  // Sticky withdrawal history: even a correctly signed rollback cannot remove it.
  const next=new Map(this.keys);for(const k of p.nextKeys){const existing=next.get(k.id);if(existing&&existing!==k.publicKey)throw Error('CATALOG_KEY_ID_REUSED');const pk=createPublicKey(k.publicKey);if(pk.asymmetricKeyType!=='ed25519')throw Error('CATALOG_KEY_INVALID');next.set(k.id,k.publicKey);}for(const id of p.retireKeyIds)next.delete(id);if(!next.size||next.size>10)throw Error('CATALOG_KEY_ROTATION_INVALID');
  if(this.releases.length>=256)throw Error('CATALOG_HISTORY_LIMIT');this.releases.push(r);this.keys=next;for(const row of p.withdrawals)this.withdrawn.set(row.id,row);
  return true;
 }
 accept(input:unknown){if(this.corrupt)throw Error('TRUSTED_CATALOG_CACHE_INVALID');const previous={releases:[...this.releases],keys:new Map(this.keys),withdrawn:new Map(this.withdrawn)};
  try{let changed:boolean;if((input as {version?:unknown})?.version==='m6.12-v1'){const bundle=catalogBundleSchema.parse(input);if(bundle.baselineSha256!==this.baseline.payloadSha256||canonical(bundle.releases[0])!==canonical(this.baseline))throw Error('CATALOG_BASELINE_MISMATCH');const latest=bundle.releases.at(-1)!;if(latest.payload.sequence<(previous.releases.at(-1)?.payload.sequence??0))throw Error('CATALOG_ROLLBACK_REJECTED');for(const r of previous.releases){if(canonical(bundle.releases.find(n=>n.payload.sequence===r.payload.sequence))!==canonical(r))throw Error('CATALOG_HISTORY_REPLACED');}this.releases=[];this.withdrawn.clear();this.resetKeys();for(const [i,r] of bundle.releases.entries()){if(Date.parse(r.payload.issuedAt)>this.clock()+300000||Date.parse(r.payload.expiresAt)-Date.parse(r.payload.issuedAt)>180*86400000)throw Error('CATALOG_RELEASE_EXPIRED_OR_FUTURE');this.validateAndApply(r,i===bundle.releases.length-1);}changed=latest.payloadSha256!==previous.releases.at(-1)?.payloadSha256;}else changed=this.validateAndApply(input);this.catalog(this.baseCatalog);if(changed)this.save();this.error=null;if(changed)this.changed(true);return changed;}catch(e){this.releases=previous.releases;this.keys=previous.keys;this.withdrawn=previous.withdrawn;this.error=e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'CATALOG_RELEASE_INVALID';throw Error(this.error);}
 }
 /** Includes signed rotation and withdrawal history so an offline client can catch up. */
 bundle(){if(this.corrupt)throw Error('TRUSTED_CATALOG_CACHE_INVALID');return catalogBundleSchema.parse({version:'m6.12-v1',baselineSha256:this.baseline.payloadSha256,releases:structuredClone(this.releases)});}
 assertUsable(id:string){if(this.corrupt)throw Error('TRUSTED_CATALOG_CACHE_INVALID');if(this.withdrawn.has(id))throw Error('POTENTIAL_WITHDRAWN');}
 /** Maintainer provenance lookup; never returns a signing key or grants approval. */
 release(sequence:number){const r=this.releases.find(v=>v.payload.sequence===sequence);return r?structuredClone(r):null;}
 status(){const r=this.releases.at(-1);return {version:'m6.11-v1',sequence:r?.payload.sequence??0,keyId:r?.keyId??null,issuedAt:r?.payload.issuedAt??null,expiresAt:r?.payload.expiresAt??null,expired:r?Date.parse(r.payload.expiresAt)<=this.clock():false,busy:!!this.controller,error:this.error,feedConfigured:!!this.trust.updateUrl,updateUrl:this.trust.updateUrl,withdrawals:[...this.withdrawn.values()],metadataEntries:r?.payload.entries.length??0,executionAuthority:false,cacheCorrupt:this.corrupt};}
 catalog(base:PotentialCatalog){const c=structuredClone(base),r=this.releases.at(-1);if(r){for(const e of r.payload.entries){const i=c.entries.findIndex(v=>v.id===e.id);if(i>=0)c.entries[i]=e;else{c.entries.push(e);c.coverage.push({name:e.id,entryId:e.id,reason:{zh:'签名发布的已审核元数据；不授予运行资格。',en:'Signed reviewed metadata; no execution permission.'}});}}c.releaseId='potential-hub-signed-'+r.payload.sequence;}
  for(const e of c.entries){const row=this.withdrawn.get(e.id);if(row){e.execution.blockers=['POTENTIAL_WITHDRAWN',...e.execution.blockers.filter(b=>b!=='POTENTIAL_WITHDRAWN')];e.limitations=[row.reason,...e.limitations].slice(0,10);}}
  return potentialCatalogSchema.parse(c);
 }
 async refresh(force=false){if(this.controller)throw Error('CATALOG_REFRESH_BUSY');if(!this.trust.updateUrl)return this.status();if(!force&&this.lastCheck!==null&&this.clock()-this.lastCheck<86400000)return this.status();this.lastCheck=this.clock();const controller=new AbortController();this.controller=controller;this.changed(false);
  try{const response=await fetchMetadata(this.trust.updateUrl,this.network,{signal:controller.signal,maxBytes:32*1024*1024});if(response.status!==200)throw Error('CATALOG_FEED_UNAVAILABLE');this.accept(JSON.parse(response.text));}catch(e){this.error=e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'CATALOG_RELEASE_INVALID';}finally{this.controller=null;atomicJson(this.dir,'refresh.json',{lastCheck:this.lastCheck});this.changed(false);}return this.status();
 }
 dispose(){this.controller?.abort();}
}
