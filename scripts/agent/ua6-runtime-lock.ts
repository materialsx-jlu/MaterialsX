import {normalizeRuntimeLinks,removeRuntimeBytecode} from "../managed-runtime-links.js";
import {readdir,lstat,readFile,readlink,mkdir,writeFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {sha} from '../../packages/agent/src/papers/arxiv.js';
import {execFileSync} from 'node:child_process';
const requested=process.argv[2];
const platform=requested==='windows-x64'||requested==='macos-arm64'||requested==='linux-x64'?requested:process.platform==='darwin'&&process.arch==='arm64'?'macos-arm64':process.platform==='win32'&&process.arch==='x64'?'windows-x64':process.platform==='linux'&&process.arch==='x64'?'linux-x64':null;
if(!platform)throw Error('UNSUPPORTED_PLATFORM');
const root=resolve('runtime/skill-python',platform),files:Array<{path:string;sha256?:string;link?:string}>=[];
async function visit(dir:string){for(const name of (await readdir(dir)).sort()){if(name==='__pycache__'||name.endsWith('.pyc')||name==='BUILD')continue;const path=join(dir,name),s=await lstat(path);if(s.isDirectory())await visit(path);else if(s.isSymbolicLink()){const link=await readlink(path);if(!resolve(dir,link).startsWith(root+'/'))throw Error('RUNTIME_EXTERNAL_SYMLINK');files.push({path:relative(root,path).replaceAll('\\','/'),link});}else if(s.isFile())files.push({path:relative(root,path).replaceAll('\\','/'),sha256:sha(await readFile(path))});else throw Error('RUNTIME_SPECIAL_FILE');}}
await normalizeRuntimeLinks(root);await removeRuntimeBytecode(root);await visit(root);const python=join(root,platform==='windows-x64'?'python.exe':'bin/python3.12');
const probe="import sys,json,importlib.metadata as m; print(json.dumps({'python':sys.version.split()[0],**{n:m.version(n) for n in ['PyMuPDF','Pillow','jsonschema']}}))";
let versions:Record<string,string>;
if(platform==='windows-x64'&&process.platform!=='win32'||platform==='linux-x64'&&process.platform!=='linux'){
  const metadata=JSON.parse(await readFile(join(root,'RUNTIME.json'),'utf8'));versions={python:metadata.python};
  const site=platform==='windows-x64'?'Lib/site-packages':'lib/python3.12/site-packages';
  for(const folder of await readdir(join(root,site))){if(!folder.endsWith('.dist-info'))continue;const text=await readFile(join(root,site,folder,'METADATA'),'utf8'),name=text.match(/^Name: (.+)$/m)?.[1],version=text.match(/^Version: (.+)$/m)?.[1];if(name&&version&&['pymupdf','pillow','jsonschema'].includes(name.toLowerCase()))versions[({pymupdf:'PyMuPDF',pillow:'Pillow',jsonschema:'jsonschema'} as Record<string,string>)[name.toLowerCase()]!]=version;}
  if(Object.keys(versions).length!==4)throw Error('DEPENDENCY_METADATA_MISSING');
}else versions=JSON.parse(execFileSync(python,['-I','-B','-c',probe],{encoding:'utf8',timeout:30000}));
await mkdir('vendor/materialsx-runtime-locks',{recursive:true});await writeFile('vendor/materialsx-runtime-locks/skill-python-'+platform+'.json',JSON.stringify({version:'managed-python-v1',platform,versions,files},null,2)+'\n');
console.log(JSON.stringify({platform,versions,files:files.length}));
