import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, sep, join, isAbsolute } from "node:path";

/** Main-process only. Verify every component and hash the exact bytes returned. */
export async function readOwnedBytes(root:string,path:string,sha256:string|null,limit=4*1024*1024,allowEmpty=false):Promise<Buffer> {
  const base=await realpath(root),outside=(p:string)=>!p||isAbsolute(p)||p.startsWith(`..${sep}`)||p==="..";
  // macOS /var -> /private/var: accept either spelling of the trusted root.
  let rel=relative(resolve(root),resolve(path));if(outside(rel))rel=relative(base,resolve(path));
  if(outside(rel))throw Error("ARTIFACT_OUTSIDE_SCOPE");
  const target=join(base,rel);
  let cursor=base;
  for(const part of rel.split(sep)){cursor=join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw Error("ARTIFACT_SYMLINK");}
  if(await realpath(target)!==target)throw Error("ARTIFACT_SYMLINK");
  const file=await open(target,constants.O_RDONLY | (process.platform==="win32"?0:constants.O_NOFOLLOW));
  try {
    const info=await file.stat();if(!info.isFile()||(!allowEmpty&&info.size===0)||info.size>limit)throw Error("ARTIFACT_SIZE_LIMIT");
    // Bounded even if another local process grows the file after stat.
    const data=Buffer.alloc(info.size+1);let size=0;
    while(size<data.length){const read=await file.read(data,size,data.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}
    if(size!==info.size)throw Error("ARTIFACT_CHANGED");
    const bytes=data.subarray(0,size);
    if(sha256!==null&&createHash("sha256").update(bytes).digest("hex")!==sha256)throw Error("ARTIFACT_CHANGED");
    return bytes;
  }finally{await file.close();}
}

/** Stream hash and ranged reads without loading a trajectory into application memory. */
async function ownedFile(root:string,path:string,limit:number){
 const base=await realpath(root);let rel=relative(resolve(root),resolve(path));
 const outside=(p:string)=>!p||isAbsolute(p)||p==='..'||p.startsWith(`..${sep}`);
 if(outside(rel))rel=relative(base,resolve(path));if(outside(rel))throw Error('ARTIFACT_OUTSIDE_SCOPE');
 let cursor=base;for(const part of rel.split(sep)){cursor=join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw Error('ARTIFACT_SYMLINK');}
 if(await realpath(cursor)!==cursor)throw Error('ARTIFACT_SYMLINK');
 const file=await open(cursor,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
 try{const info=await file.stat();if(!info.isFile()||!info.size||info.size>limit)throw Error('ARTIFACT_SIZE_LIMIT');return {file,info};}catch(e){await file.close();throw e;}
}
export async function hashOwnedFile(root:string,path:string,expected:string|null,limit:number){
 const {file,info}=await ownedFile(root,path,limit);try{const hash=createHash('sha256');const chunk=Buffer.alloc(128*1024);let offset=0;
 while(offset<info.size){const r=await file.read(chunk,0,Math.min(chunk.length,info.size-offset),offset);if(!r.bytesRead)throw Error('ARTIFACT_CHANGED');hash.update(chunk.subarray(0,r.bytesRead));offset+=r.bytesRead;}
 const after=await file.stat();if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw Error('ARTIFACT_CHANGED');const sha256=hash.digest('hex');if(expected&&sha256!==expected)throw Error('ARTIFACT_CHANGED');return {sha256,bytes:info.size};
 }finally{await file.close();}
}
export async function readOwnedRange(root:string,path:string,range:{offset:number;bytes:number;sha256:string},limit=256*1024*1024){
 if(!Number.isSafeInteger(range.offset)||range.offset<0||!Number.isSafeInteger(range.bytes)||range.bytes<1||range.bytes>2*1024*1024)throw Error('FRAME_RANGE_LIMIT');
 const {file,info}=await ownedFile(root,path,limit);try{if(range.offset+range.bytes>info.size)throw Error('FRAME_RANGE_MISSING');const data=Buffer.alloc(range.bytes);let n=0;
 while(n<data.length){const r=await file.read(data,n,data.length-n,range.offset+n);if(!r.bytesRead)throw Error('FRAME_RANGE_MISSING');n+=r.bytesRead;}
 if(createHash('sha256').update(data).digest('hex')!==range.sha256)throw Error('ARTIFACT_CHANGED');return data;
 }finally{await file.close();}
}
