process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';
// Regression: actual Chromium HTML form navigation, not fetch with a forged Origin.
// Dedicated ephemeral desktop profile; reads only explicit loopback developer credentials.
const {app,BrowserWindow,shell}=require('electron');
const {readFileSync,mkdtempSync,rmSync,writeFileSync,chmodSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join,resolve}=require('node:path');const {pathToFileURL}=require('node:url');
const origin='http://127.0.0.1:8788',dir=mkdtempSync(join(tmpdir(),'mx-real-form-'));
const cfg=JSON.parse(readFileSync('runtime/m5-local/private-config.json','utf8'));
app.setPath('userData',dir);process.env.MATERIALSX_IDENTITY_URL=origin;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let postOrigin,callbackReferer,authorizationWin,formPolicyBlocked=false;
shell.openExternal=async authorization=>{
 if(new URL(authorization).origin!==origin)throw Error('foreign authorization');
 authorizationWin=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const contents=authorizationWin.webContents;
 contents.on('console-message',event=>{if(event.message.includes('Content Security Policy')&&event.message.includes('form-action'))formPolicyBlocked=true});
 contents.session.webRequest.onBeforeSendHeaders((details,done)=>{
  const u=new URL(details.url);
  if(u.origin===origin&&details.method==='POST'&&u.pathname.startsWith('/auth/desktop/'))postOrigin=details.requestHeaders.Origin;
  if(u.hostname==='127.0.0.1'&&u.pathname==='/auth/callback')callbackReferer=details.requestHeaders.Referer;
  done({requestHeaders:details.requestHeaders});
 });
 await authorizationWin.loadURL(authorization);
 // The browser, not the test, supplies cookies, Origin, Referer and navigation headers.
 await contents.executeJavaScript(`(()=>{const form=document.querySelector('form');if(!form)throw Error('login form missing');form.elements.email.value='developer@materialsx.local';form.elements.password.value=${JSON.stringify(cfg.userPassword)};form.elements.approve.checked=true;form.requestSubmit()})()`);
};
(async()=>{let exit=1;try{
 await import(pathToFileURL(resolve('dist/apps/desktop/main/index.js')).href);let desktop;
 for(let i=0;i<100;i++){desktop=BrowserWindow.getAllWindows().find(w=>w!==authorizationWin);if(desktop&&!desktop.webContents.isLoadingMainFrame())break;await sleep(100)}
 if(!desktop)throw Error('desktop not ready');await sleep(250);
 const result=await Promise.race([desktop.webContents.executeJavaScript('window.materialsx.loginAccount()'),sleep(15000).then(()=>{throw Error('browser login timed out')})]);
 if(result.status!=='connected'||result.user?.email!=='developer@materialsx.local')throw Error('real native form login did not connect');
 if(postOrigin!==origin)throw Error('browser did not send the expected same-origin Origin');
 if(callbackReferer!==undefined)throw Error('authorization flow URL leaked into callback Referer');
 await desktop.webContents.executeJavaScript('window.materialsx.logoutAccount()');
 const report={environment:'real-electron-chromium-main-preload-native-form',connected:true,nativeFormOrigin:true,callbackReferrerSuppressed:true,systemCredentialVault:true,logout:true,externalGeneration:false,generatedAt:new Date().toISOString()};
 writeFileSync('runtime/m5-local/native-form-validation.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});chmodSync('runtime/m5-local/native-form-validation.json',0o600);console.log(JSON.stringify(report));exit=0;
 }catch{console.error(JSON.stringify({error:'native-form-regression-failed',formPolicyBlocked,sameOriginObserved:postOrigin===origin,credentialsSuppressed:true}))}
 finally{for(const w of BrowserWindow.getAllWindows())w.destroy();rmSync(dir,{recursive:true,force:true});app.exit(exit)}
})();
