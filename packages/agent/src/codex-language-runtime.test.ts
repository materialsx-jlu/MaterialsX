import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {codexLanguageRuntime} from './codex-language-runtime.js';
import {codexRuntime} from './codex-runtime.js';
import {codexSandbox} from './codex-sandbox.js';
test('missing owned Python never inherits or advertises system Python',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mx-no-python-'));
 try{const result=await codexLanguageRuntime({packaged:true,resourcesPath:root},'/usr/bin:/bin');assert.deepEqual(result.env,{});assert.deepEqual(result.readRoots,[]);assert.match(result.guidance,/No managed Python/);}finally{await rm(root,{recursive:true,force:true});}
});
test('bundled Python runs inside the same native sandbox with an isolated working directory',{skip:process.platform!=='darwin'},async()=>{
 const home=await mkdtemp(join(tmpdir(),'mx-python-sandbox-')),project=await mkdtemp(join(tmpdir(),'mx-python-project-'));
 try{
  const native=codexRuntime({projectRoot:process.cwd()}),language=await codexLanguageRuntime({projectRoot:process.cwd()},native.path);
  assert(language.env.MATERIALSX_PYTHON,'Development bundled runtime required');
  const sandbox=await codexSandbox(native.binary,home,project,[],language.readRoots);
  const {stdout}=await promisify(execFile)(sandbox.command,[...sandbox.args.slice(0,2),language.env.MATERIALSX_PYTHON!,'-I','-B','-c','import json,pathlib; pathlib.Path("verified.json").write_text(json.dumps({"actualPython":True})); print("actualPython")'],{cwd:project,env:{PATH:language.path,...language.env},timeout:10000});
  assert.equal(stdout.trim(),'actualPython');
  const heredoc=await promisify(execFile)(sandbox.command,[...sandbox.args.slice(0,2),'/bin/zsh','-c',`"$MATERIALSX_PYTHON" -B - <<'PY'\nimport json,pathlib\np=pathlib.Path('verified.json')\nassert json.loads(p.read_text())['actualPython']\nprint('verified-heredoc')\nPY`],{cwd:project,env:{PATH:language.path,...language.env,TMPDIR:sandbox.temporary,TMPPREFIX:join(sandbox.temporary,'zsh')},timeout:10000});
  assert.equal(heredoc.stdout.trim(),'verified-heredoc');
 }finally{await rm(home,{recursive:true,force:true});await rm(project,{recursive:true,force:true});}
});
