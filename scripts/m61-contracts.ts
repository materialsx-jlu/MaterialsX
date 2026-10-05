import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { atomisticSnapshotSchema, getAtomisticSchema, inspectAtomisticSchema, startAtomisticSchema } from "../packages/contracts/src/atomistic-runtime.js";
await mkdir("schemas/m61",{recursive:true});
for(const [name,schema] of Object.entries({LocalAtomisticSnapshot:atomisticSnapshotSchema,StartLocalAtomisticRun:startAtomisticSchema,GetLocalAtomisticRun:getAtomisticSchema,InspectLocalAtomicStructure:inspectAtomisticSchema})) {
 const text=JSON.stringify({...z.toJSONSchema(schema,{target:"draft-2020-12"}),$id:`https://materialsx.local/schemas/m6.1-v1/${name}.json`,"x-runtime-refinements":"Zod cross-field checks and main-process project ownership/identity checks are mandatory."},null,2)+"\n";
 const path=`schemas/m61/${name}.json`;if(process.argv.includes("--check")){if(await readFile(path,"utf8")!==text)throw Error(`Schema drift: ${name}`);}else await writeFile(path,text);
}
console.log("M6.1 narrow local runtime contracts checked/exported");
