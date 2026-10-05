import {copyFile,mkdir,readdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
/** These are executable JS assets, not TypeScript. Preserve byte identity with replay/resource copies. */
const source=resolve('experiments'),destination=resolve('dist/experiments');await mkdir(destination,{recursive:true});
for(const file of await readdir(source)){
  if(!file.endsWith('.mjs'))continue;
  const from=join(source,file),to=join(destination,file);await copyFile(from,to);
  const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  if(digest(await readFile(from))!==digest(await readFile(to)))throw Error('SCIENTIFIC_BUILD_COPY_CHANGED');
}
