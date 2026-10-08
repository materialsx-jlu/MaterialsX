import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('MACOS_ARM64_REQUIRED');
const run=(file:string,args:string[],env=process.env)=>new Promise<void>((ok,fail)=>{const p=spawn(file,args,{stdio:'inherit',env});p.once('error',fail);p.once('exit',code=>code===0?ok():fail(Error(file+' exited '+code)));});
const root=process.cwd(),configDir=resolve('runtime/m6/m612-package');await mkdir(configDir,{recursive:true});
for(const path of ['runtime/atomistic/macos-arm64','runtime/skill-python/macos-arm64'])if(!(await lstat(path)).isDirectory())throw Error('CACHED_PORTABLE_RUNTIME_REQUIRED');
await run(process.execPath,['--import','tsx','scripts/m612-prepare-packages.ts']);await run(process.execPath,['--import','tsx','scripts/m66-offline-manifest.ts','--m612']);
const pkg=JSON.parse(await readFile('package.json','utf8')),config={...pkg.build,extends:null,directories:{output:configDir},mac:{...pkg.build.mac,extraResources:[]}};const path=join(configDir,'builder.json');await writeFile(path,JSON.stringify(config,null,2));
await run(join(root,'node_modules/.bin/electron-builder'),['--dir','--mac','--arm64','--config',path],{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'});
const app=join(configDir,'mac-arm64/MaterialsX.app'),resources=join(app,'Contents/Resources');
// APFS clones reuse local runtime blocks. No package manager/download or signing is performed.
await run('/bin/cp',['-cR',resolve('runtime/atomistic/macos-arm64'),join(resources,'atomistic-runtime')]);await run('/bin/cp',['-cR',resolve('runtime/skill-python/macos-arm64'),join(resources,'python-runtime')]);
console.log(JSON.stringify({stage:'M6.12',app,engineeringBundle:true,signedRelease:false,runtimeCopy:'APFS clone',weightsDownloaded:0}));
