// Isolated UI fixture. No model calls, payments, MOOS writes or user-state changes.
process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';process.env.MATERIALSX_IDENTITY_URL='http://127.0.0.1:1';delete process.env.MATERIALSX_RENDERER_URL;
const {app,BrowserWindow,dialog}=require('electron');
const {mkdtempSync,mkdirSync,rmSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');const {tmpdir}=require('node:os');const {pathToFileURL}=require('node:url');const {randomUUID}=require('node:crypto');const assert=require('node:assert/strict');
const temp=mkdtempSync(join(tmpdir(),'mx-ua3-ui-')),project=join(temp,'project');mkdirSync(project);app.setPath('userData',join(temp,'state'));
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]});
const pause=ms=>new Promise(r=>setTimeout(r,ms));const load=path=>import(pathToFileURL(resolve(path)).href);
(async()=>{let code=1;try{
 await load('dist/apps/desktop/main/index.js');let win;for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await pause(100);}assert(win);
 const js=source=>win.webContents.executeJavaScript(source);const until=async expression=>{for(let i=0;i<200;i++){if(await js(expression))return;await pause(100);}throw Error('UA3_UI_TIMEOUT '+expression);};
 await until('!!document.querySelector(".empty-project")');await js('window.materialsx.chooseProjectFolder()');
 const {WorkspaceStore}=await load('dist/apps/desktop/main/store.js'),{TaskSupervisor}=await load('dist/packages/agent/src/task-supervisor.js'),{directPlan}=await load('dist/packages/agent/src/research-planning.js');
 const store=new WorkspaceStore(join(temp,'state','materialsx.sqlite'));const p=store.listProjects()[0],c=store.createConversation(p.id),run=store.addRun(p.id,'UA.3 回执核对示例','failed');
 const task={taskId:run.id,projectId:p.id,conversationId:c.id},grant={grantId:randomUUID(),projectId:p.id,conversationId:c.id,permissions:['read','search','terminal','patch'],approvedBy:'local-user',maxCredits:null,maxSeconds:600};
 const context={task,grant,methods:new Map([['engine.execute',[]]])};
 const control=new TaskSupervisor({context,engine:'pi',connectionId:'model-'+ 'a'.repeat(32),accountRef:'local',projectPath:project,persist:(s,v,e)=>store.agentJournal.save(s,v,e),savePlan:p=>store.saveResearchPlan(p),saveResult:(h,v)=>store.agentJournal.result(run.id,h,v),readResult:h=>store.agentJournal.readResult(run.id,h)});
 control.acceptPlan(directPlan('显示执行记录',context));control.beforeTool({id:'fixture-submit',name:'bash',args:{command:'fixture'},permissions:['terminal']});control.afterTool('fixture-submit',{runId:'fixture-job',status:'queued'},false);control.finish('failed','测试夹具：计算回执尚待核对');
 store.saveEngineSession({task,accountRef:'local',nativeSessionId:null,connection:{id:'model-'+ 'a'.repeat(32),source:'local',modelId:'fixture',endpoint:'http://127.0.0.1:1/v1',protocol:'chat-completions',contextWindow:65536,maxOutputTokens:4096,revision:'fixture'},selection:{engine:'pi',engineVersion:'0.99.1',modelConnectionRef:'model-'+ 'a'.repeat(32),compatibilityRef:'compat-'+ 'b'.repeat(32),selectedBy:'user'}});store.close();
 await js('location.reload()');await until('!document.querySelector(".new-task-button")?.disabled');await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("运行记录"))?.click()');await until('!!document.querySelector(".run-row")');await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("研究计划"))?.click()');await until('!!document.querySelector("[data-testid=task-execution]")');
 assert.equal((await js(`window.materialsx.getTaskExecution(${JSON.stringify(run.id)})`)).attempts.length,1);
 await js('Array.from(document.querySelectorAll("[data-testid=task-execution] button")).find(b=>b.textContent.includes("核对任务回执"))?.click()');await pause(300);
 await js('Array.from(document.querySelectorAll("[data-testid=task-execution] button")).find(b=>b.textContent.includes("恢复原引擎"))?.click()');await until('document.querySelector("[data-testid=task-execution] [role=alert]")?.textContent.includes("待核对")');
 const actual=await js(`window.materialsx.getTaskExecution(${JSON.stringify(run.id)})`);assert.equal(actual.attempts.length,1);assert.equal(actual.requests.length,0);
 for(const width of [820,1600]){win.setSize(width,900);await pause(100);assert(await js('document.querySelector("[data-testid=task-execution]").scrollWidth <= document.querySelector("[data-testid=task-execution]").clientWidth + 2'));}
 const report={stage:'UA.3',executionPanel:true,reconcileNoResubmission:true,unknownRecoveryBlocked:true,smallWideLayout:true,modelCalls:0,payments:0,downloads:0};mkdirSync(resolve('runtime/agent/ua-3'),{recursive:true});writeFileSync(resolve('runtime/agent/ua-3/ui.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));code=0;
}catch(error){console.error(error.stack);}finally{for(const win of BrowserWindow.getAllWindows())win.destroy();rmSync(temp,{recursive:true,force:true});app.exit(code);}})();
