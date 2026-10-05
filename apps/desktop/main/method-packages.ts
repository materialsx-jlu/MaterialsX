import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {methodPackageSchema,methodPackagePin,methodReviewSchema,signedMethodRelease,methodPackageQuery,
  type MethodPackage,type MethodPackagePin,type MethodPackageOverview,type MethodPackageEntry} from '../../../packages/contracts/src/method-packages.js';
import {methodInput,methodAnalysisSchema} from '../../../packages/contracts/src/research-methods.js';
import {catalogTrustSchema} from '../../../packages/contracts/src/potential-discovery.js';
import {hash,canonical,ownedText} from '../../../packages/atomistic/src/discovery-io.js';
import {reproduceMethod,packageDigest,numericModulePath} from '../../../packages/agent/src/method-reference.js';
import {methodPublication} from '../../../packages/agent/src/method-publication.js';
import type {ResearchStore} from './research-store.js';
/** Metadata companion only. Actual analysis remains in the existing supervised tool loop. */
export class MethodPackages {
  private readonly bundled:MethodPackage[];
  constructor(private store:ResearchStore,readonly root:string,private clock=Date.now){
    this.bundled=z.array(methodPackageSchema).max(40).parse(JSON.parse(ownedText(join(root,'methods/catalog.json'))));
    if(new Set(this.bundled.map(m=>m.id)).size!==this.bundled.length)throw Error('METHOD_BUNDLED_DUPLICATE');
  }
  private publication(checkLifetime=false){const state=this.store.methodPackageState(),trust=catalogTrustSchema.parse(JSON.parse(ownedText(join(this.root,'models/potentials/discovery-trust.json'))));return methodPublication(state.releases,trust.keys,this.clock(),checkLifetime);}
  private all(){const state=this.store.methodPackageState();return [...new Map([...this.bundled,...state.candidates,...state.releases.flatMap(r=>r.payload.entries)].map(m=>[packageDigest(m).sha256,m])).values()];}
  private find(input:unknown){const pin=methodPackagePin.parse(input),manifest=this.all().find(m=>canonical(packageDigest(m))===canonical(pin));if(!manifest)throw Error('METHOD_PACKAGE_NOT_OWNED');return manifest;}
  private compatible(m:MethodPackage){const base=this.bundled.find(b=>b.execution.backend===m.execution.backend&&b.execution.methodId===m.execution.methodId);
    // Metadata can describe any candidate, but it cannot replace scientific code, schemas, gold values, tolerances or locks.
    return !!base&&m.execution.backend!=='unavailable'&&canonical(m.execution)===canonical(base.execution)&&canonical(m.reference)===canonical(base.reference);
  }
  private assertFiles(m:MethodPackage){
    if(hash(readFileSync(numericModulePath))!==m.execution.files.find(f=>f.path==='experiments/math.mjs')?.sha256)throw Error('METHOD_EXECUTABLE_CHANGED');
    for(const f of m.execution.files)if(hash(ownedText(join(this.root,f.path)))!==f.sha256)throw Error('METHOD_SOURCE_CHANGED');
    if(hash(ownedText(join(this.root,'package-lock.json'),4*1024*1024))!==m.execution.dependencyLock)throw Error('METHOD_ENVIRONMENT_LOCK_CHANGED');
    if(hash(canonical(z.toJSONSchema(methodInput,{io:'input'})))!==m.execution.inputSchema||hash(canonical(z.toJSONSchema(methodAnalysisSchema)))!==m.execution.outputSchema)throw Error('METHOD_SCHEMA_CHANGED');
    if(hash(canonical(JSON.parse(ownedText(join(this.root,m.execution.inputContract)))))!==m.execution.inputSchema||hash(canonical(JSON.parse(ownedText(join(this.root,m.execution.outputContract)))))!==m.execution.outputSchema)throw Error('METHOD_SCHEMA_ASSET_CHANGED');
    if(hash(ownedText(join(this.root,'methods/references',m.reference.file),128*1024))!==m.reference.sha256)throw Error('METHOD_REFERENCE_CHANGED');
  }
  overview():MethodPackageOverview{
    const state=this.store.methodPackageState();let error:string|null=null,withdrawn=new Set<string>();
    try{withdrawn=this.publication().withdrawn;}catch(e){error=String(e);}
    const entries=this.all().map((m):MethodPackageEntry=>{
      const pin=packageDigest(m),bundled=this.bundled.some(b=>packageDigest(b).sha256===pin.sha256),published=state.releases.some(r=>r.payload.entries.some(e=>packageDigest(e).sha256===pin.sha256));
      const review=state.reviews.filter(r=>r.pin.sha256===pin.sha256).at(-1)?.decision??(bundled?'bundled':'pending');
      const blockers:string[]=[];if(error)blockers.push('METHOD_TRUST_HISTORY_INVALID');if(withdrawn.has(pin.sha256))blockers.push('METHOD_WITHDRAWN');
      if(review==='reject'||review==='pending')blockers.push('METHOD_LOCAL_REVIEW_REQUIRED');if(!bundled&&!published)blockers.push('METHOD_SIGNED_PUBLICATION_REQUIRED');
      if(m.licenses.some(l=>l.status==='pending'))blockers.push('METHOD_LICENSE_REVIEW_REQUIRED');if(!this.compatible(m))blockers.push('METHOD_ADAPTER_UNAVAILABLE_OR_PINS_CHANGED');
      if(this.compatible(m))try{this.assertFiles(m);}catch(e){blockers.push(String(e).replace(/^Error: /,''));}
      const reference=state.references.filter(r=>r.pin.sha256===pin.sha256).at(-1)??null;
      const current=reference?.status==='passed'&&reference.environment.node===process.versions.node&&reference.environment.arch===process.arch&&reference.environment.platform===process.platform;
      return {manifest:m,pin,origin:bundled?'bundled':'community',review,reference,blockers,executable:!blockers.length,status:withdrawn.has(pin.sha256)?'withdrawn':current&&!blockers.length?'reference-reproduced':'candidate',domainValidated:false};
    });
    return {entries,sequence:state.releases.at(-1)?.payload.sequence??0,releases:state.releases,reviews:state.reviews,error,executionAuthority:false};
  }
  search(input:unknown){const q=methodPackageQuery.parse(input),needle=q.query.toLowerCase();return this.overview().entries.filter(e=>!needle||canonical({id:e.pin.id,name:e.manifest.name,description:e.manifest.description,scope:e.manifest.scope}).toLowerCase().includes(needle)).slice(0,q.limit);}
  import(input:unknown){
    const old=this.store.methodPackageState(),next=structuredClone(old);
    if(signedMethodRelease.safeParse(input).success){const r=signedMethodRelease.parse(input);
      if(next.releases.at(-1)?.payloadSha256===r.payloadSha256){if(canonical(next.releases.at(-1))!==canonical(r))throw Error('METHOD_SIGNATURE_INVALID');return this.overview();}
      const trust=catalogTrustSchema.parse(JSON.parse(ownedText(join(this.root,'models/potentials/discovery-trust.json'))));methodPublication([...next.releases,r],trust.keys,this.clock(),true);next.releases.push(r);
    }else{
      const m=methodPackageSchema.parse(input),pin=packageDigest(m);
      if(this.all().some(p=>packageDigest(p).sha256===pin.sha256))return this.overview();next.candidates.push(m);
    }
    this.store.saveMethodPackageState(next,old);return this.overview();
  }
  review(input:unknown){const q=z.strictObject({pin:methodPackagePin,decision:z.enum(['approve','reject']),reviewer:z.string().min(1).max(200),reason:z.string().min(1).max(2000)}).parse(input);
    this.find(q.pin);const old=this.store.methodPackageState(),next=structuredClone(old);next.reviews.push(methodReviewSchema.parse({...q,at:new Date(this.clock()).toISOString()}));this.store.saveMethodPackageState(next,old);return this.overview();
  }
  verify(input:unknown){const m=this.find(input),entry=this.overview().entries.find(e=>e.pin.sha256===packageDigest(m).sha256)!;
    if(!entry.executable)throw Error('METHOD_PACKAGE_BLOCKED: '+entry.blockers.join(', '));this.assertFiles(m);
    const receipt=reproduceMethod(this.root,m),old=this.store.methodPackageState(),next=structuredClone(old);next.references.push(receipt);this.store.saveMethodPackageState(next,old);return receipt;
  }
  frozenInputs(){const overview=this.overview();return ['source-summary','source-linear-fit'].flatMap(id=>{
    const latest=[...overview.entries].reverse().find(e=>e.pin.id===id&&(e.origin==='bundled'||overview.releases.some(r=>r.payload.entries.some(m=>packageDigest(m).sha256===e.pin.sha256))));
    return latest?[{...latest.pin,id:'method-package:'+latest.pin.id}]:[];
  });}
  forMethod(methodId:string,taskInputs?:Array<{id:string;version:string;sha256:string}>){
    const id=methodId==='descriptive-summary'?'source-summary':['linear-fit','grouped-linear-validation'].includes(methodId)?'source-linear-fit':null;if(!id)return null;
    const frozen=(taskInputs??this.frozenInputs()).find(p=>p.id==='method-package:'+id);if(!frozen)throw Error('METHOD_PACKAGE_NOT_FROZEN');
    const pin={...frozen,id},entry=this.overview().entries.find(e=>canonical(e.pin)===canonical(pin));if(!entry?.executable)throw Error('METHOD_PACKAGE_BLOCKED: '+(entry?.blockers.join(', ')??'unknown version'));
    return pin;
  }
  ready(pin:MethodPackagePin){const entry=this.overview().entries.find(e=>canonical(e.pin)===canonical(pin));if(!entry?.executable)throw Error('METHOD_PACKAGE_BLOCKED');
    const receipt=entry.status==='reference-reproduced'?entry.reference!:this.verify(pin);if(receipt.status!=='passed')throw Error('METHOD_REFERENCE_FAILED');return receipt;
  }
}
