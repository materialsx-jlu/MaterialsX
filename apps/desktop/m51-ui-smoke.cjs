process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';
const {app,BrowserWindow,shell}=require("electron");const {mkdtempSync,rmSync,writeFileSync,mkdirSync,readFileSync}=require("node:fs");
const {tmpdir}=require("node:os");const {join,resolve}=require("node:path");const {pathToFileURL}=require("node:url");
const url=process.env.MATERIALSX_IDENTITY_FIXTURE_URL,email=process.env.MATERIALSX_IDENTITY_FIXTURE_EMAIL,password=process.env.MATERIALSX_IDENTITY_FIXTURE_PASSWORD;
if(!url||!email||!password)throw new Error("Requires identity fixture service; run m5:identity:live -- --electron");
const dir=mkdtempSync(join(tmpdir(),"mx-ui-smoke-"));app.setPath("userData",dir);process.env.MATERIALSX_IDENTITY_URL=url;
// Replace browser launch in this test only; exercise the real authorization page and callback.
shell.openExternal=async(authorization)=>{
 if(new URL(authorization).origin!==url)throw new Error("foreign authorization");
 const page=await fetch(authorization);const html=await page.text();const csrf=html.match(/name="csrf" value="([^"]+)"/)?.[1];
 if(!csrf||page.status!==200)throw new Error("login page failed");
 const response=await fetch(authorization,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:url,
 Cookie:page.headers.get("set-cookie").split(";")[0]},body:new URLSearchParams({csrf,email,password,approve:"yes"})});
 if(response.status!==303||(await fetch(response.headers.get("location"))).status!==200)throw new Error("browser authorization failed");
};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let status=1;
 try{
  await import(pathToFileURL(resolve("dist/apps/desktop/main/index.js")).href);
  let window;for(let i=0;i<100;i++){window=BrowserWindow.getAllWindows()[0];if(window&&!window.webContents.isLoadingMainFrame())break;await pause(100)}
  if(!window)throw new Error("desktop did not create window");await pause(500);
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='设置').click()`);
  await pause(500);
  const initial=await window.webContents.executeJavaScript(`window.materialsx.getAccount()`);
  if(initial.status!=="signed_out"||!initial.secureStorage)throw new Error("initial account view failed");
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='登录 / Sign in').click()`);
  let connected=false;
  for(let i=0;i<100;i++){const text=await window.webContents.executeJavaScript(`document.body.innerText`);if(text.includes("退出账户 / Sign out")){connected=true;break}await pause(100)}
  if(!connected)throw new Error("account did not connect through settings UI");
  const snapshot=await window.webContents.executeJavaScript(`window.materialsx.getAccount()`);
  if(snapshot.status!=="connected"||snapshot.user.email!==email||JSON.stringify(snapshot).includes("refreshToken"))throw new Error("renderer identity snapshot failed");
  const ciphertext=readFileSync(join(dir,"platform-session.bin"));if(ciphertext.includes("mx_rt_"))throw new Error("vault contains plaintext");
  const output=resolve("runtime/m51/account-panel.png");mkdirSync(resolve("runtime/m51"),{recursive:true});
  const screenshot=await window.webContents.capturePage();writeFileSync(output,screenshot.toPNG());
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='退出账户 / Sign out').click()`);
  for(let i=0;i<50;i++){if((await window.webContents.executeJavaScript(`window.materialsx.getAccount()`)).status==="signed_out"){status=0;break}await pause(100)}
  console.log(JSON.stringify({platform:process.platform,electron:process.versions.electron,settingsLogin:connected,encryptedVault:true,logout:status===0,fixtureOnly:true,screenshot:output}));
 }catch{console.error("M5.1 actual desktop UI verification failed");}
 finally{for(const window of BrowserWindow.getAllWindows())window.destroy();app.quit();rmSync(dir,{recursive:true,force:true});app.exit(status);}
})();
