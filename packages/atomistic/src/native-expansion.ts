import {existsSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {nativeExpansionSchema} from '../../contracts/src/potential-native.js';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function nativeExpansion(root:string){const path=join(root,'models/potentials/native-m614.json');if(!existsSync(path))return null;const m=nativeExpansionSchema.parse(JSON.parse(readFileSync(path,'utf8')));if(sha(readFileSync(join(root,'atomistic/environments/chgnet/uv.lock')))!==m.entry.dependencyLockSha256)throw Error('PACKAGE_ENVIRONMENT_MISMATCH');for(const n of [...m.entry.notices,...m.engine.sources])if(sha(readFileSync(join(root,n.path)))!==n.sha256)throw Error('NATIVE_SOURCE_OR_NOTICE_CHANGED');return m;}
