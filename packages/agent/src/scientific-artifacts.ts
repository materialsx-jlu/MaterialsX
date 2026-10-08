import {mkdir,lstat,realpath,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {readOwnedBytes} from '../../atomistic/src/artifact-io.js';
export async function writeScientificArtifacts(root:string,id:string,data:unknown,report:string){
  const files=[{name:'result.json',body:JSON.stringify(data,null,2)+'\n'},{name:'report.md',body:report}];
  if(files.some(f=>Buffer.byteLength(f.body)>4*1024*1024))throw Error('SCIENTIFIC_OUTPUT_LIMIT');
  return writeScientificFiles(root,id,files);
}
export async function writeScientificFiles(root:string,id:string,files:Array<{name:string;body:string|Buffer}>,recoverExact=false){
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('SCIENTIFIC_OUTPUT_ID_INVALID');
  if(files.length>12||new Set(files.map(f=>f.name)).size!==files.length||files.some(f=>! /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/.test(f.name)))throw Error('SCIENTIFIC_FILE_NAMES_INVALID');
  if(files.reduce((n,f)=>n+Buffer.byteLength(f.body),0)>32*1024*1024)throw Error('SCIENTIFIC_BUNDLE_LIMIT');
  const base=await realpath(root);let directory=base;
  for(const part of ['materials-output','research-quality',id]){
    directory=join(directory,part);await mkdir(directory,{recursive:true});const info=await lstat(directory);
    if(!info.isDirectory()||info.isSymbolicLink()||await realpath(directory)!==directory)throw Error('SCIENTIFIC_OUTPUT_SYMLINK');
  }
  const artifacts=[];
  for(const {name,body}of files){
    if(Buffer.byteLength(body)>8*1024*1024)throw Error('SCIENTIFIC_OUTPUT_LIMIT');
    const path=join(directory,name);try{await writeFile(path,body,{flag:'wx',mode:0o600});}catch(e){if(!recoverExact||(e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const previous=await readOwnedBytes(base,path,null,8*1024*1024,true);if(!previous.equals(Buffer.from(body)))throw Error('SCIENTIFIC_RECOVERY_BYTES_CHANGED');}const bytes=await readOwnedBytes(base,path,null,8*1024*1024,true);
    artifacts.push({path:relative(base,path),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
  }
  return artifacts;
}
