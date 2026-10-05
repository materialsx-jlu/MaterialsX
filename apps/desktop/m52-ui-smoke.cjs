process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';
// Actual built main/preload/Vue with synthetic data and an explicitly consenting test harness.
const {app,BrowserWindow,shell,dialog}=require("electron");
const {mkdtempSync,rmSync,writeFileSync,mkdirSync}=require("node:fs");const {tmpdir}=require("node:os");const {join,resolve}=require("node:path");const {pathToFileURL}=require("node:url");
const url=process.env.MATERIALSX_IDENTITY_FIXTURE_URL,email=process.env.MATERIALSX_IDENTITY_FIXTURE_EMAIL,password=process.env.MATERIALSX_IDENTITY_FIXTURE_PASSWORD;
if(!url||!email||!password)throw new Error("requires isolated m5:gateway:live --electron fixture");
const dir=mkdtempSync(join(tmpdir(),"mx-cloud-ui-")),project=join(dir,"project"),file=join(project,"silicon.txt");mkdirSync(project);writeFileSync(file,"Synthetic silicon atomic number 14; no research data");app.setPath("userData",join(dir,"user-data"));process.env.MATERIALSX_IDENTITY_URL=url;
let openCalls=0,approved=0,deny=true;const consentDetails=[];
dialog.showOpenDialog=async()=>({canceled:false,filePaths:++openCalls===1?[project]:[file]});
dialog.showMessageBox=async(_window,options)=>{
 if(options.title!=="确认本轮云端数据范围"||!options.detail.includes("采购成本")||!options.detail.includes("同账户")||!options.message.includes("gpt-5.6-sol"))throw new Error("cloud review missing");
 consentDetails.push({selected:options.detail.includes("silicon.txt"),skills:options.detail.includes("pymatgen"),target:options.message});if(deny)return {response:0,checkboxChecked:false};approved++;return {response:1,checkboxChecked:false};
};
shell.openExternal=async authorization=>{
 if(new URL(authorization).origin!==url)throw new Error("foreign auth");const page=await fetch(authorization),html=await page.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];if(!csrf)throw new Error("no auth CSRF");
 const response=await fetch(authorization,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:url,Cookie:page.headers.get("set-cookie").split(";")[0]},body:new URLSearchParams({csrf,email,password,approve:"yes"})});if(response.status!==303||(await fetch(response.headers.get("location"))).status!==200)throw new Error("auth failed");
};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let status=1;try{
 await import(pathToFileURL(resolve("dist/apps/desktop/main/index.js")).href);
 let window;for(let i=0;i<100;i++){window=BrowserWindow.getAllWindows()[0];if(window&&!window.webContents.isLoadingMainFrame())break;await pause(100)}if(!window)throw new Error("no window");await pause(400);
 const js=code=>window.webContents.executeJavaScript(code);
 await js(`window.materialsx.loginAccount()`);const account=await js(`window.materialsx.getAccount()`);if(account.status!=="connected")throw new Error("no login");
 await js(`document.querySelector('button[aria-label="添加项目"]').click()`);await pause(250);
 let data=await js(`window.materialsx.bootstrap()`);const projectId=data.projects.find(p=>p.path===project)?.id;if(!projectId)throw new Error("project not registered");
 // Use the visible composer to create a conversation and exercise denied native consent.
 await js(`(()=>{const t=document.querySelector('textarea');t.value='Read synthetic silicon';t.dispatchEvent(new Event('input',{bubbles:true}))})()`);await pause(40);await js(`document.querySelector('.send-button').click()`);await pause(500);
 data=await js(`window.materialsx.bootstrap()`);const conversationId=data.conversations.find(c=>c.projectId===projectId)?.id;if(!conversationId)throw new Error("no conversation");
 const before=await js(`window.materialsx.getCloudRun(${JSON.stringify(conversationId)})`);if(before!==null)throw new Error("denied request dispatched");
 deny=false;await js(`window.materialsx.chooseCloudFiles(${JSON.stringify(projectId)},${JSON.stringify(conversationId)})`);
 let streaming=0;await js(`window.__cloudDelta=0;window.materialsx.onMessageStream(e=>{if(e.type==='delta')window.__cloudDelta++})`);
 await js(`(()=>{const t=document.querySelector('textarea');t.value='@pymatgen Read the approved synthetic silicon file before answering';t.dispatchEvent(new Event('input',{bubbles:true}))})()`);await pause(40);await js(`document.querySelector('.send-button').click()`);
 let run=null;for(let i=0;i<100;i++){run=await js(`window.materialsx.getCloudRun(${JSON.stringify(conversationId)})`);if(run?.task.state==="completed")break;await pause(100)}
 if(run?.task.state!=="completed"||run.requests.length!==2||!run.requests.every(r=>r.usage?.inputTokens===10))throw new Error("desktop tool flow failed");
 streaming=await js(`window.__cloudDelta`);if(streaming<1||!consentDetails.some(d=>d.selected&&d.skills))throw new Error("stream/selection review missing");
 await pause(500);const body=await js(`document.body.innerText`);if(!body.includes("14")||!body.includes("tokens"))throw new Error("answer/usage not rendered");
 mkdirSync(resolve("runtime/m52"),{recursive:true});const screenshot=await window.webContents.capturePage();writeFileSync(resolve("runtime/m52/platform-chat.png"),screenshot.toPNG());
 // Slow synthetic upstream proves the real desktop cancel button updates local state.
 await js(`(()=>{const t=document.querySelector('textarea');t.value='slow-fixture';t.dispatchEvent(new Event('input',{bubbles:true}))})()`);await pause(40);await js(`document.querySelector('.send-button').click()`);await pause(700);
 const start=Date.now();await js(`document.querySelector('.send-button.stopping').click()`);let stopped=false;
 for(let i=0;i<50;i++){if(!(await js(`Boolean(document.querySelector('.send-button.stopping'))`))){stopped=true;break}await pause(40)}
 if(!stopped)throw new Error("desktop did not stop");const evidence={platform:process.platform,electron:process.versions.electron,realBuiltDesktop:true,syntheticProvider:true,consentDenialNoDispatch:true,approvedSelections:true,requests:2,streamingDeltas:streaming,usageVisible:true,localCancelMs:Date.now()-start,upstreamCancelVerified:false};
 writeFileSync(resolve("runtime/m52/desktop-validation.json"),JSON.stringify(evidence,null,2)+"\n");console.log(JSON.stringify(evidence));status=0;
}catch(e){console.error("M5.2 desktop fixture failed:",e.message)}finally{for(const w of BrowserWindow.getAllWindows())w.destroy();app.quit();rmSync(dir,{recursive:true,force:true});app.exit(status)}})();
