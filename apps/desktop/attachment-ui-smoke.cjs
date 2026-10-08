// Real packaged renderer and main IPC; synthetic paper only, no model request.
process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';process.env.MATERIALSX_IDENTITY_URL='http://127.0.0.1:1';delete process.env.MATERIALSX_RENDERER_URL;
const {app,BrowserWindow,dialog}=require('electron');
const {mkdtempSync,mkdirSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join,resolve}=require('node:path');const {pathToFileURL}=require('node:url');const assert=require('node:assert/strict');
const temp=mkdtempSync(join(tmpdir(),'mx-attachment-ui-')),project=join(temp,'project'),pdf=resolve('tests/fixtures/agent/ua6-paper.pdf');mkdirSync(project);
app.setPath('userData',join(temp,'state'));let dialogs=0;dialog.showOpenDialog=async()=>({canceled:false,filePaths:dialogs++===0?[project]:[pdf]});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let code=1;try{
 await import(pathToFileURL(resolve('dist/apps/desktop/main/index.js')).href);
 let win;for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await pause(50)}assert(win);
 const js=source=>win.webContents.executeJavaScript(source);
 await js(`(async()=>{await window.materialsx.chooseProjectFolder();const state=await window.materialsx.bootstrap();await window.materialsx.createConversation(state.projects[0].id)})()`);
 await js('location.reload()');for(let i=0;i<200;i++){if(await js("!!document.querySelector('button[title^=\"添加研究附件\"]')"))break;await pause(50)}
 assert(await js("!!document.querySelector('button[title^=\"添加研究附件\"]')"));
 await js("document.querySelector('button[title^=\"添加研究附件\"]').click()");
 for(let i=0;i<200;i++){if(await js("document.querySelector('.composer-attachments')?.textContent.includes('ua6-paper.pdf')"))break;await pause(50)}
 assert(await js("document.querySelector('.composer-attachments')?.textContent.includes('页')"));
 const files=await js(`(async()=>{const s=await window.materialsx.bootstrap();return window.materialsx.listCloudFiles(s.conversations[0].id)})()`);
 assert.equal(files.length,1);assert.equal(files[0].format,'pdf');assert.ok(files[0].pageCount>=1);
 console.log('Unified attachment desktop smoke passed:',files[0].name,files[0].pageCount+' pages');code=0;
 }catch(error){console.error(error.stack)}finally{for(const win of BrowserWindow.getAllWindows())win.destroy();rmSync(temp,{recursive:true,force:true});app.exit(code)}})();
