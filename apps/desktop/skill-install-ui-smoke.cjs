// Real main/preload/renderer with isolated data; no LLM account or model is needed to install a Skill.
process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';process.env.MATERIALSX_IDENTITY_URL='http://127.0.0.1:1';delete process.env.MATERIALSX_RENDERER_URL;
const {app,BrowserWindow,dialog}=require('electron');const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join,resolve}=require('node:path');const {pathToFileURL}=require('node:url');const assert=require('node:assert/strict');
const temp=mkdtempSync(join(tmpdir(),'mx-skill-chat-ui-')),project=join(temp,'project'),source=join(temp,'skill source');mkdirSync(project);mkdirSync(source);
writeFileSync(join(source,'SKILL.md'),'---\nname: installed-chat-fixture\ndescription: Test installed Skill from actual chat.\ndescription_zh: 验证真实对话安装的 Skill。\nlicense: MIT\n---\n\nRead the supplied input and report missing conditions.\n');
app.setPath('userData',join(temp,'state'));dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let code=1;try{
 await import(pathToFileURL(resolve('dist/apps/desktop/main/index.js')).href);let win;
 for(let i=0;i<300;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await pause(50);}assert(win);
 const result=await win.webContents.executeJavaScript(`(async()=>{
   await window.materialsx.chooseProjectFolder();const initial=await window.materialsx.bootstrap(),project=initial.projects[0];
   const c=await window.materialsx.createConversation(project.id),events=[];let changes=0;
   window.materialsx.onMessageStream(e=>events.push(e));window.materialsx.onSkillsChanged(()=>changes++);
   const help=await window.materialsx.sendMessage({projectId:project.id,conversationId:c.id,content:'你可以自己安装 skill吗'});
   const beforeInstall=await window.materialsx.listInstalledSkills();
   const messages=await window.materialsx.sendMessage({projectId:project.id,conversationId:c.id,content:'安装 Skill '+${JSON.stringify(source)}});
   const after=await window.materialsx.bootstrap();const installed=await window.materialsx.listInstalledSkills();
   const again=await window.materialsx.sendMessage({projectId:project.id,conversationId:c.id,content:'Install Skill installed-chat-fixture'});
   await window.materialsx.enableInstalledSkill('installed-chat-fixture',false);const disabled=(await window.materialsx.bootstrap()).skills.find(s=>s.name==='installed-chat-fixture');
   await window.materialsx.enableInstalledSkill('installed-chat-fixture',true);const enabled=(await window.materialsx.bootstrap()).skills.find(s=>s.name==='installed-chat-fixture');
   return {mode:initial.settings.mode,help,beforeInstall,messages,events,changes,installed,skill:after.skills.find(s=>s.name==='installed-chat-fixture'),again,disabled,enabled,runs:after.runs};
 })()`);
 assert.equal(result.mode,'platform');assert(result.messages.some(m=>m.role==='assistant'&&m.status==='complete'&&m.content.includes('安装完成')));
 assert.equal(result.beforeInstall.length,0);const help=result.help.at(-1).content;assert(help.startsWith('可以。'));assert(help.includes('安装 Skill frontend-design'));assert(!help.includes('skill_installer'));
 assert(result.skill.enabled);assert.equal(result.installed.length,1);assert(!result.events.some(e=>e.type==='error'));assert(result.events.some(e=>e.type==='complete'));
 assert(result.again.some(m=>m.role==='assistant'&&m.content.includes('已安装，可直接使用')));assert.equal(result.disabled.enabled,false);assert.equal(result.enabled.enabled,true);
 assert(result.runs.some(r=>r.status==='completed'));assert(result.changes>=1);
 const out=resolve('runtime/agent/skill-install');mkdirSync(out,{recursive:true});writeFileSync(join(out,'desktop-ui.json'),JSON.stringify({passed:true,realChatIpc:true,noModelInference:true,result},null,2));
 console.log('Real chat installation passed: no model/account required, persisted index, streamed completion, duplicate handling and enable/disable.');code=0;
}catch(e){console.error(e.stack);}finally{for(const w of BrowserWindow.getAllWindows())w.destroy();rmSync(temp,{recursive:true,force:true});app.exit(code);}})();
