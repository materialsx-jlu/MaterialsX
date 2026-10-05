import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { atomicStructureSchema, atomisticPlanSchema, atomisticArtifactSchema, atomisticResultSchema, atomisticJobSchema, atomicViewerConfigSchema, potentialManifestSchema, potentialSelectionSchema } from "../../contracts/src/atomistic.js";
import { findPotential, parsePotentialRegistry, potentialReadiness } from "./registry.js";
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"));

test("16 fixed candidates: two hashed core identities, all absent, and no fabricated platform/domain pass", async () => {
  const r = parsePotentialRegistry(await readJson("models/potentials/registry.json"));
  assert.equal(r.potentials.length, 16);
  assert.equal(r.potentials.filter(p => p.role === "core-candidate").length, 2);
  assert.equal(new Set(r.potentials.map(p => p.family)).size, 7);
  for (const p of r.potentials) {
    assert.equal(p.state, "catalogued"); assert.equal(p.installation, "absent");
    assert.equal(potentialReadiness(p).readyForTaskChecks, false);
    assert.ok(potentialReadiness(p).blockers.includes("RUNTIME_NOT_VERIFIED"));
    assert.ok(potentialReadiness(p).blockers.includes("DOMAIN_NOT_VALIDATED"));
    assert.ok(p.environment.matrix.every(m => m.status !== "verified"));
  }
  assert.equal(findPotential(r, "mace-mp-0b3-medium").weights.bytes, 79472952);
  assert.equal(findPotential(r, "chgnet-0.3.0").weights.bytes, 4863221);
  assert.throws(() => findPotential(r, "llm-invented-potential"), /UNKNOWN_POTENTIAL/);
  assert.ok(findPotential(r, "mattersim-v1-0-0-1m").environment.matrix.some(m => m.device === "mps" && m.status === "unsupported"));
});

test("registry cannot silently promote missing/unknown weights, licenses or fake platform evidence", async () => {
  const r = parsePotentialRegistry(await readJson("models/potentials/registry.json")); const p = r.potentials[0]!;
  assert.equal(potentialManifestSchema.safeParse({...p, state: "runtime_verified"}).success, false);
  assert.equal(potentialManifestSchema.safeParse({...p, weights:{...p.weights, sha256:null}}).success, false);
  assert.equal(potentialManifestSchema.safeParse({...p, installation:"bundled", state:"installed", licenses:{...p.licenses, redistribution:"unknown"}}).success, false);
  assert.equal(potentialManifestSchema.safeParse({...p, environment:{...p.environment,matrix:[{platform:"macos-arm64",device:"cpu",status:"verified",evidenceId:null}]}}).success, false);
  assert.equal(potentialManifestSchema.safeParse({...p, declared:{...p.declared,evidenceIds:["invented-source"]}}).success, false);
  assert.equal(potentialManifestSchema.safeParse({...p, arbitraryPython:"import os"}).success, false);
  assert.throws(() => parsePotentialRegistry({...r, potentials:[...r.potentials,r.potentials[0]]}), /duplicate checkpoint/);
});

test("normalized real fixture contracts reject unknown elements, NaN, duplicate atoms, missing PBC and singular periodic cells", async () => {
  const a = atomicStructureSchema.parse(await readJson("samples/atomistic/si-triclinic.structure.json"));
  assert.equal(a.atoms.length,2); assert.notEqual(a.cell![1][0],0);
  assert.equal(atomicStructureSchema.safeParse({...a,pbc:null}).success,false);
  assert.equal(atomicStructureSchema.safeParse({...a,cell:null}).success,false);
  assert.equal(atomicStructureSchema.safeParse({...a,cell:[[1e308,0,0],[0,1e308,0],[0,0,1e308]]}).success,false);
  assert.equal(atomicStructureSchema.safeParse({...a,cell:[[1,0,0],[2,0,0],[0,0,1]]}).success,false);
  assert.equal(atomicStructureSchema.safeParse({...a,atoms:[a.atoms[0],a.atoms[0]]}).success,false);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(atomicStructureSchema.safeParse({...a,atoms:[{...a.atoms[0],position:[value,0,0]}]}).success,false);
  assert.equal(atomicStructureSchema.safeParse({...a,atoms:[{...a.atoms[0],element:"Xx"}]}).success,false);
  const molecule = atomicStructureSchema.parse(await readJson("samples/atomistic/water.structure.json"));
  assert.equal(molecule.cell,null); assert.deepEqual(molecule.pbc,[false,false,false]);
});

const sha = "a".repeat(64);
const plan = {schemaVersion:"m6.0-v1",id:"plan1",projectId:"project1",structureId:"sample1",structureSha256:sha,potentialId:"chgnet-0.3.0",potentialSha256:sha,
  environmentProfileId:"chgnet-0.3.0-cpu-v1",device:"cpu",dtype:"float32",head:null,task:{kind:"singlepoint"},
  budget:{maxAtoms:256,maxSteps:200,maxWallSeconds:600,maxMemoryMiB:4096,maxOutputMiB:64,threads:4},qualityPolicyId:"m6-inorganic-screening-v1",selectionEvidenceIds:["source1"]};
test("plans accept bounded tasks and reject arbitrary code, oversized arrays/steps and implicit cell pressure", () => {
  assert.ok(atomisticPlanSchema.safeParse(plan).success);
  assert.equal(atomisticPlanSchema.safeParse({...plan,python:"os.system()"}).success,false);
  assert.equal(atomisticPlanSchema.safeParse({...plan,budget:{...plan.budget,maxAtoms:2001}}).success,false);
  const relax = {...plan,task:{kind:"relaxation",optimizer:"FIRE",cellMode:"fixed",maxSteps:200,fmaxEvPerAngstrom:.05,externalPressureGPa:null}};
  assert.ok(atomisticPlanSchema.safeParse(relax).success);
  assert.equal(atomisticPlanSchema.safeParse({...relax,task:{...relax.task,maxSteps:201}}).success,false);
  assert.equal(atomisticPlanSchema.safeParse({...relax,task:{...relax.task,externalPressureGPa:0}}).success,false);
  assert.equal(atomisticPlanSchema.safeParse({...relax,task:{...relax.task,cellMode:"variable"}}).success,false);
  const md={...plan,task:{kind:"md",ensemble:"nve",steps:100,timestepFs:.5,temperatureK:300,sampleEvery:10,seed:123}};
  assert.ok(atomisticPlanSchema.safeParse(md).success);
  assert.equal(atomisticPlanSchema.safeParse({...md,task:{...md.task,timestepFs:10}}).success,false);
  assert.equal(atomisticPlanSchema.safeParse({...md,task:{...md.task,sampleEvery:101}}).success,false);
});

test("artifacts and viewers cannot carry executable/foreign paths, URLs or oversized frames", () => {
  const a={schemaVersion:"m6.0-v1",id:"artifact1",projectId:"p1",runId:"r1",type:"atomic_structure",relativePath:"input/structure.extxyz",sha256:sha,bytes:64,structureId:"s1",frames:null,partial:false};
  assert.ok(atomisticArtifactSchema.safeParse(a).success);
  for (const path of ["../secret","/etc/passwd","C:\\Windows\\file","input/../../secret","file:///data","https://host/file","a//b","a\0b"]) assert.equal(atomisticArtifactSchema.safeParse({...a,relativePath:path}).success,false,path);
  const v={artifactId:"a1",style:"ball-stick",showCell:true,showInferredBonds:false,supercell:[1,1,1],frame:0,colorBy:"element"};
  assert.ok(atomicViewerConfigSchema.safeParse(v).success);
  assert.equal(atomicViewerConfigSchema.safeParse({...v,script:"alert(1)"}).success,false);
  assert.equal(atomicViewerConfigSchema.safeParse({...v,supercell:[100,1,1]}).success,false);
});

test("completed jobs require artifacts; forces require N by 3; passing science requires evidence", () => {
  const j={schemaVersion:"m6.0-v1",id:"j1",projectId:"p1",planId:"plan1",status:"completed",quality:"needs_review",createdAt:"2026-10-01T00:00:00Z",finishedAt:"2026-10-01T00:01:00Z",resultArtifactId:"a1",error:null};
  assert.ok(atomisticJobSchema.safeParse(j).success);
  assert.equal(atomisticJobSchema.safeParse({...j,resultArtifactId:null}).success,false);
  assert.equal(atomisticJobSchema.safeParse({...j,status:"running",quality:"passed"}).success,false);
  assert.equal(atomisticJobSchema.safeParse({...j,finishedAt:null}).success,false);
  assert.equal(atomisticJobSchema.safeParse({...j,status:"failed",error:null}).success,false);
  const r={schemaVersion:"m6.0-v1",runId:"j1",planId:"plan1",structureId:"s1",potentialId:"chgnet-0.3.0",potentialSha256:sha,atomCount:1,energyEv:-1,forcesEvPerAngstrom:[[0,0,0]],stress:null,stopReason:"singlepoint",completedSteps:0,quality:"needs_review",validationEvidenceIds:[]};
  assert.ok(atomisticResultSchema.safeParse(r).success);
  assert.equal(atomisticResultSchema.safeParse({...r,atomCount:2}).success,false);
  assert.equal(atomisticResultSchema.safeParse({...r,energyEv:Infinity}).success,false);
  assert.equal(atomisticResultSchema.safeParse({...r,quality:"passed"}).success,false);
  assert.equal(atomisticResultSchema.safeParse({...r,stopReason:"max_steps",quality:"passed",validationEvidenceIds:["evidence1"]}).success,false);
});

test("LLM selection must reference a candidate and cannot inject an untyped command", () => {
  const s={schemaVersion:"m6.0-v1",structureId:"s1",selectedPotentialId:"m1",head:null,candidates:[{potentialId:"m1",evidenceIds:["e1"],reason:{zh:"待验证",en:"Pending validation"}}],exclusions:[],limitations:[{zh:"不代表准确",en:"Not a claim of accuracy"}],validationPlan:"singlepoint probe"};
  assert.ok(potentialSelectionSchema.safeParse(s).success);
  assert.equal(potentialSelectionSchema.safeParse({...s,selectedPotentialId:"invented"}).success,false);
  assert.equal(potentialSelectionSchema.safeParse({...s,bash:"curl ..."}).success,false);
});
