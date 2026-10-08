process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';
process.env.MATERIALSX_IDENTITY_URL='';
process.env.MATERIALSX_MOOS_MCP_DIRECTORY='/nonexistent/preview-fixture';
delete process.env.MATERIALSX_RENDERER_URL;
const {app,BrowserWindow}=require('electron');
const {mkdtempSync,writeFileSync,mkdirSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const resources=resolve(process.argv[2]),out=resolve(process.argv[3]);
const temp=mkdtempSync(join(tmpdir(),'mx-preview-package-'));
app.setPath('userData',join(temp,'state'));
Object.defineProperty(app,'isPackaged',{value:true});
Object.defineProperty(process,'resourcesPath',{value:resources});
let failed=false;
const abort=e=>{failed=true;console.error(e);app.exit(1)};
process.on('uncaughtException',abort);process.on('unhandledRejection',abort);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let win;
 await import(pathToFileURL(join(resources,'app.asar/dist/apps/desktop/main/index.js')).href);
 for(let i=0;i<240;i++){
  win=BrowserWindow.getAllWindows()[0];
  if(win&&!win.webContents.isLoadingMainFrame()&&await win.webContents.executeJavaScript('!!window.materialsx && !!document.querySelector(".empty-project")'))break;
  await pause(250);
 }
 assert(win);const js=s=>win.webContents.executeJavaScript(s);
 assert(await js('!!document.querySelector(".empty-project")'));
 const state=await js('window.materialsx.bootstrap()');
 const packageVersion=JSON.parse(require('node:fs').readFileSync(join(resources,'app.asar/package.json'),'utf8')).version;
 const support=JSON.parse(require('node:fs').readFileSync(join(resources,'release-support.json'),'utf8'));
 assert.equal(packageVersion,support.version);assert.equal(support.channel,'preview');
 const readiness=await js('window.materialsx.getReleaseReadiness()');
 assert.equal(readiness.version,packageVersion);
 assert.equal(readiness.target,packageVersion.startsWith('0.2.0-preview.')?'v0.2-preview':'v1');
 if(readiness.target==='v0.2-preview'){
  assert.equal(readiness.blocked,0,'0.2 preview release gate still has blockers');
  await js('Array.from(document.querySelectorAll(".primary-nav button")).find(button=>button.textContent.includes("发布中心")).click()');
  for(let i=0;i<40&&!await js('!!document.querySelector(".release-notice")');i++)await pause(100);
  assert.match(await js('document.querySelector(".release-notice")?.textContent ?? ""'),/0\.2 预览版源码门槛通过/);
 }
 assert(state.skills.some(s=>s.name==='materials-literature-rpsme-json'));
 assert(state.skills.some(s=>s.name==='materials-xyz-extraction'));
 assert(state.models.length>0);assert(state.potentialRegistry.potentials.length>0);assert(state.potentialCatalog.entries.length>0);
 const environment=await js('window.materialsx.managedEnvironment("check")');
 assert.equal(environment.status,'ready',environment.detail);
 const report={passed:!failed,kind:'actual-packaged-resources-with-isolated-Electron-harness',platform:process.platform+'-'+process.arch,
  appVersion:packageVersion,harnessReportedVersion:state.appVersion,skills:state.skills.length,potentialResources:state.potentialCatalog.entries.length,
  renderer:true,preload:true,SQLite:true,PDFPython:environment.versions,
  release:{target:readiness.target,passed:readiness.passed,warnings:readiness.warnings,blocked:readiness.blocked},
  installedProductBootstrap:false,physicalMachineInstallation:false};
 mkdirSync(require('node:path').dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 app.quit();await pause(1000);rmSync(temp,{recursive:true,force:true});app.exit(failed?1:0);
})().catch(abort);
setTimeout(()=>abort(Error('PACKAGED_RESOURCE_BOOT_TIMEOUT')),120000).unref();
