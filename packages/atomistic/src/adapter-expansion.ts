import { existsSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapterExpansionSchema } from '../../contracts/src/potential-adapters.js';
import { digest } from './selection.js';
/** Optional only for historical fixtures. Installed applications ship this immutable review file. */
export function adapterExpansion(root:string){
  const path=join(root,'models/potentials/adapters-m610.json');
  if(!existsSync(path)) return {version:'m6.10-v1' as const,entries:[],potentials:[],candidates:[]};
  const m=adapterExpansionSchema.parse(JSON.parse(readFileSync(path,'utf8')));
  for(const e of m.entries){
    if(digest(readFileSync(join(root,'atomistic/environments',e.family,'uv.lock')))!==e.dependencyLockSha256)throw Error('PACKAGE_ENVIRONMENT_MISMATCH');
    for(const n of e.notices)if(digest(readFileSync(join(root,n.path)))!==n.sha256)throw Error('PACKAGE_NOTICE_MISMATCH');
  }
  return m;
}
