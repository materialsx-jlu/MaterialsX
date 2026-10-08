import {z} from 'zod';import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {discoverySourcesSchema,discoveryRecordSchema,discoveryReviewSchema,signedCatalogReleaseSchema,catalogTrustSchema} from '../packages/contracts/src/potential-discovery.js';
await mkdir('schemas/m611',{recursive:true});
for(const [name,schema] of Object.entries({DiscoverySources:discoverySourcesSchema,DiscoveryRecord:discoveryRecordSchema,DiscoveryReview:discoveryReviewSchema,SignedCatalogRelease:signedCatalogReleaseSchema,CatalogTrust:catalogTrustSchema})){
 const text=JSON.stringify({...z.toJSONSchema(schema,{target:'draft-2020-12'}),$id:`https://materialsx.local/schemas/m611/${name}.json`,'x-runtime-refinements':'Ed25519 signature, canonical payload digest, sequence, lifetime, pinned execution identities, sticky withdrawals, key rotation and immutable execution boundaries are checked by the client.'},null,2)+'\n';const path=`schemas/m611/${name}.json`;if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==text)throw Error('M611_SCHEMA_DRIFT');}else await writeFile(path,text);
}
console.log('M6.11 discovery and signed-release contracts checked/exported');
