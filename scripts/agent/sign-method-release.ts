import {createPrivateKey} from 'node:crypto';
import {resolve,dirname,basename} from 'node:path';
import {signMethodRelease} from '../../packages/agent/src/method-publication.js';
import {ownedText,atomicJson} from '../../packages/atomistic/src/discovery-io.js';
const arg=(name:string)=>{const i=process.argv.indexOf(name),value=process.argv[i+1];if(i<0||!value||value.startsWith('--'))throw Error('Required '+name);return value;};
const input=resolve(arg('--input')),key=resolve(arg('--key')),output=resolve(arg('--output')),keyId=arg('--key-id');
if(input===output||key===output)throw Error('SIGN_OUTPUT_OVERWRITE_REJECTED');
const release=signMethodRelease(JSON.parse(ownedText(input,512*1024)),keyId,createPrivateKey(ownedText(key,16*1024)));
atomicJson(dirname(output),basename(output),release);console.log('Signed method metadata: '+release.payloadSha256+'; no code execution authority.');
