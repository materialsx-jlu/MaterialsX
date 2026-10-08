import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {offlineManifestSchema,verifyOfflineBundle} from '../packages/atomistic/src/offline-bundle.js';
import {AtomisticRuntime} from '../packages/atomistic/src/runtime.js';
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('MACOS_ARM64_REQUIRED');
const root=process.cwd(),temp=await mkdtemp(join(tmpdir(),'mx-m614-offline-')),resources=join(temp,'resources'),project=join(temp,'project');
let runtime:AtomisticRuntime|undefined;
try{
 const manifest=offlineManifestSchema.parse(JSON.parse(await readFile(join(root,'runtime/m6/offline-bundle-manifest.json'),'utf8')));assert.equal(manifest.version,'m6.14-v1');await mkdir(resources);await mkdir(project);
 // APFS clones avoid allocating another multi-gigabyte Python environment.
 await promisify(execFile)('/bin/cp',['-cR',join(root,'runtime/atomistic/macos-arm64'),join(resources,'atomistic-runtime')]);
 for(const f of manifest.files.filter(f=>!f.path.startsWith('atomistic-runtime/'))){
  const source=f.path.startsWith('native-engines/')?join(root,'runtime/native-engines/macos-arm64',f.path.slice('native-engines/'.length)):f.path.startsWith('model-packages/')?join(root,'runtime/scientific-packages',f.path.slice('model-packages/'.length)):join(root,f.path);
  const target=join(resources,f.path);await mkdir(dirname(target),{recursive:true});await copyFile(source,target);
 }
 await copyFile(join(root,'runtime/m6/offline-bundle-manifest.json'),join(resources,'offline-bundle-manifest.json'));const verified=await verifyOfflineBundle(resources);
 runtime=new AtomisticRuntime(resources,join(temp,'state'),id=>id==='project'?project:null);await runtime.restore();const id='nep-si-2022-nep4-3body';assert(runtime.status().find(p=>p.potentialId===id)?.installed,'bundled native checkpoint did not mount');
 const s=await runtime.importSample('project','si-diamond'),run=await runtime.start({projectId:'project',structureId:s.id,potentialId:id});let done;
 for(let n=0;n<1200;n++){done=runtime.get({projectId:'project',runId:run.job.id});if(['completed','failed'].includes(done.job.status))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(done?.job.status,'completed',done?.job.error??'');assert(done!.result!.stress);assert.match(await readFile(join(done!.outputDirectory,'report.zh.md'),'utf8'),/硅/);assert(!(await import('node:fs')).existsSync(join(resources,'atomistic/__pycache__')),'isolated workers wrote into installed source tree');
 const binary=join(resources,'native-engines/nep-cpu/nep-runner');await writeFile(binary,'tampered');assert(!runtime.environmentReady(id));const tamperedManifest={...manifest,files:[...manifest.files.filter(f=>f.path==='native-engines/nep-cpu/nep-runner'),...manifest.files.filter(f=>f.path!=='native-engines/nep-cpu/nep-runner')]};await writeFile(join(resources,'offline-bundle-manifest.json'),JSON.stringify(tamperedManifest));await assert.rejects(verifyOfflineBundle(resources),/CHANGED/);
 const evidence={stage:'M6.14',passed:true,platform:'macos-arm64',resourceManifest:verified,isolatedResourceTree:true,bundledNativeCheckpointMounted:true,actualBundledNativeSP:true,installedSourcesUnchanged:true,energyEv:done!.result!.energyEv,nativeBinaryTamperRejected:true,fullInstallerTested:false,packagedElectronLaunched:false,signedRelease:false,weightsDownloaded:0,realProviderCalls:0,paymentCalls:0};await writeFile(join(root,'docs/m6/evidence/m614-offline-resources.json'),JSON.stringify(evidence,null,2)+'\n');console.log('M6.14 isolated offline resources, native calculation and tamper rejection passed');
}finally{runtime?.dispose();await rm(temp,{recursive:true,force:true});}
