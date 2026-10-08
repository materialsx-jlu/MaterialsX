process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';process.env.MATERIALSX_IDENTITY_URL='http://127.0.0.1:1';
process.env.MATERIALSX_MOOS_MCP_DIRECTORY='/nonexistent/ua7-fixture';delete process.env.MATERIALSX_RENDERER_URL;
const {app,BrowserWindow,dialog}=require('electron'),{mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path'),{tmpdir}=require('node:os'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const temp=mkdtempSync(join(tmpdir(),'mx-ua7-ui-')),projectPath=join(temp,'project');mkdirSync(projectPath);
app.setPath('userData',join(temp,'state'));let selected=projectPath;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});
for(const i of [1,2]){
  const data={observations:[{id:'y',property:'strength',value:2*i+3,unit:'MPa',conditions:{temperature:'300 K',method:'synthetic'},specimen_id:'specimen-'+i,evidence_ids:['ev']}],readEvidence:[{id:'ev',evidence_text:'Synthetic team-created source '+i+'; not an experimental measurement.'}]};
  writeFileSync(join(temp,'source-'+i+'.json'),JSON.stringify({title:'合成验收数据 / Synthetic fixture '+i,data}));
}
const pause=ms=>new Promise(r=>setTimeout(r,ms)),load=path=>import(pathToFileURL(resolve(path)).href);
(async()=>{let code=1;try{
  await load('dist/apps/desktop/main/index.js');let win;
  for(let i=0;i<250;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await pause(100);}assert(win);
  const js=s=>win.webContents.executeJavaScript(s),until=async expr=>{for(let i=0;i<300;i++){if(await js(expr))return;await pause(100);}throw Error('UA7_UI_TIMEOUT '+expr);};
  await until('!!document.querySelector(".empty-project")');await js('window.materialsx.chooseProjectFolder()');await js('location.reload()');
  await until('!document.querySelector(".new-task-button")?.disabled');
  const id=await js('window.materialsx.bootstrap().then(b=>b.projects[0].id)');
  for(const i of [1,2]){selected=join(temp,'source-'+i+'.json');await js('window.materialsx.importResearchData('+JSON.stringify(id)+')');}
  await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("研究数据与交付"))?.click()');
  await until('!!document.querySelector("[data-testid=quality-tab]")');await js('document.querySelector("[data-testid=quality-tab]").click()');
  await until('document.querySelectorAll(".method-card").length===4');
  await js('Array.from(document.querySelectorAll("[data-testid=scientific-quality] button")).find(b=>b.textContent.includes("检查选定数据"))?.click()');
  await until('document.querySelectorAll("[data-testid=scientific-quality] .record").length===1');
  assert(await js('document.querySelector("[data-testid=scientific-quality]").textContent.includes("保留限制，可继续研究")'));
  for(let i=0;i<2;i++)await js('Array.from(document.querySelectorAll("[data-testid=scientific-quality] button")).find(b=>b.textContent.includes("添加观测"))?.click()');
  await js('(()=>{const fields=document.querySelectorAll(".observation-row select");fields[1].selectedIndex=1;fields[1].dispatchEvent(new Event("change",{bubbles:true}));})()');
  await js('Array.from(document.querySelectorAll("[data-testid=scientific-quality] button")).find(b=>b.textContent.includes("检查方法可用性"))?.click()');
  await until('!!document.querySelector(".assessment input")');
  await js('(()=>{const input=document.querySelector(".assessment input");input.value="Same synthetic units and conditions; inspect independent reported values";input.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await js('document.querySelector(".assessment .primary-button").click()');
  await until('document.querySelectorAll("[data-testid=scientific-quality] .record").length===2');
  const overview=await js('window.materialsx.getScientificOverview('+JSON.stringify(id)+')');assert.equal(overview.analyses[0].result.mean,6);assert.equal(overview.analyses[0].scientificStatus,'needs_review');
  const report=overview.analyses[0].artifacts.find(a=>a.path.endsWith('.md'));
  const absolute=join(projectPath,report.path);assert(readFileSync(absolute,'utf8').includes('needs_review'));
  await js('Array.from(document.querySelectorAll("[data-testid=scientific-quality] .record button")).find(b=>b.textContent.includes("分析报告"))?.click()');
  await until('!!document.querySelector(".scientific-preview-drawer .markdown-content")');
  await pause(350);assert(await js('getComputedStyle(document.querySelector(".scientific-preview-drawer.el-drawer")).backgroundColor===getComputedStyle(document.querySelector(".quality-card")).backgroundColor'));mkdirSync(resolve('runtime/agent/ua-7'),{recursive:true});
  writeFileSync(resolve('runtime/agent/ua-7/analysis-preview.png'),(await win.webContents.capturePage()).toPNG());
  for(const width of [820,1600]){win.setSize(width,900);await pause(200);assert(await js('document.querySelector("[data-testid=scientific-quality]").scrollWidth<=document.querySelector("[data-testid=scientific-quality]").clientWidth+2'));assert(await js('document.querySelector(".scientific-preview-drawer .el-drawer__body").scrollWidth<=document.querySelector(".scientific-preview-drawer .el-drawer__body").clientWidth+2'));}
  await js('document.querySelector(".scientific-preview-drawer .el-drawer__close-btn").click()');
  await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="English")?.click()');
  assert(await js('document.querySelector("[data-testid=scientific-quality]").textContent.includes("Check the data, then select a method")'));
  const sources=await js('window.materialsx.getResearchProject('+JSON.stringify(id)+')');
  await js('window.materialsx.recordSourceNotice('+JSON.stringify(id)+','+JSON.stringify({snapshotId:sources.snapshots[0].id,kind:'corrected',reason:'Synthetic correction',replacementSnapshotId:sources.snapshots[1].id})+')');
  const changed=await js('window.materialsx.getScientificOverview('+JSON.stringify(id)+')');assert.equal(changed.analyses[0].status,'stale');assert.equal(changed.impact.analysisIds.length,1);
  const result={stage:'UA.7',realIPC:true,realImportedEvidence:true,actualNumericAnalysis:true,realFiles:true,bilingual:true,narrowWide:true,sourceImpact:true,scientificStatus:'needs_review',syntheticData:true,modelCalls:0,paidProviderCalls:0};
  writeFileSync(resolve('runtime/agent/ua-7/ui.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));code=0;
}catch(e){console.error(e.stack);}finally{for(const w of BrowserWindow.getAllWindows())w.destroy();rmSync(temp,{recursive:true,force:true});app.exit(code);}})();

