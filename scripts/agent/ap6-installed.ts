// Launch the actual packaged product binary in an isolated profile. No replacement of /Applications.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {extractFile} from '@electron/asar';
import {fingerprint} from '../../packages/release-readiness/src/qualification/fingerprint.js';
import {hash,canonical} from '../../packages/atomistic/src/discovery-io.js';
import {buildManifestSchema,inspectBuild} from '../../packages/release-readiness/src/qualification/build-identity.js';
import {verifyCodexBundle} from '../codex-runtime-package.mjs';
import {auditProductionPackage} from '../release-package-audit.mjs';
const run=promisify(execFile),source=resolve(process.argv[2]??''),output=resolve('runtime/agent/ap-6/installed-macos.json');
if(process.platform!=='darwin'||process.arch!=='arm64'||!source.endsWith('.app'))throw Error('Pass a macOS arm64 product .app directory');
const root=await mkdtemp(join(tmpdir(),'mx-ap6-installed-')),installed=join(root,'Applications','MaterialsX.app');await mkdir(join(root,'Applications'));
const profile=join(root,'profile'),home=join(root,'home');await mkdir(home);await mkdir(profile);
const fp=await fingerprint(process.cwd()),expected=await inspectBuild(resolve('dist'));
assert.equal(expected.status,'verified');assert.equal(canonical(expected.stamp!.fingerprint),canonical(fp));
const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as {port:number}).port;await new Promise<void>(r=>listener.close(()=>r()));
let child:ReturnType<typeof spawn>|undefined,socket:WebSocket|undefined;const diagnostics:Buffer[]=[],checks:Record<string,boolean>={};
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
try{
 await run('/usr/bin/ditto',[source,installed],{timeout:180000});
 const resources=join(installed,'Contents/Resources'),manifest=buildManifestSchema.parse(JSON.parse(extractFile(join(resources,'app.asar'),'dist/build-identity.json').toString()));
 checks.currentManifest=manifest.buildId===expected.stamp!.buildId&&manifest.artifactSha256===expected.artifactSha256;
 for(const file of manifest.files){const bytes=extractFile(join(resources,'app.asar'),'dist/'+file.path);assert.equal(hash(bytes),file.sha256);assert.equal(bytes.length,file.bytes);}
 checks.applicationBytes=true;
 const audit=await auditProductionPackage(resources),codex=await verifyCodexBundle(join(resources,'agent-runtime/codex'),'darwin','arm64');
 checks.noTestHarnessOrSecrets=audit.passed;checks.bundledCodex=codex.version==='0.160.0';
 const env:NodeJS.ProcessEnv={...process.env,HOME:home,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',MATERIALSX_PROFILE_PATH:profile,MATERIALSX_DISCOVERY_AUTOSYNC:'0',
  MATERIALSX_IDENTITY_URL:'http://127.0.0.1:1',MATERIALSX_MOOS_MCP_DIRECTORY:'/nonexistent/ap6-isolated'};
 delete env.MATERIALSX_RENDERER_URL;delete env.CODEX_HOME;delete env.ROOTFLOWAI_API_KEY;
 child=spawn(join(installed,'Contents/MacOS/MaterialsX'),['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{env,cwd:home,stdio:['ignore','pipe','pipe']});
 child.stdout!.on('data',b=>diagnostics.push(b));child.stderr!.on('data',b=>diagnostics.push(b));
 let target:any;
 for(let i=0;i<240;i++){
  if(child.exitCode!==null)throw Error('Installed product exited before startup');
  try{target=(await (await fetch('http://127.0.0.1:'+port+'/json',{signal:AbortSignal.timeout(500)})).json() as any[]).find(t=>t.type==='page'&&t.url.startsWith('file:'));if(target)break;}catch{}
  await delay(250);
 }
 assert(target?.webSocketDebuggerUrl);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise<void>((yes,no)=>{socket!.addEventListener('open',()=>yes(),{once:true});socket!.addEventListener('error',()=>no(Error('Local product inspector unavailable')),{once:true});});
 let id=0;const pending=new Map<number,{resolve:(value:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 socket.addEventListener('message',event=>{const m=JSON.parse(String(event.data));if(m.id&&pending.has(m.id)){const p=pending.get(m.id)!;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const command=(method:string,params:any)=>new Promise<any>((yes,no)=>{const n=++id;pending.set(n,{resolve:yes,reject:no,timer:setTimeout(()=>{pending.delete(n);no(Error('Product inspector timeout'));},30000)});socket!.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async(expression:string)=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Product operation failed: '+r.exceptionDetails.text);return r.result.value;};
 for(let i=0;i<120;i++){if(await evaluate('!!window.materialsx && !!document.querySelector(".empty-project")'))break;await delay(250);}
 checks.realRenderer=await evaluate('!!document.querySelector(".empty-project")');
 const state=await evaluate('window.materialsx.bootstrap()');
 checks.loadedIdentity=state.buildIdentity.status==='verified'&&state.buildIdentity.stamp.buildId===manifest.buildId;
 checks.defaultCodexCloud=state.settings.agentEngine==='codex'&&state.settings.mode==='platform'&&state.settings.modelId==='materials-research';
 checks.skills=state.skills.some((s:any)=>s.name==='materials-literature-rpsme-json')&&state.skills.some((s:any)=>s.name==='materials-xyz-extraction');
 checks.catalog=state.potentialCatalog.entries.length>0;
 const environment=await evaluate('window.materialsx.managedEnvironment("check")');checks.independentPDFPython=environment.status==='ready';
 const atomic=await evaluate('window.materialsx.getAtomisticRuntime()');checks.independentAtomicRuntime=Array.isArray(atomic)&&atomic.some((s:any)=>s.installed);
 const sqlite=await readFile(join(profile,'materialsx.sqlite'));checks.isolatedSQLite=sqlite.length>0;
 const native=join(resources,'agent-runtime/codex',codex.target,'bin/codex');
 const version=await run(native,['--version'],{env:{PATH:'/usr/bin:/bin',HOME:home,CODEX_HOME:join(profile,'independent-codex')},timeout:5000});checks.noSystemCodex=/0\.160\.0/.test(version.stdout);
 await command('Page.enable',{});const screenshot=await command('Page.captureScreenshot',{format:'png'});await writeFile(resolve('runtime/agent/ap-6/installed-macos.png'),Buffer.from(screenshot.data,'base64'));
 const support=JSON.parse(await readFile(join(resources,'release-support.json'),'utf8'));checks.previewLimits=support.formalReleaseReady===false&&support.signed===false;
 assert(Object.values(checks).every(Boolean),JSON.stringify(checks));
 await writeFile(output,JSON.stringify({schemaVersion:'ua14-ap6-installed-v1',passed:true,platform:'darwin-arm64',fingerprint:fp,buildId:manifest.buildId,
  artifactSha256:manifest.artifactSha256,checks,actualProductBinary:true,isolatedInstallation:true,userInstallationReplaced:false,
  inspectorScope:'explicit local test launch; closed after test; not packaged instrumentation',modelCalls:0,payments:0,modelQualification:false,
  scientificQualification:false,codeSignature:'ad-hoc preview; no Developer ID or notarization',windowsTested:false,linuxTested:false,
  PDFPython:environment.versions,codexVersion:version.stdout.trim(),audit},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({passed:true,output,checks}));
}finally{
 socket?.close();if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise<void>(r=>child!.once('exit',()=>r())),delay(5000)]);if(child.exitCode===null)child.kill('SIGKILL');}
 await writeFile(resolve('runtime/agent/ap-6/installed-macos.log'),Buffer.concat(diagnostics),{mode:0o600});await rm(root,{recursive:true,force:true});
}
