import { z } from 'zod';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { potentialCatalogSchema,hubEntrySchema,catalogSearchSchema,skillSearchSchema,userSkillDraftSchema } from '../packages/contracts/src/potential-hub.js';
await mkdir('schemas/m67',{recursive:true});
for(const [name,schema] of Object.entries({PotentialCatalog:potentialCatalogSchema,HubEntry:hubEntrySchema,CatalogSearch:catalogSearchSchema,SkillSearch:skillSearchSchema,UserSkillDraft:userSkillDraftSchema})){
 const content=JSON.stringify({...z.toJSONSchema(schema,{target:'draft-2020-12'}),$id:`https://materialsx.local/schemas/m6.7-v1/${name}.json`,'x-runtime-refinements':'Resolve evidence/related/coverage IDs, deduplicate weight configurations, validate live identity and task eligibility separately. Catalog lookup never grants execution permission. Skill content contracts do not write or execute code.'},null,2)+'\n';const path=`schemas/m67/${name}.json`;
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==content)throw Error(`Schema drift: ${name}`);}else await writeFile(path,content);
}
console.log('M6.7 contracts checked/exported');
