import {readFile,mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
const evidence=async(name:string)=>{try{return JSON.parse(await readFile(resolve('docs/m6/evidence',name),'utf8'));}catch{return null;}};
const mac=await evidence('m612-macos-runtime.json'),ui=await evidence('m612-macos-ui.json'),pack=await evidence('m612-macos-offline-package.json'),windows=await evidence('m612-windows-runtime.json');
const checks=[
 {id:'macos-real-calculators',passed:mac?.passed===true&&mac?.actualRuntime===true&&mac?.platform==='macos-arm64'&&mac?.checkpoints?.length===6},
 {id:'bilingual-shared-theme-desktop',passed:ui?.passed===true&&ui?.nativeElectron===true&&ui?.bilingualUI===true&&ui?.nativeCleanupConfirmation===true&&ui?.responsiveness?.maxFrameGapMs<250},
 {id:'macos-current-offline-engineering-bundle',passed:pack?.passed===true&&pack?.resourcesVerified?.version==='m6.12-v1'&&pack?.actualPackagedBinaryLaunched===true&&pack?.actualPackagedMainPreloadIpcCalculations?.length===6},
 {id:'windows-actual-runtime-and-installation',passed:windows?.passed===true&&windows?.actualRuntime===true&&windows?.platform==='windows-x64'&&windows?.fullInstallerTested===true},
 {id:'developer-id-notarization-and-windows-signature',passed:false,reason:'Formal signing identities and actual installer evidence are pending.'},
 {id:'public-signed-catalog-feed',passed:false,reason:'Public signed catalog feed has not been deployed.'}
];
const report={stage:'M6.12',checkedAt:new Date().toISOString(),engineeringPassed:checks.slice(0,3).every(c=>c.passed),formalReleaseReady:checks.every(c=>c.passed),checks,scientificQuality:'needs_review',note:'Local evidence is engineering provenance, not an independent certification. Windows hardware, formal signatures and public deployment remain release gates.'};
await mkdir(resolve('runtime/m6/acceptance/m612'),{recursive:true});await writeFile(resolve('runtime/m6/acceptance/m612/release-gate.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(process.argv.includes('--strict')&&!report.formalReleaseReady)process.exitCode=1;
