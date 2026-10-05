import {physicsExpansion} from './physics-expansion.js';
import {nativeExpansion} from './native-expansion.js';
import {molecularExpansion} from './molecular-expansion.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageManifestSchema } from '../../contracts/src/potential-packages.js';
import { digest } from './selection.js';
import { parsePotentialRegistry } from './registry.js';
import { adapterExpansion } from './adapter-expansion.js';
/** Audited application assets, never request-provided URLs, modules, hashes or scripts. */
export function approvedPackages(root:string){
 const m=packageManifestSchema.parse(JSON.parse(readFileSync(join(root,'models/potentials/packages-m68.json'),'utf8')));
 const registry=parsePotentialRegistry(JSON.parse(readFileSync(join(root,'models/potentials/registry.json'),'utf8')));
 for(const e of m.entries){const p=registry.potentials.find(p=>p.id===e.potentialId);
  if(!p||p.weights.url!==e.url||p.environment.codeRevision!==e.sourceRevision||p.environment.adapter!==e.adapter)throw Error('PACKAGE_SOURCE_MISMATCH');
  for(const n of e.notices)if(digest(readFileSync(join(root,n.path)))!==n.sha256)throw Error('PACKAGE_NOTICE_MISMATCH');
  if(digest(readFileSync(join(root,'atomistic/environments',e.family,'uv.lock')))!==e.dependencyLockSha256)throw Error('PACKAGE_ENVIRONMENT_MISMATCH');
 }
 const extra=adapterExpansion(root);
 for(const e of extra.entries){const p=registry.potentials.find(p=>p.id===e.potentialId);if(!p||p.weights.url!==e.url||p.environment.codeRevision!==e.sourceRevision||p.environment.adapter!==e.adapter)throw Error('PACKAGE_SOURCE_MISMATCH');}
 const molecule=molecularExpansion(root);
 return [...m.entries,...extra.entries,...(molecule?[molecule.entry]:[]),...(physicsExpansion(root)?[physicsExpansion(root)!.entry]:[]),...(nativeExpansion(root)?[nativeExpansion(root)!.entry]:[])];
}
