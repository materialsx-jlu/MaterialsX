import { createHash } from 'node:crypto';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { buildPotentialCatalog } from '../packages/atomistic/src/potential-hub.js';
import { parsePotentialRegistry } from '../packages/atomistic/src/registry.js';
const old=await readFile('models/potentials/registry.json'),extra=await readFile('models/potentials/catalog-m67.json');
const c=buildPotentialCatalog(parsePotentialRegistry(JSON.parse(old.toString())),JSON.parse(extra.toString()));
const types:Record<string,number>={};for(const e of c.entries)types[e.entityType]=(types[e.entityType]??0)+1;
const receipt={stage:'M6.7',schemaVersion:c.schemaVersion,releaseId:c.releaseId,legacySha256:createHash('sha256').update(old).digest('hex'),supplementSha256:createHash('sha256').update(extra).digest('hex'),entries:c.entries.length,coverageNames:c.coverage.length,types,capabilityPolicy:'Declared metadata only; missing evidence/compatibility does not qualify for execution.',newWeightsDownloaded:0,liveSourceSync:false};
await mkdir('runtime/m6/verification',{recursive:true});await writeFile('runtime/m6/verification/m67-catalog.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
