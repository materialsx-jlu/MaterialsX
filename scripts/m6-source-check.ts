import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parsePotentialRegistry } from "../packages/atomistic/src/registry.js";
// Explicit, read-only network audit. Never deserializes checkpoints, executes downloads or installs packages.
const registry=parsePotentialRegistry(JSON.parse(await readFile("models/potentials/registry.json","utf8")));
const lock=JSON.parse(await readFile("models/potentials/source-lock.json","utf8"));
async function digest(url:string,maximum:number) {
  const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok || !response.body) throw Error(`Source unavailable: HTTP ${response.status}`);
  const h=createHash("sha256"); let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>maximum)throw Error("Source exceeds audit limit");h.update(chunk)}
  return {sha256:h.digest("hex"),bytes};
}
for (const s of lock.sources as Array<{url:string;sha256:string;id:string}>) {
  const u=new URL(s.url); if(u.hostname!=="github.com")throw Error("Non-official repository evidence");
  const raw=`https://raw.githubusercontent.com${u.pathname.replace("/blob/","/")}`;
  const actual=await digest(raw,1024*1024);
  if(actual.sha256!==s.sha256)throw Error(`Pinned source drift: ${s.id}`);
  console.log(`source verified: ${s.id}`);
}
if(process.argv.includes("--weights"))for(const p of registry.potentials.filter(p=>p.role==="core-candidate")) {
  const actual=await digest(p.weights.url,128*1024*1024);
  if(actual.sha256!==p.weights.sha256 || actual.bytes!==p.weights.bytes)throw Error(`Weight identity mismatch: ${p.id}`);
  console.log(`weight identity verified (not installed or executed): ${p.id}`);
}
console.log("Pinned upstream identities checked; no scientific computation or weights installation");
