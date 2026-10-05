import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir,open, realpath, stat as pathStat } from "node:fs/promises";
import { basename, extname, isAbsolute, join,relative, sep } from "node:path";
import type { CloudAsset } from "../../../packages/pi-adapter/src/platform-session.js";
/** Read the approved bytes once; later file edits cannot change the reviewed payload. */
export async function snapshotTextFile(projectPath: string, selectedPath: string): Promise<CloudAsset> {
  const root = await realpath(projectPath), path = await realpath(selectedPath), inside = relative(root, path);
  if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`) || ![".txt",".md",".json",".csv",".cif",".xyz",".log"].includes(extname(path).toLowerCase())) throw new Error("仅允许读取所选项目内的文本文件");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat(); if (!stat.isFile() || stat.size > 32768) throw new Error("所选文件不是普通文本文件，或超过32KiB上限");
    const bytes = Buffer.alloc(32769); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 32768) throw new Error("文本超过32KiB上限");
    const afterPath=await realpath(path),after=await pathStat(afterPath),afterInside=relative(root,afterPath);
    if(isAbsolute(afterInside)||afterInside===".."||afterInside.startsWith(`..${sep}`)||after.dev!==stat.dev||after.ino!==stat.ino)throw new Error("文件位置在读取时发生变化，请重新选择");
    const data = bytes.subarray(0, bytesRead); const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error("所选文件包含二进制内容");
    return { id: randomUUID(), name: basename(path), text, sha256: createHash("sha256").update(data).digest("hex") };
  } finally { await file.close(); }
}

/** Explicit PDF paths may be outside the project; the approved bytes are frozen locally before upload. */
export async function snapshotPdfFile(projectPath:string,selectedPath:string):Promise<{path:string;name:string;sha256:string;size:number}>{
 const root=await realpath(projectPath),path=await realpath(selectedPath);
 if(extname(path).toLowerCase()!==".pdf")throw new Error("请选择 PDF 文件");
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 let bytes:Buffer;
 try{const st=await file.stat();if(!st.isFile()||st.size>64*1024*1024)throw new Error("PDF 必须是普通文件且不超过64MiB");bytes=Buffer.alloc(st.size+1);let offset=0;while(offset<bytes.length){const part=await file.read(bytes,offset,bytes.length-offset,offset);if(!part.bytesRead)break;offset+=part.bytesRead}if(offset!==st.size)throw new Error("读取时 PDF 大小改变，请重新选择");bytes=bytes.subarray(0,offset);if(bytes.subarray(0,5).toString()!=="%PDF-")throw new Error("文件内容不是 PDF")}finally{await file.close()}
 const sha256=createHash("sha256").update(bytes).digest("hex"),directory=join(root,"materials-output","cloud-sources");await mkdir(directory,{recursive:true});const resolved=await realpath(directory),inside=relative(root,resolved);if(isAbsolute(inside)||inside===".."||inside.startsWith(`..${sep}`))throw new Error("材料输出目录指向项目外部");const target=join(resolved,`${sha256}.pdf`);
 let out;try{out=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await out.writeFile(bytes)}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;const previous=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await previous.stat();if(!st.isFile()||st.size!==bytes.length)throw new Error("PDF 快照无效");const old=await previous.readFile();if(createHash("sha256").update(old).digest("hex")!==sha256)throw new Error("PDF 快照被修改，请重新准备")}finally{await previous.close()}}finally{await out?.close()}
 return {path:target,name:selectedPath,sha256,size:bytes.length};
}
