import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { atomicStructureSchema } from "../../contracts/src/atomistic.js";
import { atomicViewRequestSchema, atomicViewPayloadSchema, atomicSceneSchema, atomicPngExportSchema } from "../../contracts/src/atomic-viewer.js";
import { displayAtoms,cellEdges,distance,angle,inferredBonds } from "./viewer-geometry.js";
import { readOwnedBytes } from "./artifact-io.js";
import { AtomisticRuntime } from "./runtime.js";
const hash=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
const sample=async(name:string)=>atomicStructureSchema.parse(JSON.parse(await readFile(resolve(`samples/atomistic/${name}.structure.json`),"utf8")));

test("triclinic display replicas use lattice vectors and preserve input and force mapping",async()=>{
 const input=await sample("si-triclinic"),before=JSON.stringify(input);
 const atoms=displayAtoms(input,[2,1,1],[[1,2,2],[0,0,0]]);assert.equal(atoms.length,4);
 assert.deepEqual(atoms[2]!.position,input.atoms[0]!.position.map((v,i)=>v+input.cell![0][i]!));
 assert.equal(atoms[2]!.forceMagnitude,3);assert.equal(atoms[2]!.sourceIndex,0);assert.equal(JSON.stringify(input),before);
 const edges=cellEdges(input.cell,[1,1,1]);assert.equal(edges.length,12);
 assert(edges.some(([a,b])=>JSON.stringify(a)==="[0,0,0]"&&JSON.stringify(b)==="[1,4,0]"));
 const doubled=cellEdges(input.cell,[2,1,1]);assert(doubled.some(([,b])=>b[0]===8&&b[1]===0&&b[2]===0));
});
test("display distances and angles are Cartesian Å/degrees with explicit degeneracy",async()=>{
 assert.equal(distance([0,0,0],[3,4,0]),5);assert.equal(angle([1,0,0],[0,0,0],[0,1,0]),90);assert.equal(angle([0,0,0],[0,0,0],[1,0,0]),null);
 const water=await sample("water"),atoms=displayAtoms(water,[1,1,1]);assert.equal(atoms.length,3);
 const h1=water.atoms[1]!.position,o=water.atoms[0]!.position,h2=water.atoms[2]!.position;
 assert(Math.abs(angle(h1,o,h2)!-104.5)<1);assert.equal(inferredBonds(atoms).pairs.length,2);
 assert.throws(()=>displayAtoms(water,[2,1,1]),/NONPERIODIC_AXIS/);
 const slab=await sample("cu-slab");assert.equal(displayAtoms(slab,[2,2,1]).length,16);assert.throws(()=>displayAtoms(slab,[1,1,2]),/NONPERIODIC_AXIS/);
});
test("viewer budgets reject oversized replicas, extreme finite coordinates and dense adjacency",async()=>{
 const structure=await sample("si-triclinic");structure.atoms=Array.from({length:2000},(_,i)=>({...structure.atoms[0]!,id:`atom-${i}`}));
 assert.throws(()=>displayAtoms(structure,[3,1,1]),/DISPLAY_ATOM_LIMIT/);
 structure.atoms=structure.atoms.slice(0,1);structure.atoms[0]!.position=[1e100,0,0];assert.throws(()=>displayAtoms(structure,[1,1,1]),/COORDINATE_LIMIT/);
 assert.throws(()=>cellEdges([[1e100,0,0],[0,0,0],[0,0,0]],[1,1,1]),/DISPLAY_CELL_LIMIT/);
 const crowded=Array.from({length:100},(_,i)=>({sourceIndex:i,id:`a${i}`,element:"C",position:[i*.02,0,0] as [number,number,number],replica:[0,0,0] as [number,number,number],occupancy:1,forceMagnitude:null}));
 const bonds=inferredBonds(crowded);assert(bonds.limited);assert.deepEqual(bonds.pairs,[]);
 assert.deepEqual(inferredBonds([{...crowded[0]!,element:"Og"}]).unsupported,["Og"]);
});
test("completed artifact view is project scoped and rejects files modified after restoration",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mx-view-job-")),runId=randomUUID();
 try{const project=join(dir,"project");await mkdir(project);
  const output=join(project,"materials-output/atomistic",runId);await mkdir(output,{recursive:true});
  const structure=await sample("si-triclinic"),structureText=JSON.stringify(structure),potentialSha256="b".repeat(64);
  const result={schemaVersion:"m6.0-v1",runId,planId:runId,structureId:structure.id,potentialId:"chgnet-0.3.0",potentialSha256,atomCount:2,energyEv:0,forcesEvPerAngstrom:[[1,0,0],[-1,0,0]],stress:null,stopReason:"singlepoint",completedSteps:0,quality:"needs_review",validationEvidenceIds:[]};
  const artifacts=[];
  for(const [name,type,text] of [["structure.json","atomic_structure",structureText],["result.json","atomistic_result",JSON.stringify(result)],["validation.json","validation_report","{}"]]){
   await writeFile(join(output,name!),text!);artifacts.push({schemaVersion:"m6.0-v1",id:randomUUID(),projectId:"project",runId,type,relativePath:`materials-output/atomistic/${runId}/${name}`,sha256:hash(text!),bytes:Buffer.byteLength(text!),structureId:structure.id,frames:null,partial:false});}
  const record={job:{schemaVersion:"m6.0-v1",id:runId,projectId:"project",planId:runId,status:"completed",quality:"needs_review",createdAt:"2026-10-02T00:00:00Z",finishedAt:"2026-10-02T00:00:01Z",resultArtifactId:artifacts[1]!.id,error:null},
   plan:{schemaVersion:"m6.0-v1",id:runId,projectId:"project",structureId:structure.id,structureSha256:hash(structureText),potentialId:"chgnet-0.3.0",potentialSha256,environmentProfileId:"chgnet-0.3.0-cpu-v1",device:"cpu",dtype:"float32",head:null,task:{kind:"singlepoint"},budget:{maxAtoms:256,maxSteps:1,maxWallSeconds:600,maxMemoryMiB:4096,maxOutputMiB:64,threads:4},qualityPolicyId:"m6-inorganic-screening-v1",selectionEvidenceIds:["explicit-user-choice"]},
   structure,result,artifacts,outputDirectory:await import("node:fs/promises").then(fs=>fs.realpath(output))};
  await mkdir(join(dir,"atomistic/jobs"),{recursive:true});await writeFile(join(dir,"atomistic/jobs",`${runId}.json`),JSON.stringify(record));
  // Synthetic persistence fixture only, never presented as an actual scientific run.
  const runtime=new AtomisticRuntime(process.cwd(),dir,id=>["project","other"].includes(id)?project:null);await runtime.restore();
  const request={kind:"artifact",projectId:"project",runId,artifactId:artifacts[0]!.id};
  const view=await runtime.view(request);assert.equal(view.forcesEvPerAngstrom![0]![0],1);assert.equal(view.quality,"needs_review");
  await assert.rejects(runtime.view({...request,projectId:"other"}),/JOB_NOT_OWNED/);
  await assert.rejects(runtime.view({...request,artifactId:artifacts[1]!.id}),/STRUCTURE_ARTIFACT_NOT_AVAILABLE/);
  await writeFile(join(output,"result.json"),JSON.stringify({...result,energyEv:100}));await assert.rejects(runtime.view(request),/ARTIFACT_CHANGED/);runtime.dispose();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("static viewer contracts reject scripts, URLs, HTML, frames, and mismatched forces",async()=>{
 const structure=await sample("water"),request={kind:"import",projectId:"project",structureId:structure.id};
 const payload={version:"m6.2-v1",request,structure,forcesEvPerAngstrom:null,quality:"unreviewed"};assert(atomicViewPayloadSchema.safeParse(payload).success);
 for(const extra of [{path:"../../secrets"},{url:"https://example.com/structure"},{html:"<script>alert(1)</script>"},{script:"alert(1)"}])assert(!atomicViewRequestSchema.safeParse({...request,...extra}).success);
 assert(!atomicViewPayloadSchema.safeParse({...payload,forcesEvPerAngstrom:[[0,0,0]]}).success);
 assert(!atomicViewPayloadSchema.safeParse({...payload,request:{...request,structureId:"other"}}).success);
 const config={artifactId:structure.source.artifactId,style:"ball-stick",showCell:true,showInferredBonds:true,supercell:[1,1,1],frame:0,colorBy:"element"};
 assert(atomicSceneSchema.safeParse({type:"scene",payload,config,theme:"codex-light"}).success);
 assert(!atomicSceneSchema.safeParse({type:"scene",payload,config:{...config,frame:1},theme:"codex-light"}).success);
 assert(!atomicSceneSchema.safeParse({type:"scene",payload,config:{...config,colorfunc:"alert(1)"},theme:"codex-light"}).success);
 assert(!atomicPngExportSchema.safeParse({request,png:"data:text/html;base64,YQ=="}).success);
});
test("owned file reader enforces hash, file size, traversal and intermediate/final symlinks",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mx-view-io-"));
 try{const root=join(dir,"root"),outside=join(dir,"outside");await mkdir(root);await mkdir(outside);await writeFile(join(root,"a.json"),"{}\n");await writeFile(join(outside,"a.json"),"{}\n");
  assert.equal((await readOwnedBytes(root,join(root,"a.json"),hash("{}\n"))).toString(),"{}\n");
  await assert.rejects(readOwnedBytes(root,join(root,"a.json"),hash("changed")),/ARTIFACT_CHANGED/);
  await assert.rejects(readOwnedBytes(root,join(root,"a.json"),hash("{}\n"),1),/SIZE_LIMIT/);
  await assert.rejects(readOwnedBytes(root,join(outside,"a.json"),hash("{}\n")),/OUTSIDE_SCOPE/);
  await symlink(outside,join(root,"redirect"),process.platform==="win32"?"junction":"dir");await assert.rejects(readOwnedBytes(root,join(root,"redirect/a.json"),hash("{}\n")),/SYMLINK/);
  if(process.platform!=="win32"){await symlink(join(outside,"a.json"),join(root,"link.json"));await assert.rejects(readOwnedBytes(root,join(root,"link.json"),hash("{}\n")),/SYMLINK/);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("runtime import viewer verifies source bytes on every request and cannot cross projects",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mx-view-runtime-"));const id=randomUUID();
 try{const structure=await sample("water");structure.id=id;structure.source.artifactId=id;
  const bytes=await readFile(resolve("samples/atomistic/water.xyz"));structure.source.sha256=hash(bytes);
  await mkdir(join(dir,"atomistic/imports"),{recursive:true});await mkdir(join(dir,"atomistic/sources",id),{recursive:true});
  await writeFile(join(dir,"atomistic/imports",`${id}.json`),JSON.stringify({projectId:"project",structure}));await writeFile(join(dir,"atomistic/sources",id,"source.xyz"),bytes);
  const runtime=new AtomisticRuntime(process.cwd(),dir,project=>["project","another"].includes(project)?dir:null);await runtime.restore();
  const request={kind:"import",projectId:"project",structureId:id};const view=await runtime.view(request);assert.equal(view.structure.atoms.length,3);assert.equal(view.forcesEvPerAngstrom,null);
  assert.equal(hash((await runtime.originalStructure(request)).bytes),hash(bytes));
  await assert.rejects(runtime.view({...request,projectId:"another"}),/STRUCTURE_NOT_OWNED/);
  await writeFile(join(dir,"atomistic/sources",id,"source.xyz"),"changed");await assert.rejects(runtime.view(request),/ARTIFACT_CHANGED/);runtime.dispose();
 }finally{await rm(dir,{recursive:true,force:true});}
});
