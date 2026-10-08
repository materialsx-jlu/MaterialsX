// Isolated real Electron IPC/UI; no LLM, MOOS source mutation, payments or downloads.
process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';process.env.MATERIALSX_IDENTITY_URL='http://127.0.0.1:1';process.env.MATERIALSX_MOOS_MCP_DIRECTORY='/nonexistent/ua5-fixture';delete process.env.MATERIALSX_RENDERER_URL;
const {app,BrowserWindow,dialog}=require('electron');const {mkdtempSync,mkdirSync,rmSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path'),{tmpdir}=require('node:os'),{pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto'),assert=require('node:assert/strict');
const temp=mkdtempSync(join(tmpdir(),'mx-ua5-ui-')),projectPath=join(temp,'project');mkdirSync(projectPath);app.setPath('userData',join(temp,'state'));dialog.showOpenDialog=async()=>({canceled:false,filePaths:[projectPath]});
const pause=ms=>new Promise(r=>setTimeout(r,ms)),load=path=>import(pathToFileURL(resolve(path)).href);
(async()=>{let code=1;try{
 await load('dist/apps/desktop/main/index.js');let win;for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await pause(100);}assert(win);
 const js=source=>win.webContents.executeJavaScript(source);const until=async expression=>{for(let i=0;i<150;i++){if(await js(expression))return;await pause(100);}throw Error('UA5_UI_TIMEOUT '+expression);};
 await until('!!document.querySelector(".empty-project")');await js('window.materialsx.chooseProjectFolder()');

 const initial=await js('window.materialsx.getMcpConfiguration()');
 const disabled=await js(`window.materialsx.saveMcpConfiguration(${JSON.stringify({...initial,enabled:false,revision:initial.revision+1})},${initial.revision})`);assert.equal(disabled.enabled,false);
 const conflict=await js(`window.materialsx.saveMcpConfiguration(${JSON.stringify({...initial,enabled:false,revision:initial.revision+1})},${initial.revision}).then(()=>false,e=>String(e).includes('MCP_REVISION_CONFLICT'))`);assert(conflict);
 const noBuild=await js(`window.materialsx.saveMcpConfiguration(${JSON.stringify({...disabled,enabled:true,directory:'/nonexistent/ua5-fixture',revision:disabled.revision+1})},${disabled.revision}).then(()=>false,e=>String(e).includes('MOOS_MCP_SERVER_NOT_BUILT'))`);assert(noBuild);
 const matrix=await js('window.materialsx.getAgentMatrix()');assert.equal(matrix.rows.length,4);assert(matrix.rows.every(r=>r.status==='unverified'));assert.equal(matrix.schemaVersion,'ua5-capability-matrix-v1');
 const settings=await js('window.materialsx.bootstrap().then(b=>b.settings)');
 await js(`window.materialsx.saveModelSettings(${JSON.stringify({...settings,localProtocol:'chat-completions',localContextBudget:32768,localMaxOutputTokens:3200,cloudWorkspaceTools:true})})`);
 await js('location.reload()');await until('!document.querySelector(".new-task-button")?.disabled');
 const saved=await js('window.materialsx.bootstrap().then(b=>b.settings)');assert.equal(saved.localMaxOutputTokens,3200);assert.equal(saved.localContextBudget,32768);assert.equal(saved.localProtocol,'chat-completions');assert(saved.cloudWorkspaceTools);
 await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("数据与 MCP"))?.click()');await until('!!document.querySelector("[data-testid=agent-connections] .agent-grid article")');
 assert.equal(await js('document.querySelectorAll("[data-testid=agent-connections] .agent-grid article").length'),4);
 await js('Array.from(document.querySelectorAll("[data-testid=agent-connections] button")).find(b=>b.textContent==="English")?.click()');assert(await js('document.querySelector("[data-testid=agent-connections]").textContent.includes("Model & engine capabilities")'));
 for(const width of [820,1600]){win.setSize(width,900);await pause(120);assert(await js('document.querySelector("[data-testid=agent-connections]").scrollWidth<=document.querySelector("[data-testid=agent-connections]").clientWidth+2'));}
 const report={stage:'UA.5',ipc:true,bilingual:true,fourCombinationMatrix:true,mcpRevisionCAS:true,invalidBuildDenied:true,settingsPersistence:true,narrowWide:true,modelCalls:0,payments:0};mkdirSync(resolve('runtime/agent/ua-5'),{recursive:true});writeFileSync(resolve('runtime/agent/ua-5/ui.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));code=0;
 }catch(e){console.error(e.stack);}finally{for(const w of BrowserWindow.getAllWindows())w.destroy();rmSync(temp,{recursive:true,force:true});app.exit(code);}})();
