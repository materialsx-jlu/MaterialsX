import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ATOMISTIC_CONTRACT_VERSION, atomisticSchemas } from "../packages/contracts/src/atomistic.js";
const directory = "schemas/m6";
await mkdir(directory, { recursive: true });
for (const [name, schema] of Object.entries(atomisticSchemas)) {
  const document = { ...z.toJSONSchema(schema, { target: "draft-2020-12" }),
    $id: `https://materialsx.local/schemas/${ATOMISTIC_CONTRACT_VERSION}/${name}.json`,
    "x-contract-version": ATOMISTIC_CONTRACT_VERSION,
    "x-runtime-refinements": "packages/contracts/src/atomistic.ts refinements are mandatory; JSON Schema alone is insufficient. Authorization, realpath, file hash and resource checks belong to the local executor." };
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  const target = `${directory}/${name}.json`;
  if (process.argv.includes("--check")) {
    if (await readFile(target, "utf8") !== contents) throw new Error(`M6 schema drift: ${target}`);
  } else await writeFile(target, contents);
}
console.log(`M6 contracts ${process.argv.includes("--check") ? "checked" : "exported"}: ${ATOMISTIC_CONTRACT_VERSION}`);
