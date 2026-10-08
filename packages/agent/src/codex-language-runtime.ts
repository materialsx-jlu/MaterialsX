import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,relative,isAbsolute,sep,delimiter} from 'node:path';
import {managedPython} from '../../pi-adapter/src/managed-python.js';
import type {CodexRuntimeLocation} from './codex-runtime.js';
/** Only the owned, bundled or host-verified repaired Python is advertised. Never inherit user PATH. */
export async function codexLanguageRuntime(location:CodexRuntimeLocation={},runtimePath:string){
 const root=location.packaged?location.resourcesPath:location.projectRoot??process.cwd();
 const empty={path:runtimePath,env:{} as Record<string,string>,readRoots:[] as string[],guidance:'No managed Python is available. Do not use system Python as a substitute; report the missing runtime if a script needs it.'};
 if(!root)return empty;
 const override=managedPython(root),platform=location.platform??process.platform;
 const candidates=override?[override]:[join(root,'python-runtime',platform==='win32'?'python.exe':'bin/python3.12'),
   ...(!location.packaged?[join(root,'runtime/skill-python',`${platform==='darwin'?'macos':platform==='win32'?'windows':'linux'}-${location.arch??process.arch}`,platform==='win32'?'python.exe':'bin/python3.12')]:[])];
 for(const candidate of candidates){
  try{
   await access(candidate,constants.X_OK);const bundle=await realpath(platform==='win32'?dirname(candidate):dirname(dirname(candidate))),python=await realpath(candidate),local=relative(bundle,python);
   if(isAbsolute(local)||local==='..'||local.startsWith('..'+sep))continue;
   const {stdout}=await promisify(execFile)(python,['-I','-B','-c','import json,sys; print(json.dumps({"version":list(sys.version_info[:2])}))'],{timeout:5000,env:{PATH:runtimePath}});
   const version=JSON.parse(stdout).version;if(version[0]!==3||version[1]<10)continue;
   return {path:[dirname(candidate),runtimePath].join(delimiter),readRoots:[bundle],
    env:{MATERIALSX_PYTHON:python,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},
    guidance:`Managed Python: ${JSON.stringify(python)}. Run scripts using "$MATERIALSX_PYTHON" -B with login=false; python3 also resolves to this owned environment. Do not guess interpreter paths.`};
  }catch{/* An unavailable candidate must never be advertised as runnable. */}
 }
 return empty;
}
