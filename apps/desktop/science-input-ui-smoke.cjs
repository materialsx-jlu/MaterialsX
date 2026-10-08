// Actual desktop IPC and renderer; isolated user data, no inference or model downloads.
process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';
process.env.MATERIALSX_IDENTITY_URL='http://127.0.0.1:1';
delete process.env.MATERIALSX_RENDERER_URL;
const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const {mkdtempSync,mkdirSync,rmSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');const assert=require('node:assert/strict');
const temp=mkdtempSync(join(tmpdir(),'mx-science-input-ui-')),project=join(temp,'project');mkdirSync(project);
app.setPath('userData',join(temp,'state'));dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]});
const handle=ipcMain.handle.bind(ipcMain);let agentRequests=0;
ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{if(name==='agent:compatibility')agentRequests++;return fn(...args);});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let code=1;try{
  await import(pathToFileURL(resolve('dist/apps/desktop/main/index.js')).href);
  let win;for(let i=0;i<300;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await pause(50);}assert(win);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    await window.materialsx.chooseProjectFolder();const state=await window.materialsx.bootstrap(),project=state.projects[0];
    await window.materialsx.saveModelSettings({mode:'local',modelId:'openai/gpt-oss-20b',localEndpoint:'http://127.0.0.1:1234/v1',agentEngine:'codex'});
    const conversation=await window.materialsx.createConversation(project.id);
    const events=[];window.materialsx.onMessageStream(e=>events.push(e));
    const messages=await window.materialsx.sendMessage({projectId:project.id,conversationId:conversation.id,content:'自动选择合适的机器学习势，优先使用已安装模型，执行最多 3 步固定晶胞弛豫，输出能量、原子受力、收敛状态、报告和 3D 结构。'});
    const after=await window.materialsx.bootstrap();return {messages,events,runs:after.runs};
  })()`);
  assert(result.messages.some(m=>m.role==='assistant'&&m.status==='complete'&&m.content.includes('需要先选择本轮分析的原子结构')));
  assert(!result.events.some(e=>e.type==='error'));assert(result.events.some(e=>e.type==='complete'));
  assert(result.runs.some(r=>r.status==='blocked'));assert.equal(agentRequests,0);
  const out=resolve('runtime/agent/atomic-agent');mkdirSync(out,{recursive:true});writeFileSync(join(out,'input-ui.json'),JSON.stringify({passed:true,noErrorBanner:true,blockedRun:true,noModelInference:true,result},null,2));
  console.log('Actual desktop input guidance passed: normal assistant response, blocked run, no model inference.');code=0;
}catch(e){console.error(e.stack);}finally{for(const w of BrowserWindow.getAllWindows())w.destroy();rmSync(temp,{recursive:true,force:true});app.exit(code);}})();
