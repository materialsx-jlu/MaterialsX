// Isolated UI check for project conversations and persisted failed-run history.
process.env.MATERIALSX_DISCOVERY_AUTOSYNC = '0';
process.env.MATERIALSX_IDENTITY_URL = 'http://127.0.0.1:1';
process.env.MATERIALSX_MOOS_MCP_DIRECTORY = '/nonexistent/run-history-smoke';
delete process.env.MATERIALSX_RENDERER_URL;
const {app, BrowserWindow, dialog} = require('electron');
const {mkdtempSync, mkdirSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');
const temp = mkdtempSync(join(tmpdir(), 'mx-run-history-ui-'));
const project = join(temp, 'project');
mkdirSync(project);
app.setPath('userData', join(temp, 'state'));
dialog.showOpenDialog = async () => ({canceled: false, filePaths: [project]});
const pause = ms => new Promise(done => setTimeout(done, ms));

(async () => {
  let exitCode = 1;
  try {
    await import(pathToFileURL(resolve('dist/apps/desktop/main/index.js')).href);
    let window;
    for (let attempt = 0; attempt < 200; attempt++) {
      window = BrowserWindow.getAllWindows()[0];
      if (window && !window.webContents.isLoadingMainFrame()) break;
      await pause(100);
    }
    assert(window, 'desktop window opened');
    const js = source => window.webContents.executeJavaScript(source);
    async function until(condition) {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (await js(condition)) return;
        await pause(100);
      }
      throw Error(`UI_TIMEOUT: ${condition}`);
    }
    await until("!!document.querySelector('.empty-project')");
    assert.equal(await js("[...document.querySelectorAll('button')].some(button => button.textContent.includes('发布中心'))"), false);
    assert.equal(await js("[...document.querySelectorAll('button')].some(button => button.textContent.includes('云服务中心'))"), false);
    assert.equal(await js("[...document.querySelectorAll('button')].some(button => button.textContent.includes('研究数据与交付'))"), false);
    const chosen = await js('window.materialsx.chooseProjectFolder()');
    for (let index = 0; index < 8; index++) await js(`window.materialsx.createConversation(${JSON.stringify(chosen.id)})`);
    await js('location.reload()');
    await until("document.querySelectorAll('.project-conversation-row').length === 8");
    assert.equal(await js("document.querySelectorAll('.conversation-section .conversation-item').length"), 6);
    const result = await js(`(async () => {
      const state = await window.materialsx.bootstrap();
      const conversation = state.conversations[0];
      await window.materialsx.sendMessage({projectId: conversation.projectId, conversationId: conversation.id, content: '运行历史失败测试'});
      const latest = await window.materialsx.bootstrap();
      return window.materialsx.getRunHistory(latest.runs[0].id);
    })()`);
    assert.equal(result.run.status, 'failed');
    assert.equal(result.messages[0].content, '运行历史失败测试');
    assert.match(result.messages[1].content, /任务准备失败/);
    assert.equal(result.billingState, 'not-billed');
    await js('location.reload()');
    await until("document.querySelectorAll('.project-conversation-row').length === 8");
    await js("[...document.querySelectorAll('button')].find(button => button.textContent.includes('运行记录'))?.click()");
    await until("!!document.querySelector('.run-row')");
    assert.equal(await js("document.querySelector('[role=tab][aria-selected=true]')?.textContent.includes('任务记录')"), true);
    await js("[...document.querySelectorAll('.run-sections button')].find(button => button.textContent.includes('MX 点用量')).click()");
    await until("!!document.querySelector('.usage-history')");
    assert.equal(await js("document.querySelector('.usage-history').textContent.includes('旧积分用量与账单')"), false);
    assert.equal(await js("Math.abs(document.querySelector('.usage-history').getBoundingClientRect().width - document.querySelector('.run-sections').getBoundingClientRect().width) < 2"), true);
    await js("[...document.querySelectorAll('.run-sections button')].find(button => button.textContent.includes('任务记录')).click()");
    await until("!!document.querySelector('.run-row')");
    await js("document.querySelector('.run-row .run-actions .primary-button').click()");
    await until("document.querySelector('.run-history-drawer')?.textContent.includes('运行历史失败测试')");
    assert(await js("document.querySelector('.run-history-drawer').textContent.includes('任务准备失败')"));
    console.log(JSON.stringify({passed: true, projectConversations: 8, recentConversations: 6, failedRunDetail: true}));
    exitCode = 0;
  } catch (error) {
    console.error(error.stack);
  } finally {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    rmSync(temp, {recursive: true, force: true});
    app.exit(exitCode);
  }
})();
