import {createPublicKey,type KeyObject} from 'node:crypto';
import {signedMethodRelease,methodReleasePayload,type SignedMethodRelease} from '../../contracts/src/method-packages.js';
import {signMetadata,verifyMetadataSignature} from '../../atomistic/src/signed-metadata.js';
import {packageDigest} from './method-reference.js';
export function signMethodRelease(input:unknown,keyId:string,key:KeyObject){return signedMethodRelease.parse(signMetadata(methodReleasePayload.parse(input),keyId,key));}
/** Replay a bounded publisher chain. Revocations survive upgrades and signed rollbacks. */
export function methodPublication(chain:SignedMethodRelease[],initialKeys:Array<{id:string;publicKey:string}>,now=Date.now(),checkLastLifetime=false){
  let keys=new Map(initialKeys.map(k=>[k.id,k.publicKey]));const seenKeys=new Map(keys),withdrawn=new Set<string>();let last:SignedMethodRelease|undefined;
  for(const [index,input]of chain.entries()){
    const r=signedMethodRelease.parse(input),p=r.payload;
    if(!verifyMetadataSignature(r,keys))throw Error('METHOD_SIGNATURE_INVALID');
    if(p.previous!==(last?.payloadSha256??null)||p.sequence<=(last?.payload.sequence??0))throw Error('METHOD_RELEASE_HISTORY_CONFLICT');
    if(Date.parse(p.expiresAt)<=Date.parse(p.issuedAt)||Date.parse(p.expiresAt)-Date.parse(p.issuedAt)>180*86400000||Date.parse(p.issuedAt)>now+300000||
      checkLastLifetime&&index===chain.length-1&&Date.parse(p.expiresAt)<=now)throw Error('METHOD_RELEASE_EXPIRED_OR_FUTURE');
    if(p.action==='rollback'){
      const target=chain.slice(0,index).find(r=>r.payload.sequence===p.rollbackOf);
      if(!target||JSON.stringify(p.entries)!==JSON.stringify(target.payload.entries))throw Error('METHOD_ROLLBACK_TARGET_INVALID');
    }else if(p.rollbackOf!==null)throw Error('METHOD_ROLLBACK_TARGET_INVALID');
    const digests=p.entries.map(m=>packageDigest(m).sha256);
    if(new Set(p.entries.map(m=>m.id)).size!==p.entries.length||new Set(p.reviews.map(x=>x.pin.sha256)).size!==p.reviews.length)throw Error('METHOD_DUPLICATE_RELEASE_ENTRY');
    for(const m of p.entries){const pin=packageDigest(m);if(!p.reviews.some(x=>x.decision==='approve'&&x.pin.id===pin.id&&x.pin.version===pin.version&&x.pin.sha256===pin.sha256))throw Error('METHOD_PUBLICATION_REVIEW_MISSING');}
    if(p.reviews.some(x=>!digests.includes(x.pin.sha256)))throw Error('METHOD_REVIEW_NOT_BOUND');
    const revocations=new Set(p.withdrawals.map(x=>x.sha256));if(revocations.size!==p.withdrawals.length||[...withdrawn].some(h=>!revocations.has(h)))throw Error('METHOD_WITHDRAWAL_REMOVAL_REJECTED');
    for(const h of revocations)withdrawn.add(h);
    for(const k of p.nextKeys){if(seenKeys.has(k.id)&&seenKeys.get(k.id)!==k.publicKey||createPublicKey(k.publicKey).asymmetricKeyType!=='ed25519')throw Error('METHOD_KEY_ROTATION_INVALID');keys.set(k.id,k.publicKey);seenKeys.set(k.id,k.publicKey);}
    for(const id of p.retireKeyIds)keys.delete(id);if(!keys.size||keys.size>10)throw Error('METHOD_KEY_ROTATION_INVALID');last=r;
  }
  return {withdrawn,keys,last};
}
