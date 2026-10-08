import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
const platform=process.platform==="darwin"?"macos-arm64":"windows-x64";
const base=join(process.cwd(),"runtime/atomistic",platform);const measurements=[];
async function bytes(path:string):Promise<number>{let size=0;for(const file of await readdir(path,{withFileTypes:true})){const item=join(path,file.name);size+=file.isDirectory()?await bytes(item):(await stat(item)).size;}return size;}
for(const family of ["mace","chgnet"]){
 const original=join(base,family);const moved=join(base,`${family}.relocated`);const receipt=JSON.parse(await readFile(join(original,"RUNTIME.json"),"utf8")) as {portable:boolean;python:string};assert(receipt.portable);
 await rename(original,moved);
 try{
  const script=`import sys, pathlib, torch, ase, ${family}; executable=pathlib.Path(sys.executable).resolve(); root=executable.parent if sys.platform=='win32' else executable.parent.parent; module=pathlib.Path(torch.__file__).resolve(); assert root in module.parents; assert sys.version.split()[0]=='3.12.10'; assert torch.__version__.split('+')[0]=='2.8.0'; print('relocated-imports-passed')`;
  const {stdout}=await promisify(execFile)(join(moved,receipt.python),["-I","-c",script],{timeout:90_000,maxBuffer:1024*1024});assert(stdout.includes("relocated-imports-passed"));
  measurements.push({family,portable:true,relocatedInterpreterAndImports:true,expandedBytes:await bytes(moved)});
 }finally{await rename(moved,original);}
}
const expandedBytes=measurements.reduce((size,item)=>size+item.expandedBytes,0);assert(expandedBytes<=6144*1048576);
const result={version:"m6.1-v1",platform,measurements,expandedBytes,expandedMiB:expandedBytes/1048576,capMiB:6144,installerFreeDiskGateMiB:8192,fullInstallerTested:false};
await writeFile("runtime/m6/acceptance/portability.json",JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
