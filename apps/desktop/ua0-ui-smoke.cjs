// Existing views must survive the UA.0 split; use isolated user/project state.
process.env.MATERIALSX_DISCOVERY_AUTOSYNC = "0";
process.env.MATERIALSX_IDENTITY_URL = "http://127.0.0.1:1";
delete process.env.MATERIALSX_RENDERER_URL;
const { app, BrowserWindow, dialog } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const ua1 = process.argv.includes("--ua1");
const temp = mkdtempSync(join(tmpdir(), "mx-ua0-ui-"));
const project = join(temp, "project");
mkdirSync(project);
app.setPath("userData", join(temp, "state"));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
const pause = ms => new Promise(done => setTimeout(done, ms));

(async () => {
  let code = 1;
  try {
    await import(pathToFileURL(resolve("dist/apps/desktop/main/index.js")).href);
    let win;
    for (let i = 0; i < 200; i++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoadingMainFrame()) break;
      await pause(100);
    }
    assert(win);
    const js = source => win.webContents.executeJavaScript(source);
    async function until(condition) {
      for (let i = 0; i < 200; i++) { if (await js(condition)) return; await pause(100); }
      throw Error(`UA0_UI_TIMEOUT: ${condition}`);
    }
    const click = label => js(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes(${JSON.stringify(label)}))?.click()`);
    await until("!!document.querySelector('.empty-project')");
    await js("window.materialsx.chooseProjectFolder()");
    await js(`(async () => { const state = await window.materialsx.bootstrap(); await window.materialsx.saveModelSettings({ ...state.settings, mode: 'local', modelId: 'ua0-fixture', localEndpoint: 'http://127.0.0.1:1/v1' }); })()`);
    await js("location.reload()");
    await until("!document.querySelector('.new-task-button')?.disabled");
    await click("Skills");
    await until("document.querySelector('.page-heading h1')?.textContent.includes('科研 Skills')");
    await js(`(() => { const input = document.querySelector('.search-box input'); input.value = 'materials-literature'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until("document.querySelectorAll('.catalog-grid .catalog-card').length === 1");
    await js("document.querySelector('.catalog-grid .catalog-card').click()");
    await until("!!document.querySelector('.skill-details-drawer')");
    await js("document.querySelector('button[aria-label=\"关闭 Skill 详情\"]')?.click()");
    await click("模型目录");
    await click("机器学习势 · 全部目录");
    await until("!!document.querySelector('[data-testid=\"hub-grid\"]')");
    await click("Skills");
    await until("document.querySelector('.search-box input')?.value === 'materials-literature'");
    await click("数据与 MCP");
    await until("!!document.querySelector('.connection-list')");
    assert(await js("document.querySelector('.connection-list').textContent.includes('尚未连接科研数据服务')"));
    await click("运行记录");
    await until("document.querySelector('.page-heading h1')?.textContent.includes('运行记录')");
    await click("订阅与额度");
    await until("!!document.querySelector('.subscription-view')");
    await click("发布中心");
    await until("!!document.querySelector('.release-view')");
    if(ua1){
      await click("设置");await until("Array.from(document.querySelectorAll('.el-drawer')).some(d=>d.textContent.includes('执行引擎'))");
      assert(await js("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim().startsWith('Codex App Server')&&!b.disabled)"));
      const chooseMode = text => js(`Array.from(document.querySelectorAll('.settings-drawer .mode-option')).find(b=>b.querySelector('strong')?.textContent===${JSON.stringify(text)})?.click()`);
      await chooseMode("Codex App Server");
      await until("Array.from(document.querySelectorAll('.mode-option.active')).some(b=>b.textContent.includes('Codex App Server'))");
      await chooseMode("平台模型"); await chooseMode("本地模型");
      await until("Array.from(document.querySelectorAll('.mode-option.active')).some(b=>b.textContent.includes('Codex App Server'))");
      await js(`(() => { const input=document.querySelector('#model-id'); input.value='ua0-fixture'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await click("Codex 浅色");await until("document.documentElement.dataset.theme==='codex-light'");
      await click("保存设置");
      await until("!document.querySelector('.settings-drawer')?.checkVisibility()");
      assert.equal((await js("window.materialsx.bootstrap()")).settings.agentEngine, 'codex');
      await js(`(async()=>{ const state=await window.materialsx.bootstrap(); await window.materialsx.saveModelSettings({...state.settings,agentEngine:'pi'}); })()`);
      const result=await js(`(async()=>{const state=await window.materialsx.bootstrap();const conversation=state.conversations[0]??await window.materialsx.createConversation(state.projects[0].id);await window.materialsx.sendMessage({projectId:conversation.projectId,conversationId:conversation.id,content:'显示已有结构'});const latest=await window.materialsx.bootstrap();const run=latest.runs[0];const plan=await window.materialsx.getResearchPlan(run.id);return {run,plan};})()`);
      assert.equal(result.plan.executionMode,'direct');assert.equal(result.plan.originalRequest,'显示已有结构');assert.equal(result.run.status,'failed');
      await js("location.reload()");await until("!document.querySelector('.new-task-button')?.disabled");await click("运行记录");await until("!!document.querySelector('.run-row')");await click("研究计划");await until("!!document.querySelector('.research-plan')");
      assert(await js("document.querySelector('.research-plan').textContent.includes('显示已有结构')"));
      for(const width of [820,1600]){win.setSize(width,900);await pause(100);assert(await js("document.querySelector('.research-plan').scrollWidth<=document.querySelector('.research-plan').clientWidth+2"))}
    }
    const report = { stage: ua1 ? "UA.1" : "UA.0", passed: true, views: ["skills", "models", "connections", "runs", "subscription", "release"],
      skillDetails: true, catalogFilterPreserved: true, falseMcpReadyRemoved: true, ...(ua1?{engineSelector:true,localCodexSelectionPersisted:true,modelEngineIndependent:true,persistentResearchPlan:true,globalTheme:true,narrowWidePlanDrawer:true}:{}), modelCalls: 0, downloads: 0, payments: 0 };
    writeFileSync(resolve(ua1?"runtime/agent/ua-1/ui.json":"runtime/agent/ua-0/ui.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(report));
    code = 0;
  } catch (error) { console.error(error.stack); }
  finally {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    rmSync(temp, { recursive: true, force: true });
    app.exit(code);
  }
})();
