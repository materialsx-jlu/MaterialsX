import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { atomicStructureSchema, atomisticBudgetSchema } from "../packages/contracts/src/atomistic.js";
import { findPotential, parsePotentialRegistry, potentialReadiness } from "../packages/atomistic/src/registry.js";
const json = async (path:string) => JSON.parse(await readFile(path,"utf8"));
const hash = async (path:string) => createHash("sha256").update(await readFile(path)).digest("hex");
const registry = parsePotentialRegistry(await json("models/potentials/registry.json"));
const sourceLock = await json("models/potentials/source-lock.json");
const profiles = await json("models/potentials/environment-targets.json");
const policy = await json("models/potentials/quality-policy.json");
const samples = await json("samples/atomistic/manifest.json");
const skillPlan = await json("models/potentials/task-skills.json");
assert.equal(skillPlan.skills.length,7);
assert.ok(skillPlan.skills.every((s:{enabled:boolean;examples:Array<{zh:string;en:string}>})=>!s.enabled && s.examples.length===2 && s.examples.every(e=>e.zh && e.en)));
const oldCatalog = await json("models/catalog.json");
const keys = new Set(oldCatalog.models.map((m:{id:string})=>m.id));
for (const p of registry.potentials) {
  assert.equal(p.state,"catalogued"); assert.equal(p.installation,"absent");
  assert.equal(potentialReadiness(p).readyForTaskChecks,false);
  assert.ok(p.description.zh && p.description.en && p.examples.length === 2);
  for (const link of p.relatedCatalogIds) assert.ok(keys.has(link),`${p.id}: orphan catalog link`);
  for (const e of [p.source,...p.evidence]) {
    assert.ok(sourceLock.sources.some((s:{id:string;sha256:string;revision:string})=>s.id===e.id && s.sha256===e.sha256 && s.revision===e.revision),`unlocked evidence ${e.id}`);
  }
  if (p.role === "core-candidate") {
    const w=sourceLock.coreWeightIdentities.find((w:{name:string})=>w.name===p.id);
    assert.ok(w); assert.equal(w.sha256,p.weights.sha256); assert.equal(w.bytes,p.weights.bytes); assert.equal(w.url,p.weights.url);
    const profile=profiles.profiles.find((e:{id:string})=>e.id===p.environment.profileId);
    assert.ok(profile); assert.equal(profile.sourceRevision,p.environment.codeRevision);
    assert.deepEqual(profile.platforms,["macos-arm64","windows-x64"]);
    assert.equal(profile.dependencyLock,null); assert.deepEqual(profile.platformReceipts,[]);
  }
}
assert.equal(profiles.profiles.length,2);
const coreBytes=registry.potentials.filter(p=>p.role==="core-candidate").reduce((n,p)=>n+p.weights.bytes!,0);
assert.ok(coreBytes<=profiles.packagingBudget.coreWeightsMaxMiB*1048576);
atomisticBudgetSchema.parse(Object.fromEntries(["maxAtoms","maxSteps","maxWallSeconds","maxMemoryMiB","maxOutputMiB","threads"].map(k=>[k,policy.defaults[k]])));
assert.equal(policy.domainQuality.status,"blocked-reference-data-missing");
assert.deepEqual(policy.domainQuality.references,[]);
assert.equal(policy.domainQuality.minimumStructuresPerCore,Object.values(policy.domainQuality.minimumPerDomain).reduce((a:number,b)=>a+Number(b),0));
let valid=0,invalid=0;
const paths=["models/potentials/registry.json","models/potentials/source-lock.json","models/potentials/environment-targets.json","models/potentials/quality-policy.json","models/potentials/task-skills.json","samples/atomistic/manifest.json"];
for (const sample of samples.samples) {
  assert.match(sample.file,/^[A-Za-z0-9_.-]+$/);
  const path=`samples/atomistic/${sample.file}`; paths.push(path);
  assert.equal(await hash(path),sample.sha256,`sample bytes changed ${sample.id}`);
  assert.equal(sample.reference,null); assert.equal(sample.scientificValidationEligible,false);
  if (sample.normalizedFile) {
    assert.match(sample.normalizedFile,/^[A-Za-z0-9_.-]+$/);
    const normalPath=`samples/atomistic/${sample.normalizedFile}`; paths.push(normalPath);
    assert.equal(await hash(normalPath),sample.normalizedSha256);
    const normal=atomicStructureSchema.parse(await json(normalPath));
    assert.equal(normal.source.sha256,sample.sha256); assert.equal(normal.atoms.length,sample.atomCount); valid++;
  } else { assert.equal(sample.expected,"block-calculation"); assert.ok(sample.expectedIssue); invalid++; }
}
assert.equal(valid,7); assert.equal(invalid,6);
for (const name of ["PotentialManifest","PotentialRegistry","AtomicStructure","AtomisticBudget","AtomisticPlan","AtomisticArtifact","AtomisticJob","AtomisticResult","AtomicViewerConfig","PotentialSelection"]) paths.push(`schemas/m6/${name}.json`);
paths.push("docs/m6/licenses/mace-LICENSE.txt","docs/m6/licenses/mace-foundations-LICENSE.txt","docs/m6/licenses/chgnet-LICENSE.txt",".gitattributes");
paths.push("packages/contracts/src/atomistic.ts","packages/atomistic/src/registry.ts","scripts/generate-m6-samples.py");
const entries=[];
for (const path of paths.sort()) entries.push({path,sha256:await hash(path)});
const lockPath="models/potentials/release-lock.json";
const lock={schemaVersion:registry.schemaVersion,releaseId:registry.releaseId,files:entries};
if (process.argv.includes("--freeze")) await writeFile(lockPath,`${JSON.stringify(lock,null,2)}\n`);
else assert.deepEqual(await json(lockPath),lock,"M6 frozen input changed: review changes, bump release/policy ID where required and explicitly refreeze");
assert.equal(findPotential(registry,"mattersim-v1-0-0-1m").environment.matrix.find(r=>r.device==="mps")!.status,"unsupported");
console.log(JSON.stringify({stage:"M6.0",contract:registry.schemaVersion,candidates:registry.potentials.length,coreCandidates:2,
  coreWeightBytes:coreBytes,geometryFixtures:valid,negativeFixtures:invalid,installedWeights:0,runtimeVerified:0,domainValidated:0,
  sourceIdentitiesLocked:true,offline:true,realMLIPComputation:false,scientificReferences:"pending",frozen:process.argv.includes("--freeze")},null,2));
