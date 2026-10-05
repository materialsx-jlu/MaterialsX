import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { AtomisticRuntime } from "../packages/atomistic/src/runtime.js";
const exec=promisify(execFile);
const root=process.cwd();const temp=await mkdtemp(join(tmpdir(),"materialsx-m61-"));const project=join(temp,"project");await mkdir(project);
const runtime=new AtomisticRuntime(root,join(temp,"state"),id=>id==="fixture-project"?project:null);await runtime.restore();
const receiptDir=resolve("runtime/m6/acceptance");await mkdir(receiptDir,{recursive:true});
const receipt:{version:string;platform:string;checks:string[];runs:unknown[];modelCalls:number;paymentCalls:number}={version:"m6.1-v1",platform:`${process.platform}-${process.arch}`,checks:[],runs:[],modelCalls:0,paymentCalls:0};
async function finished(id:string){for(let i=0;i<1200;i++){const item=runtime.get({projectId:"fixture-project",runId:id});if(["completed","failed","cancelled","interrupted"].includes(item.job.status))return item;await new Promise(r=>setTimeout(r,250));}throw Error("Job timeout");}
try {
 assert(runtime.status().filter(r=>['mace-mp-0b3-medium','chgnet-0.3.0'].includes(r.potentialId)).every(r=>r.installed),"Both isolated runtimes must be installed");
 for(const name of ["si-diamond.POSCAR","nacl-rocksalt.cif","si-triclinic.extxyz","water.xyz"]){const imported=await runtime.importFile("fixture-project",join(root,"samples/atomistic",name));assert(imported.atoms.length>0);}
 receipt.checks.push("four real formats imported");
 const structure=await runtime.importFile("fixture-project",join(root,"samples/atomistic/si-diamond.POSCAR"));
 assert.throws(()=>runtime.inspect({projectId:"another-project",structureId:structure.id}),/UNKNOWN_PROJECT/);
 await assert.rejects(runtime.start({projectId:"fixture-project",structureId:structure.id,potentialId:"chgnet-0.3.0",path:"arbitrary"}));
 const water=await runtime.importFile("fixture-project",join(root,"samples/atomistic/water.xyz"));
 await assert.rejects(runtime.start({projectId:"fixture-project",structureId:water.id,potentialId:"chgnet-0.3.0"}),/BULK_PBC/);
 const disordered=await runtime.importFile("fixture-project",join(root,"samples/atomistic/partial-occupancy.cif"));
 await assert.rejects(runtime.start({projectId:"fixture-project",structureId:disordered.id,potentialId:"chgnet-0.3.0"}),/BLOCKING_ISSUES/);
 receipt.checks.push("ownership, strict input, molecule and partial occupancy gates");
 for(const potentialId of ["chgnet-0.3.0","mace-mp-0b3-medium"] as const){
  const item=await runtime.start({projectId:"fixture-project",structureId:structure.id,potentialId});const result=await finished(item.job.id);
  assert.equal(result.job.status,"completed",result.job.error??"No actual result");assert.equal(result.result?.quality,"needs_review");assert.equal(result.result?.atomCount,8);
  assert.equal(result.artifacts.length,4);assert.equal(result.result?.stress?.order,"xx,yy,zz,yz,xz,xy");
  receipt.runs.push({potentialId,result:result.result,artifacts:result.artifacts.map(({relativePath,...artifact})=>({...artifact,file:relativePath.split("/").at(-1)}))});
  const family=potentialId.startsWith("mace")?"mace":"chgnet";const profile=JSON.parse(await readFile(join(root,`runtime/atomistic/${runtime.platform}/${family}/RUNTIME.json`),"utf8")) as {python:string;portable:boolean};
  const base=join(root,`runtime/atomistic/${runtime.platform}/${family}`);const python=profile.portable?join(base,profile.python):profile.python;
  await exec(python,[join(root,"atomistic/probe.py"),root,potentialId,join(base,"checkpoint.bin"),join(receiptDir,`${family}-numerical.json`)],{timeout:600_000,maxBuffer:1024*1024,env:{...process.env,OMP_NUM_THREADS:"4",OPENBLAS_NUM_THREADS:"4"}});
  const probe=JSON.parse(await readFile(join(receiptDir,`${family}-numerical.json`),"utf8")) as {numericalPassed:boolean};assert(probe.numericalPassed);
 }
 receipt.checks.push("both core checkpoints: actual single point, disk artifacts, canonical units, three perturbed numerical probes each");
 const first=await runtime.start({projectId:"fixture-project",structureId:structure.id,potentialId:"mace-mp-0b3-medium"});
 const queued=await runtime.start({projectId:"fixture-project",structureId:structure.id,potentialId:"chgnet-0.3.0"});
 assert.equal(runtime.cancel({projectId:"fixture-project",runId:queued.job.id}),true);
 assert.equal((await finished(queued.job.id)).job.status,"cancelled");
 await new Promise(r=>setTimeout(r,500));runtime.cancel({projectId:"fixture-project",runId:first.job.id});
 const cancelled=await finished(first.job.id);assert.equal(cancelled.job.status,"cancelled");assert.equal(cancelled.result,null);assert.equal(cancelled.artifacts.length,0);
 receipt.checks.push("one heavy job at a time; queued cancellation and running child cancellation have no successful artifacts");
 await assert.rejects(runtime.start({projectId:"fixture-project",structureId:structure.id,potentialId:"mace-mp-0b3-medium",budget:{maxAtoms:256,maxSteps:1,maxWallSeconds:60,maxMemoryMiB:256,maxOutputMiB:64,threads:4}}),/MEMORY_PREFLIGHT_FAILED/);
 const wallLimited=await runtime.start({projectId:"fixture-project",structureId:structure.id,potentialId:"mace-mp-0b3-medium",budget:{maxAtoms:256,maxSteps:1,maxWallSeconds:1,maxMemoryMiB:4096,maxOutputMiB:64,threads:4}});
 const wall=await finished(wallLimited.job.id);assert.equal(wall.job.status,"failed");assert.equal(wall.job.error,"WALL_TIME_LIMIT");assert.equal(wall.result,null);
 receipt.checks.push("M6.4 preflight rejects insufficient memory before creating a job; worker wall-time budget produces no successful artifacts");
 const restored=new AtomisticRuntime(root,join(temp,"state"),id=>id==="fixture-project"?project:null);await restored.restore();assert.equal(restored.list("fixture-project").length,5);restored.dispose();
 receipt.checks.push("persisted terminal jobs survive restart");
 const completed=runtime.list("fixture-project").find(item=>item.job.status==="completed")!;await rm(join(completed.outputDirectory,"result.json"));
 const damaged=new AtomisticRuntime(root,join(temp,"state"),id=>id==="fixture-project"?project:null);await damaged.restore();
 const invalid=damaged.get({projectId:"fixture-project",runId:completed.job.id});assert.equal(invalid.job.status,"failed");assert.equal(invalid.result,null);assert.equal(invalid.job.error,"STORED_ARTIFACTS_MISSING_OR_CHANGED");damaged.dispose();
 receipt.checks.push("missing persisted output invalidates a previously completed job instead of claiming success");
 await writeFile(join(receiptDir,"desktop-runtime.json"),JSON.stringify(receipt,null,2)+"\n");console.log(JSON.stringify({passed:true,checks:receipt.checks,receipt:join(receiptDir,"desktop-runtime.json")}));
} finally {runtime.dispose();await rm(temp,{recursive:true,force:true});}
