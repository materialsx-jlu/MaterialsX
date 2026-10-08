import { z } from "zod";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { relaxationSchemas } from "../packages/contracts/src/atomistic-relaxation.js";
await mkdir("schemas/m63",{recursive:true});
for(const [name,schema] of Object.entries(relaxationSchemas)){
 const text=JSON.stringify({...z.toJSONSchema(schema,{target:"draft-2020-12"}),$id:`https://materialsx.local/schemas/m6.3-v1/${name}.json`,"x-runtime-refinements":"Project ownership, actual file hashes, atom mapping, convergence and history continuity require runtime validation."},null,2)+"\n";
 const path=`schemas/m63/${name}.json`;if(process.argv.includes("--check")){if(await readFile(path,"utf8")!==text)throw Error(`Schema drift: ${name}`);}else await writeFile(path,text);
}
console.log("M6.3 relaxation contracts checked/exported");
