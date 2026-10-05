import {generateKeyPairSync,createPrivateKey,createPublicKey} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {CatalogUpdateService,executionPins,signCatalog} from '../packages/atomistic/src/catalog-updates.js';
import {PotentialDiscoveryService} from '../packages/atomistic/src/potential-discovery.js';
import {reviewedDiscoveryEntry} from '../packages/atomistic/src/discovery-publisher.js';
import {buildPotentialCatalog} from '../packages/atomistic/src/potential-hub.js';
import {mountReviewedCatalog} from '../packages/atomistic/src/mounted-catalog.js';
import {parsePotentialRegistry} from '../packages/atomistic/src/registry.js';
import {catalogReleasePayloadSchema,discoveryReviewSchema} from '../packages/contracts/src/potential-discovery.js';
import {canonical} from '../packages/atomistic/src/discovery-io.js';
const root=process.cwd(),args=process.argv.slice(2),command=args.shift();
const option=(k:string,fallback:string)=>{const i=args.indexOf('--'+k);return i>=0?args[i+1]??fallback:fallback;};
const state=resolve(option('state','runtime/m6/discovery-publisher')),keyPath=resolve(option('key','runtime/m6/catalog-publisher/signing-key.pem')),keyId=option('key-id','materialsx-catalog-2026-bootstrap');
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const output=resolve(option('output','runtime/m6/catalog-publisher/catalog-release.json'));
const now=new Date(),expires=new Date(now.getTime()+90*86400000).toISOString();
const base=()=>mountReviewedCatalog(root,buildPotentialCatalog(parsePotentialRegistry(json(join(root,'models/potentials/registry.json'))),json(join(root,'models/potentials/catalog-m67.json'))));
const save=(p:string,v:unknown)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,JSON.stringify(v,null,2)+'\n');};
if(command==='init'){
 const trust=join(root,'models/potentials/discovery-trust.json'),baseline=join(root,'models/potentials/catalog-release.json');if([keyPath,trust,baseline].some(existsSync))throw Error('CATALOG_KEY_ALREADY_INITIALIZED');
 const keys=generateKeyPairSync('ed25519');mkdirSync(dirname(keyPath),{recursive:true});writeFileSync(keyPath,keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600,flag:'wx'});
 save(trust,{version:'m6.11-v1',updateUrl:null,keys:[{id:keyId,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()}]});
 save(baseline,signCatalog(catalogReleasePayloadSchema.parse({version:'m6.11-v1',sequence:1,issuedAt:now.toISOString(),expiresAt:expires,action:'publish',rollbackOf:null,entries:[],withdrawals:[],reviews:[],executionPins:executionPins(root),nextKeys:[],retireKeyIds:[]}),keyId,keys.privateKey));console.log('Catalog public trust and signed baseline initialized. Private key retained only in ignored local publisher storage. No remote release created.');
}else if(command==='review'){
 const file=resolve(option('file',''));if(file===root)throw Error('REVIEW_FILE_REQUIRED');const service=new PotentialDiscoveryService(root,state,base);const q=discoveryReviewSchema.parse(json(file));const r=service.review(q);console.log(JSON.stringify({id:r.id,status:r.review.status}));
}else if(command==='publish'||command==='rollback'||command==='rotate'){
 const service=new PotentialDiscoveryService(root,state,base),client=new CatalogUpdateService(root,state);const previousPath=resolve(option('previous','models/potentials/catalog-release.json')),previous=json(previousPath);
 // Revalidate the complete previous signed history before choosing the next sequence.
 if(previous.payload.sequence>client.status().sequence)client.accept(previous);
 if(canonical(client.release(previous.payload.sequence))!==canonical(previous))throw Error('PREVIOUS_RELEASE_IDENTITY_MISMATCH');
 const previousPayload=previous.payload;
 const rows=service.search({status:'approved',limit:50}).records;const total=service.search({status:'approved',limit:1}).total;for(let offset=50;offset<total;offset+=50)rows.push(...service.search({status:'approved',offset,limit:50}).records);
 if(command==='rotate'&&previousPayload.sequence!==client.status().sequence)throw Error('ROTATION_REQUIRES_CURRENT_RELEASE');
 const active=rows.filter(r=>r.observation.status==='active'),entries=command!=='publish'?previousPayload.entries:active.map(r=>reviewedDiscoveryEntry(r,base()));
 const withdrawals=[...client.status().withdrawals];for(const r of rows.filter(r=>r.observation.status==='withdrawn'))for(const id of r.relation==='same_official_asset'?r.relatedCatalogIds:[r.id])if(!withdrawals.some(v=>v.id===id))withdrawals.push({id,reason:r.review.note!,evidenceUrl:r.observation.url});
 const reviews=command!=='publish'?previousPayload.reviews:active.map((r,i)=>({id:entries[i]!.id,discoveryId:r.id,contentSha256:r.contentSha256,reviewer:r.review.reviewer!,decision:'metadata-only',note:r.review.note!}));
 const nextKeys=[];const retireKeyIds:string[]=[];if(command==='rotate'){const nextKeyId=option('next-key-id',''),publicPath=option('next-public-key','');if(!nextKeyId||!publicPath)throw Error('NEXT_PUBLIC_KEY_REQUIRED');const next=createPublicKey(readFileSync(resolve(publicPath)));if(next.asymmetricKeyType!=='ed25519')throw Error('CATALOG_KEY_INVALID');nextKeys.push({id:nextKeyId,publicKey:next.export({type:'spki',format:'pem'}).toString()});const retire=option('retire-key-id','');if(retire)retireKeyIds.push(retire);}
 const payload=catalogReleasePayloadSchema.parse({version:'m6.11-v1',sequence:Math.max(client.status().sequence,previousPayload.sequence)+1,issuedAt:now.toISOString(),expiresAt:expires,action:command==='rollback'?'rollback':'publish',rollbackOf:command==='rollback'?previousPayload.sequence:null,entries,withdrawals,reviews,executionPins:executionPins(root),nextKeys,retireKeyIds});
 const release=signCatalog(payload,keyId,createPrivateKey(readFileSync(keyPath)));client.accept(release);save(output,release);save(join(dirname(output),'catalog-bundle.json'),client.bundle());console.log(JSON.stringify({output,sequence:payload.sequence,entries:entries.length,withdrawals:withdrawals.length,remotePublished:false}));
}else throw Error('Usage: m611-publisher.ts init | review --file review.json | publish | rollback --previous release.json | rotate --previous current.json --next-key-id id --next-public-key key.pub.pem [--retire-key-id id]; local key and state paths only.');
