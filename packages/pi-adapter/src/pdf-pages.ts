import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,lstat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {z} from 'zod';
import {pdfPreprocessSpec} from './local-session-tools.js';
import {readOwnedBytes,hashOwnedFile} from '../../atomistic/src/artifact-io.js';
const exec=promisify(execFile);
/** Both engines use the same packaged RPSME preprocessor and bounded page reader. No model loop. */
export async function readPaperPages(path:string,cwd:string,projectRoot:string,range:{fromPage:number;toPage?:number},signal?:AbortSignal){
  const input=await hashOwnedFile(cwd,path,null,100*1024*1024),spec=pdfPreprocessSpec(path,cwd,projectRoot);
  let base=cwd;for(const name of ['materials-output','paper-pages',input.sha256]){base=join(base,name);await mkdir(base,{recursive:true});const s=await lstat(base);if(s.isSymbolicLink()||!s.isDirectory())throw Error('PDF_OUTPUT_SCOPE');}
  spec.args[spec.args.indexOf('--output-dir')+1]=base;const manifest=join(base,'document-set.manifest.json');
  if(!existsSync(manifest))await exec(spec.command,['-I','-B',...spec.args],{cwd,timeout:10*60*1000,maxBuffer:2*1024*1024,env:{PATH:process.env.PATH??'',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',...(process.env.TMPDIR?{TMPDIR:process.env.TMPDIR}:{}),...(process.env.SYSTEMROOT?{SYSTEMROOT:process.env.SYSTEMROOT}:{})},...(signal?{signal}:{})});
  const source=z.object({documents:z.array(z.object({manifest:z.string()})).length(1)}).parse(JSON.parse((await readOwnedBytes(base,manifest,null,1024*1024)).toString('utf8')));
  const documentPath=source.documents[0]!.manifest,document=z.object({pages:z.array(z.object({pdf_page:z.number().int().positive(),text_file:z.string().nullable().optional()})).min(1).max(2000)}).parse(JSON.parse((await readOwnedBytes(base,documentPath,null,2*1024*1024)).toString('utf8')));
  const totalPages=document.pages.length,to=range.toPage??Math.min(totalPages,range.fromPage+4);
  if(to<range.fromPage||to-range.fromPage>=20||to>totalPages)throw Error('PAPER_PAGE_RANGE');
  const pages:Array<{page:number;text:string}>=[];
  for(const p of document.pages){signal?.throwIfAborted();if(p.pdf_page>=range.fromPage&&p.pdf_page<=to&&p.text_file){const bytes=await readOwnedBytes(base,join(dirname(documentPath),p.text_file),null,80000,true);pages.push({page:p.pdf_page,text:bytes.toString('utf8')});}}
  await hashOwnedFile(cwd,path,input.sha256,100*1024*1024);return {totalPages,pages,manifest};
}
