import { z } from "zod";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { atomicViewRequestSchema,atomicViewPayloadSchema,atomicPngExportSchema,atomicSceneSchema,atomicFrameCommandSchema,atomicFrameEventSchema } from "../packages/contracts/src/atomic-viewer.js";
await mkdir("schemas/m62",{recursive:true});
for(const [name,schema] of Object.entries({AtomicViewRequest:atomicViewRequestSchema,AtomicViewPayload:atomicViewPayloadSchema,AtomicPngExport:atomicPngExportSchema,StaticAtomicScene:atomicSceneSchema,AtomicFrameCommand:atomicFrameCommandSchema,AtomicFrameEvent:atomicFrameEventSchema})) {
 const text=JSON.stringify({...z.toJSONSchema(schema,{target:"draft-2020-12"}),$id:`https://materialsx.local/schemas/m6.2-v1/${name}.json`,"x-runtime-refinements":"Project ownership, realpath/symlink checks, SHA256 verification, force/atom counts, display limits and static-only config checks are mandatory."},null,2)+"\n";
 const path=`schemas/m62/${name}.json`;if(process.argv.includes("--check")){if(await readFile(path,"utf8")!==text)throw Error(`Schema drift: ${name}`);}else await writeFile(path,text);
}
console.log("M6.2 local static viewer contracts checked/exported");
