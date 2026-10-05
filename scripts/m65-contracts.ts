import { z } from 'zod';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { dynamicsSchemas } from '../packages/contracts/src/atomistic-dynamics.js';
await mkdir('schemas/m65',{recursive:true});
for(const [name,schema] of Object.entries(dynamicsSchemas)){
 const text=JSON.stringify({...z.toJSONSchema(schema,{target:'draft-2020-12'}),$id:`https://materialsx.local/schemas/m6.5-v1/${name}.json`,'x-runtime-refinements':'Owned immutable input, verified frame ranges/digests, actual step/time and numerical diagnostics must be checked by runtime.'},null,2)+'\n';const path=`schemas/m65/${name}.json`;
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==text)throw Error(`Schema drift: ${name}`);}else await writeFile(path,text);
}
console.log('M6.5 dynamics contracts checked/exported');
