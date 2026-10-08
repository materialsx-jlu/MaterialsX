import {z} from 'zod';import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {adapterExpansionSchema,sevenNetPackageSchema} from '../packages/contracts/src/potential-adapters.js';
import {adapterExpansion} from '../packages/atomistic/src/adapter-expansion.js';
import {effectiveRegistry} from '../packages/atomistic/src/model-packages.js';
import {mountReviewedCatalog} from '../packages/atomistic/src/mounted-catalog.js';
import {buildPotentialCatalog} from '../packages/atomistic/src/potential-hub.js';
import {parsePotentialRegistry} from '../packages/atomistic/src/registry.js';
await mkdir('schemas/m610',{recursive:true});
for(const [name,schema] of Object.entries({AdapterExpansion:adapterExpansionSchema,SevenNetPackage:sevenNetPackageSchema})){
 const text=JSON.stringify({...z.toJSONSchema(schema,{target:'draft-2020-12'}),$id:`https://materialsx.local/schemas/m610/${name}.json`,'x-runtime-refinements':'Only the application-reviewed SevenNet ID, exact weight, pinned code, notices and environment lock are executable. Backend approval, actual capabilities, task/domain gates and real result hashes are checked locally. Public candidates are metadata only.'},null,2)+'\n';const path=`schemas/m610/${name}.json`;
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==text)throw Error(`Schema drift ${name}`);}else await writeFile(path,text);
}
const root=process.cwd(),extra=adapterExpansion(root),registry=effectiveRegistry(root);if(extra.entries.length!==1||!registry.potentials.some(p=>p.id===extra.entries[0]!.potentialId))throw Error('M610_ADAPTER_MISSING');
const legacy=parsePotentialRegistry(JSON.parse(await readFile('models/potentials/registry.json','utf8')));
const catalog=mountReviewedCatalog(root,buildPotentialCatalog(legacy,JSON.parse(await readFile('models/potentials/catalog-m67.json','utf8'))));
console.log(JSON.stringify({stage:'M6.10',newAdapter:'sevennet-ase',reviewedPackages:extra.entries.length,publicCandidateIdentities:extra.candidates.length,catalogEntries:catalog.entries.length,legacyCheckpoints:registry.potentials.length}));
