// Isolated Electron benchmark: no model downloads, inference or payment calls.
process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';
process.env.MATERIALSX_IDENTITY_URL='http://127.0.0.1:1';
delete process.env.MATERIALSX_RENDERER_URL;
const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const {mkdtempSync,rmSync,mkdirSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const temp=mkdtempSync(join(tmpdir(),'mx-catalog-perf-'));
app.setPath('userData',join(temp,'state'));
const project=join(temp,'project');mkdirSync(project);
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]});
const samples=[];let measuring=false;
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>handle(channel,async(...args)=>{
 const sample=measuring?{channel,start:performance.now()}:null;
 if(sample)samples.push(sample);
 try{return await fn(...args);}finally{if(sample)sample.ms=performance.now()-sample.start;}
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let code=1;
 try{
  await import(pathToFileURL(resolve('dist/apps/desktop/main/index.js')).href);
  let win;
  for(let i=0;i<300;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await pause(100);}
  assert(win);win.setSize(1450,1000);win.webContents.setBackgroundThrottling(false);
  const js=s=>win.webContents.executeJavaScript(s);
  const until=async s=>{for(let i=0;i<300;i++){if(await js(s))return;await pause(50);}throw Error('Timeout: '+s);};
  const click=s=>js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(s)}))?.click()`);
  await until("!!document.querySelector('.empty-project')");
  await js('window.materialsx.chooseProjectFolder()');
  await js('location.reload()');
  await until("!document.querySelector('.new-task-button')?.disabled");
  await click('模型目录');
  await until("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('机器学习势 · 全部目录'))");
  measuring=true;
  const paint=await js(`new Promise(resolve=>{
   const start=performance.now();window.catalogLongTasks=[];
   new PerformanceObserver(list=>window.catalogLongTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});
   Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('机器学习势 · 全部目录')).click();
   const next=()=>{if(!document.querySelector('[data-testid="hub-grid"] .catalog-card'))return requestAnimationFrame(next);
    requestAnimationFrame(()=>resolve(performance.now()-start));};requestAnimationFrame(next);
  })`);
  await pause(2500);
  while(samples.some(s=>!('ms' in s)))await pause(100);
  const overview={paintMs:paint,cards:await js("document.querySelectorAll('[data-testid=hub-grid] .catalog-card').length"),longTasks:await js('window.catalogLongTasks'),ipc:samples.map(({channel,ms})=>({channel,ms}))};
  if(process.argv.includes('--assert')){
   assert.equal(overview.cards,24);
   for(const channel of ['potentials:packages','potentials:discovery-status','potentials:updates','atomistic:runtime','science:packages'])assert(!samples.some(s=>s.channel===channel),'Collapsed section eagerly requested '+channel);
   assert.equal(samples.filter(s=>s.channel==='potentials:model-states').length,1);
  }
  const cold=performance.now();await js('window.materialsx.getPotentialModelStates()');const statusMs=performance.now()-cold;
  let features=null;
  if(process.argv.includes('--assert')){
   await js("document.querySelector('[data-testid=hub-grid] .catalog-card').click()");
   await until("!!document.querySelector('[data-testid=model-install]')");
   const scans=samples.filter(s=>s.channel==='potentials:model-states').length;
   await pause(2700);
   assert.equal(samples.filter(s=>s.channel==='potentials:model-states').length,scans,'Idle details must not rescan all weights');
   await js("document.querySelector('[data-testid=hub-details] .icon-button').click()");
   await pause(300);await click('English');
   await js("document.querySelector('[data-testid=hub-grid] .catalog-card').click()");
   await until("document.querySelector('[data-testid=hub-details]')?.textContent.includes('Usage examples')");
   assert(await js("!!document.querySelector('[data-testid=model-load]')"));
   await js("document.querySelector('[data-testid=hub-details] .icon-button').click()");await pause(300);
   await js("document.querySelector('[data-testid=updates-toggle]').click()");
   await until("document.querySelector('[data-testid=updates-content] .discovery-metrics strong')?.textContent!=='—'");
   await js("document.querySelector('[data-testid=storage-toggle]').click()");
   await until("!document.querySelector('[data-testid=storage-details-open]')?.disabled");
   await js("document.querySelector('[data-testid=compute-toggle]').click()");
   await until("document.querySelector('.runtime-list')?.textContent.includes('Ready')");
   await js("document.querySelector('[data-testid=science-sample]').value='si-diamond'");
   await click('Import sample');
   await until("document.querySelector('.structure-summary')?.textContent.includes('8')");
   await js("document.querySelector('[data-testid=compute-toggle]').click()");
   await until("!document.querySelector('[data-testid=atomistic-run-panel]')");
   features={idleDetailsNoPolling:true,bilingualExamples:true,loadActionVisible:true,discoveryOnDemand:true,storageOnDemand:true,computeOnDemand:true,siliconImport:true};
  }
  const report={...overview,statusMs,features};
  const out=resolve('runtime/ui-layout/catalog-performance');mkdirSync(out,{recursive:true});
  writeFileSync(join(out,process.argv.includes('--assert')?'after.json':'before.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));code=0;
 }catch(e){console.error(e.stack);}finally{
  const win=BrowserWindow.getAllWindows()[0];
  if(win)await win.webContents.executeJavaScript(`(async()=>{const c=await window.materialsx.getMcpConfiguration();if(c.enabled)await window.materialsx.saveMcpConfiguration({...c,enabled:false,revision:c.revision+1},c.revision);})()`).catch(()=>{});
  for(const w of BrowserWindow.getAllWindows())w.destroy();rmSync(temp,{recursive:true,force:true});app.exit(code);
 }
})();
