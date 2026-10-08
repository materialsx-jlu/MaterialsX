import {dirname,basename,join,resolve} from 'node:path';
import {mkdir,lstat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readOwnedBytes,hashOwnedFile} from '../../atomistic/src/artifact-io.js';
import type {ModelConnection} from '../../contracts/src/engine-selection.js';
import type {ExecutionControl} from '../../agent/src/execution-control.js';
import {readPaperPages} from './pdf-pages.js';
import {resolveManagedPython} from './local-session-tools.js';
import {runRpsmeWorkflow,parseModelJson,type JsonModelCall} from './rpsme-workflow.js';
import {interpretLocal} from './local-runtime.js';
/** One scientific workflow for both engines; bounded JSON extraction calls, not a second tool/Agent loop. */
export async function runManagedRpsme(input:{pdfPath:string;approvedPdfPath:string;projectPath:string;projectRoot:string;connection:ModelConnection;control:ExecutionControl;signal:AbortSignal},invoke?:JsonModelCall){
  if(input.connection.source!=='local'||!input.connection.endpoint)throw Error('RPSME_LOCAL_MODEL_REQUIRED');
  if(resolve(input.pdfPath)!==resolve(input.approvedPdfPath))throw Error('RPSME_PDF_NOT_IN_USER_REQUEST');
  const pdf=await readOwnedBytes(dirname(input.pdfPath),input.pdfPath,null,100*1024*1024),sha256=createHash('sha256').update(pdf).digest('hex');
  if(pdf.subarray(0,5).toString()!=='%PDF-')throw Error('RPSME_INPUT_NOT_PDF');
  let dir=input.projectPath;for(const part of ['materials-output','rpsme-inputs',sha256]){dir=join(dir,part);await mkdir(dir,{recursive:true});const s=await lstat(dir);if(s.isSymbolicLink()||!s.isDirectory())throw Error('RPSME_OUTPUT_SCOPE');}
  const copied=join(dir,basename(input.pdfPath));try{await writeFile(copied,pdf,{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;await hashOwnedFile(input.projectPath,copied,sha256,100*1024*1024);}
  const pages=await readPaperPages(copied,input.projectPath,input.projectRoot,{fromPage:1,toPage:1},input.signal);
  const text=await runRpsmeWorkflow({pdfPath:copied,projectPath:input.projectPath,projectRoot:input.projectRoot,python:resolveManagedPython(input.projectRoot),manifestPath:pages.manifest,
    endpoint:input.connection.endpoint,modelId:input.connection.modelId,contextWindow:input.connection.contextWindow!,signal:input.signal},invoke??(async(prompt)=>parseModelJson(await interpretLocal(input.connection.endpoint!,input.connection.modelId,prompt,input.signal,input.connection.maxOutputTokens,input.control,input.connection,'extract'))));
  await hashOwnedFile(dirname(input.pdfPath),input.pdfPath,sha256,100*1024*1024);
  const artifacts=[];for(const match of text.matchAll(/\[(RPSME JSON|中文摘要|校验报告)\]\(([^)]+)\)/g)){const path=decodeURI(match[2]!),identity=await hashOwnedFile(input.projectPath,path,null,10*1024*1024);artifacts.push({label:match[1],path,...identity});}
  if(artifacts.length!==3)throw Error('RPSME_DELIVERABLES_MISSING');return {source:{sha256,path:copied},modelId:input.connection.modelId,scientificStatus:'needs_review',text,artifacts};
}
