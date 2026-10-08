import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile,writeFile, symlink, rm } from "node:fs/promises";
import {existsSync} from 'node:fs';
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotPdfFile,snapshotAttachmentFile,selectedFileMetadata } from "./cloud-files.js";
import {resolveManagedPython} from '../../../packages/pi-adapter/src/local-session-tools.js';
test("research attachments are immutable UTF-8 snapshots with explicit type and size checks",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mx-cloud-files-")),outside=await mkdtemp(join(tmpdir(),"mx-outside-"));
 try{const path=join(dir,"silicon.txt");await writeFile(path,"硅 14");const one=await snapshotAttachmentFile(dir,path,process.cwd());await writeFile(path,"changed");assert.equal(one.text,"硅 14");assert.equal(one.sha256.length,64);
 await writeFile(join(outside,"public.txt"),"outside");assert.equal((await snapshotAttachmentFile(dir,join(outside,"public.txt"),process.cwd())).text,'outside');
 await symlink(join(outside,"public.txt"),join(dir,"link.txt"));await assert.rejects(snapshotAttachmentFile(dir,join(dir,"link.txt"),process.cwd()));
 await writeFile(join(dir,"large.txt"),"x".repeat(8*1024*1024+1));await assert.rejects(snapshotAttachmentFile(dir,join(dir,"large.txt"),process.cwd()),/8 MiB/);
 await writeFile(join(dir,"binary.txt"),Buffer.from([0,255]));await assert.rejects(snapshotAttachmentFile(dir,join(dir,"binary.txt"),process.cwd()));
 await writeFile(join(dir,"source.bad"),"PDF");await assert.rejects(snapshotAttachmentFile(dir,join(dir,"source.bad"),process.cwd()),/不支持/);
 }finally{await rm(dir,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
});

test("PDF approval freezes the exact bytes and rejects a modified cached snapshot",async()=>{const dir=await mkdtemp(join(tmpdir(),"mx-pdf-snapshot-"));try{const path=join(dir,"paper.pdf");await writeFile(path,"%PDF-synthetic-first");const snapshot=await snapshotPdfFile(dir,path);await writeFile(path,"%PDF-synthetic-later");assert.equal((await readFile(snapshot.path)).toString(),"%PDF-synthetic-first");await writeFile(snapshot.path,"changed");await writeFile(path,"%PDF-synthetic-first");await assert.rejects(snapshotPdfFile(dir,path),/快照/)}finally{await rm(dir,{recursive:true,force:true})}});
test('the unified attachment picker rejects credential paths and credential symlink targets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mx-secret-attachment-'));
 try{for(const name of ['credentials.json','auth.json','server.env','key.pem']){await writeFile(join(dir,name),'synthetic secret');await assert.rejects(snapshotAttachmentFile(dir,join(dir,name),process.cwd()));}
 await symlink(join(dir,'credentials.json'),join(dir,'apparently-public.json'));await assert.rejects(snapshotAttachmentFile(dir,join(dir,'apparently-public.json'),process.cwd()),/凭据/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('the unified picker freezes outside-project text, preserves source hash and exposes long files by line',async()=>{
 const project=await mkdtemp(join(tmpdir(),'mx-attachment-project-')),source=await mkdtemp(join(tmpdir(),'mx-attachment-source-'));
 try{
  const path=join(source,'research.json');await writeFile(path,'{"sample":"A","temperature":120}');
  const asset=await snapshotAttachmentFile(project,path,process.cwd());
  assert.equal(asset.format,'json');assert.match(asset.text,/"temperature": 120/);
  assert.equal(selectedFileMetadata(asset).bytes,32);
  await writeFile(path,'{"changed":true}');assert.match(asset.text,/"sample": "A"/);
  const secret=join(source,'credentials.json');await writeFile(secret,'{}');await assert.rejects(snapshotAttachmentFile(project,secret,process.cwd()),/凭据/);
 }finally{await rm(project,{recursive:true,force:true});await rm(source,{recursive:true,force:true})}
});

test('the unified PDF attachment becomes page-addressable text without uploading raw PDF',{
 skip:!existsSync(resolveManagedPython(process.cwd()))
},async()=>{
 const project=await mkdtemp(join(tmpdir(),'mx-attachment-pdf-'));
 try{const source=join(process.cwd(),'tests/fixtures/agent/ua6-paper.pdf');const asset=await snapshotAttachmentFile(project,source,process.cwd());
  assert.equal(asset.format,'pdf');assert.ok((asset.pageCount??0)>=1);assert.match(asset.text,/\[PDF 第 1 页/);
  assert.equal(selectedFileMetadata(asset).pageCount,asset.pageCount);
  assert.equal(asset.sha256.length,64);
 }finally{await rm(project,{recursive:true,force:true})}
});
