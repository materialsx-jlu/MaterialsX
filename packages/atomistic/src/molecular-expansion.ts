import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {molecularExpansionSchema} from '../../contracts/src/potential-molecules.js';
import {createHash} from 'node:crypto';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function molecularExpansion(root:string){const path=join(root,'models/potentials/molecules-m613.json');if(!existsSync(path))return null;const m=molecularExpansionSchema.parse(JSON.parse(readFileSync(path,'utf8')));if(hash(readFileSync(join(root,'atomistic/environments/ani/uv.lock')))!==m.entry.dependencyLockSha256)throw Error('PACKAGE_ENVIRONMENT_MISMATCH');for(const n of m.entry.notices)if(hash(readFileSync(join(root,n.path)))!==n.sha256)throw Error('PACKAGE_NOTICE_MISMATCH');return m;}
