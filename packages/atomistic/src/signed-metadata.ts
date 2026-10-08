import {createPublicKey,sign,verify,type KeyObject} from 'node:crypto';
import {canonical,hash} from './discovery-io.js';
/** Same canonical Ed25519 envelope for catalog channels; signatures never authorize code. */
export function signMetadata<T>(payload:T,keyId:string,key:KeyObject){
  if(key.asymmetricKeyType!=='ed25519')throw Error('METADATA_KEY_INVALID');
  const bytes=Buffer.from(canonical(payload));return {keyId,payload,payloadSha256:hash(bytes),signature:sign(null,bytes,key).toString('base64')};
}
export function verifyMetadataSignature(release:{keyId:string;payload:unknown;payloadSha256:string;signature:string},keys:ReadonlyMap<string,string>){
  const pem=keys.get(release.keyId),bytes=Buffer.from(canonical(release.payload));if(!pem||hash(bytes)!==release.payloadSha256)return false;
  try{const key=createPublicKey(pem);return key.asymmetricKeyType==='ed25519'&&verify(null,bytes,key,Buffer.from(release.signature,'base64'));}catch{return false;}
}
