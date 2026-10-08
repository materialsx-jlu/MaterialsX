import {secretProjectPath} from '../../../packages/agent/src/project-path-policy.js';
import {resolveManagedPython} from '../../../packages/pi-adapter/src/local-session-tools.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir,open, realpath, lstat } from "node:fs/promises";
import { basename, extname, isAbsolute, join,relative, sep } from "node:path";
import type { CloudAsset } from "../../../packages/pi-adapter/src/platform-session.js";
const execute=promisify(execFile);
const textExtensions=new Set(['.txt','.md','.json','.csv','.cif','.xyz','.log']);
const documentExtensions=new Set(['.pdf','.docx','.xls','.xlsx']);

/** Freeze explicit selections before conversion; no original path is sent to the model. */
export async function snapshotAttachmentFile(projectPath:string,selectedPath:string,applicationRoot:string):Promise<CloudAsset>{
  const path=await realpath(selectedPath),extension=extname(path).toLowerCase();
  if(!textExtensions.has(extension)&&!documentExtensions.has(extension))throw Error('不支持的附件格式 / Unsupported attachment format');
  if(secretProjectPath(selectedPath)||secretProjectPath(path))throw Error('文件包含凭据，不能作为附件 / Credential files cannot be attached');
  const limit=extension==='.pdf'?100*1024*1024:documentExtensions.has(extension)?25*1024*1024:8*1024*1024;
  const file=await open(selectedPath,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
  try{const stat=await file.stat();if(!stat.isFile()||stat.size>limit)throw Error(`附件超过 ${Math.floor(limit/1048576)} MiB 上限`);bytes=await file.readFile();if(bytes.length!==stat.size)throw Error('文件读取时大小改变，请重新选择');}
  finally{await file.close()}
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const root=await realpath(projectPath);let directory=root;
  for(const part of ['materials-output','attachments',sha256]){directory=join(directory,part);await mkdir(directory,{recursive:true,mode:0o700});const state=await lstat(directory);if(state.isSymbolicLink()||!state.isDirectory())throw Error('附件缓存目录不安全');}
  const target=join(directory,basename(path));
  let output;try{output=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await output.writeFile(bytes)}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const existing=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(createHash('sha256').update(await existing.readFile()).digest('hex')!==sha256)throw Error('附件快照已改变，请重新选择')}finally{await existing.close()}}
  finally{await output?.close()}
  let text:string,pageCount:number|undefined,ocrUnverifiedPages:number[]|undefined;
  if(textExtensions.has(extension)){
    text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error('文本附件包含二进制内容');
    if(extension==='.json')try{text=JSON.stringify(JSON.parse(text),null,2)}catch{ /* Keep invalid JSON as inspectable text. */ }
  }else{
    const script=join(applicationRoot,'vendor/materialsx-default-skills/scripts/extract-attachment.py');
    const result=await execute(resolveManagedPython(applicationRoot),['-I','-B',script,target],{timeout:10*60*1000,maxBuffer:32*1024*1024,env:{PATH:process.env.PATH??'',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'}});
    const parsed=JSON.parse(result.stdout) as {text:string;pageCount?:number;ocrUnverifiedPages?:number[]};
    text=parsed.text;pageCount=parsed.pageCount;ocrUnverifiedPages=parsed.ocrUnverifiedPages;
  }
  if(Buffer.byteLength(text)>8*1024*1024)throw Error('提取文本超过 8 MiB，请拆分后添加');
  return {id:randomUUID(),name:basename(path),text,sha256,format:extension.slice(1),sourceBytes:bytes.length,...(pageCount!==undefined?{pageCount}:{}),...(ocrUnverifiedPages?.length?{ocrUnverifiedPages}:{})};
}
/** Explicit PDF paths may be outside the project; the approved bytes are frozen locally before upload. */
export async function snapshotPdfFile(projectPath:string,selectedPath:string):Promise<{path:string;name:string;sha256:string;size:number}>{
 const root=await realpath(projectPath),path=await realpath(selectedPath);
 if(extname(path).toLowerCase()!==".pdf")throw new Error("请选择 PDF 文件");
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 let bytes:Buffer;
 try{const st=await file.stat();if(!st.isFile()||st.size>100*1024*1024)throw new Error("PDF 必须是普通文件且不超过100MiB");bytes=Buffer.alloc(st.size+1);let offset=0;while(offset<bytes.length){const part=await file.read(bytes,offset,bytes.length-offset,offset);if(!part.bytesRead)break;offset+=part.bytesRead}if(offset!==st.size)throw new Error("读取时 PDF 大小改变，请重新选择");bytes=bytes.subarray(0,offset);if(bytes.subarray(0,5).toString()!=="%PDF-")throw new Error("文件内容不是 PDF")}finally{await file.close()}
 const sha256=createHash("sha256").update(bytes).digest("hex"),directory=join(root,"materials-output","cloud-sources");await mkdir(directory,{recursive:true});const resolved=await realpath(directory),inside=relative(root,resolved);if(isAbsolute(inside)||inside===".."||inside.startsWith(`..${sep}`))throw new Error("材料输出目录指向项目外部");const target=join(resolved,`${sha256}.pdf`);
 let out;try{out=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await out.writeFile(bytes)}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;const previous=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await previous.stat();if(!st.isFile()||st.size!==bytes.length)throw new Error("PDF 快照无效");const old=await previous.readFile();if(createHash("sha256").update(old).digest("hex")!==sha256)throw new Error("PDF 快照被修改，请重新准备")}finally{await previous.close()}}finally{await out?.close()}
 return {path:target,name:selectedPath,sha256,size:bytes.length};
}

export function selectedFileMetadata(file:CloudAsset){return {id:file.id,name:file.name,sha256:file.sha256,bytes:file.sourceBytes??Buffer.byteLength(file.text),totalLines:file.text.split("\n").length,format:file.format??'text',pageCount:file.pageCount??null,ocrUnverifiedPages:file.ocrUnverifiedPages??[]};}
