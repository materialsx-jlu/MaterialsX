import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile,writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotPdfFile,snapshotTextFile } from "./cloud-files.js";
test("cloud files are approved immutable UTF8 snapshots within the project",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mx-cloud-files-")),outside=await mkdtemp(join(tmpdir(),"mx-outside-"));
 try{const path=join(dir,"silicon.txt");await writeFile(path,"硅 14");const one=await snapshotTextFile(dir,path);await writeFile(path,"changed");assert.equal(one.text,"硅 14");assert.equal(one.sha256.length,64);
 await writeFile(join(outside,"private.txt"),"outside");await symlink(join(outside,"private.txt"),join(dir,"link.txt"));await assert.rejects(snapshotTextFile(dir,join(dir,"link.txt")),/项目内/);
 await writeFile(join(dir,"large.txt"),"x".repeat(32769));await assert.rejects(snapshotTextFile(dir,join(dir,"large.txt")),/32KiB/);
 await writeFile(join(dir,"binary.txt"),Buffer.from([0,255]));await assert.rejects(snapshotTextFile(dir,join(dir,"binary.txt")));
 await writeFile(join(dir,"source.pdf"),"PDF");await assert.rejects(snapshotTextFile(dir,join(dir,"source.pdf")),/文本文件/);
 }finally{await rm(dir,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
});

test("PDF approval freezes the exact bytes and rejects a modified cached snapshot",async()=>{const dir=await mkdtemp(join(tmpdir(),"mx-pdf-snapshot-"));try{const path=join(dir,"paper.pdf");await writeFile(path,"%PDF-synthetic-first");const snapshot=await snapshotPdfFile(dir,path);await writeFile(path,"%PDF-synthetic-later");assert.equal((await readFile(snapshot.path)).toString(),"%PDF-synthetic-first");await writeFile(snapshot.path,"changed");await writeFile(path,"%PDF-synthetic-first");await assert.rejects(snapshotPdfFile(dir,path),/快照/)}finally{await rm(dir,{recursive:true,force:true})}});
