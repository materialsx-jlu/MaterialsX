import {z} from 'zod';import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {distributionOfflineBundleSchema} from '../packages/atomistic/src/offline-bundle.js';
import {distributionSchemas} from '../packages/contracts/src/potential-distribution.js';
await mkdir('schemas/m612',{recursive:true});
for(const [name,schema] of Object.entries({...distributionSchemas,OfflineBundle:distributionOfflineBundleSchema})){const text=JSON.stringify({...z.toJSONSchema(schema,{target:'draft-2020-12'}),$id:`https://materialsx.local/schemas/m612/${name}.json`,'x-runtime-refinements':'Signed history, frozen checkpoint identities, notices, safe paths, in-use guards, disk capacity, preview hash and reproduction hashes are checked at runtime.'},null,2)+'\n',path=`schemas/m612/${name}.json`;if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==text)throw Error('M612_SCHEMA_DRIFT');}else await writeFile(path,text);}
console.log('M6.12 distribution contracts checked/exported');
