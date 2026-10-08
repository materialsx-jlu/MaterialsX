import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AtomisticRuntime, ownedDirectory } from "./runtime.js";
import { startAtomisticSchema } from "../../contracts/src/atomistic-runtime.js";
import { runBoundedChild } from "./process.js";
test("single point IPC rejects code, arbitrary paths, unregistered weights and oversized resources",()=>{
 const input={projectId:"project",structureId:"structure",potentialId:"chgnet-0.3.0"};assert(startAtomisticSchema.safeParse(input).success);
 for(const extra of [{code:"import os"},{path:"/tmp/source"},{potentialId:"unknown"},{budget:{maxAtoms:99999}}])assert(!startAtomisticSchema.safeParse({...input,...extra}).success);
});
test("local jobs recover as interrupted, never as successful science",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"mx-recovery-"));
 try{
  const source=JSON.parse(await readFile(resolve("samples/atomistic/si-diamond.structure.json"),"utf8"));
  const sample={job:{schemaVersion:"m6.0-v1",id:"fixture-job",projectId:"project",planId:"fixture-job",status:"running",quality:"unreviewed",createdAt:"2026-10-01T00:00:00Z",finishedAt:null,resultArtifactId:null,error:null},
   plan:{schemaVersion:"m6.0-v1",id:"fixture-job",projectId:"project",structureId:source.id,structureSha256:"a".repeat(64),potentialId:"chgnet-0.3.0",potentialSha256:"b".repeat(64),environmentProfileId:"chgnet-0.3.0-cpu-v1",device:"cpu",dtype:"float32",head:null,task:{kind:"singlepoint"},budget:{maxAtoms:256,maxSteps:1,maxWallSeconds:600,maxMemoryMiB:4096,maxOutputMiB:64,threads:4},qualityPolicyId:"m6-inorganic-screening-v1",selectionEvidenceIds:["explicit-user-choice"]},structure:source,result:null,artifacts:[],outputDirectory:directory};
  await mkdir(join(directory,"atomistic/jobs"),{recursive:true});await writeFile(join(directory,"atomistic/jobs/12345678-abcd.json"),JSON.stringify(sample));
  const runtime=new AtomisticRuntime(process.cwd(),directory,id=>id==="project"?directory:null);await runtime.restore();
  const job=runtime.get({projectId:"project",runId:"fixture-job"});assert.equal(job.job.status,"interrupted");assert.equal(job.result,null);assert(job.job.finishedAt);
  assert.throws(()=>runtime.get({projectId:"other",runId:"fixture-job"}),/UNKNOWN_PROJECT/);runtime.dispose();
 }finally{await rm(directory,{recursive:true,force:true});}
});
test("symlinked output directories cannot redirect calculation writes",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"mx-output-"));
 try{const project=join(directory,"project");const outside=join(directory,"outside");await mkdir(project);await mkdir(outside);
  await symlink(outside,join(project,"materials-output"),process.platform==="win32"?"junction":"dir");
  await assert.rejects(ownedDirectory(project,"run"),/UNSAFE_OUTPUT_DIRECTORY/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test("cancellation rejects before spawning an executable",async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(runBoundedChild("nonexistent","ignored",{}, {cwd:process.cwd(),seconds:1,signal:controller.signal}),/CANCELLED/);
});
