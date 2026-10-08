process.env.MATERIALSX_DISCOVERY_AUTOSYNC = '0';
process.env.MATERIALSX_IDENTITY_URL = 'http://127.0.0.1:1';
process.env.MATERIALSX_MOOS_MCP_DIRECTORY = '/nonexistent/ua12';
delete process.env.MATERIALSX_RENDERER_URL;
const { app, BrowserWindow } = require('electron'), { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } = require('node:fs'), { join, resolve } = require('node:path'), { tmpdir } = require('node:os'), { pathToFileURL } = require('node:url'), { createServer } = require('node:http'), assert = require('node:assert/strict');
app.on('window-all-closed', () => { });
const temp = mkdtempSync(join(tmpdir(), 'mx-ua12-ui-')), project = join(temp, 'project'), userData = join(temp, 'state');
mkdirSync(project);
app.setPath('userData', userData);
const pause = ms => new Promise(r => setTimeout(r, ms)), moduleAt = p => import(pathToFileURL(resolve('dist', p)).href);
let browser, server, store;
(async () => {
    let code = 1;
    try {
        await app.whenReady();
        let origin;
        server = createServer((req, res) => {
            if (req.url === '/login') {
                res.setHeader('Set-Cookie', 'fixture-login=ok; HttpOnly; SameSite=Strict');
                res.writeHead(302, { Location: origin + '/' });
                res.end();
                return;
            }
            if (req.url === '/download') {
                if (!req.headers.cookie?.includes('fixture-login=ok')) {
                    res.writeHead(403);
                    res.end();
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="../../escape.sh"' });
                res.end('PVDF 298 K. Modulus not reported.');
                return;
            }
            if (req.url === '/redirect') {
                res.writeHead(302, { Location: 'http://127.0.0.1:1/private' });
                res.end();
                return;
            }
            if (req.url === '/large') {
                res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 9 * 1024 * 1024, 'Content-Disposition': 'attachment; filename="too-large.bin"' });
                res.end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<!doctype html><title>UA12 fixture</title><style>body{font:22px sans-serif;background:#eeeeff}canvas{background:white}</style><h1>PVDF source</h1><p>298 K; modulus missing</p><a href="/login">Manual login</a><a href="/download">Download evidence</a><a href="http://127.0.0.1:1/private">Forbidden private</a><canvas width="320" height="180"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillStyle="#d83232";c.fillRect(0,20,90,120);c.fillStyle="#2058d0";c.fillRect(120,60,130,80);</script>');
        });
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        origin = 'http://127.0.0.1:' + server.address().port;
        const { WorkspaceStore } = await moduleAt('apps/desktop/main/store.js'), { ResearchBrowser } = await moduleAt('apps/desktop/main/research-browser.js');
        store = new WorkspaceStore(join(userData, 'materialsx.sqlite'));
        const p = store.createProject(project);
        store.agentWorkspace.savePolicy(p.id, { subtasksEnabled: true, origins: [origin], shareBrowserContent: true });
        browser = new ResearchBrowser(store, userData, origin);
        console.log('UA12 browser opening');
        await browser.act(p.id, { action: 'open', url: origin + '/' });
        const page = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(origin));
        assert(page);
        assert.equal(page.webContents.getLastWebPreferences().sandbox, true);
        assert.equal(page.webContents.getLastWebPreferences().nodeIntegration, false);
        const read = await browser.act(p.id, { action: 'read' });
        assert.match(read.text, /PVDF/);
        assert.equal(read.pixelsRead, false);
        assert(!read.links.some(l => l.url.includes(':1/')));
        assert.equal(await page.webContents.executeJavaScript('typeof require'), 'undefined');
        // A real human-style login navigation in the visible isolated browser; LLM cannot fill credentials.
        console.log('UA12 browser manual fixture login');
        await page.loadURL(origin + '/login');
        await browser.act(p.id, { action: 'read' });
        const download = await browser.act(p.id, { action: 'download', url: origin + '/download' });
        assert.equal(readFileSync(join(project, download.path), 'utf8'), 'PVDF 298 K. Modulus not reported.');
        assert(download.path.endsWith('download.txt'));
        assert(!readFileSync(join(project, download.path), 'utf8').includes('fixture-login'));
        console.log('UA12 browser screenshot');
        const shot = await browser.act(p.id, { action: 'screenshot' });
        assert.equal(shot.mime, 'image/png');
        assert(shot.bytes > 1000);
        assert.equal((await browser.preview(p.id, shot.id)).kind, 'image');
        const pixels = await browser.pixels(p.id, shot.id);
        assert.equal(pixels.bytes[0], 255);
        assert.equal(pixels.bytes[1], 216);
        await assert.rejects(browser.act(p.id, { action: 'open', url: origin + '/redirect' }));
        await browser.act(p.id, { action: 'open', url: origin + '/' });
        await assert.rejects(browser.act(p.id, { action: 'open', url: 'file:///etc/passwd' }));
        await assert.rejects(browser.act(p.id, { action: 'click', selector: 'body' }), /READ_LINKS/);
        await assert.rejects(browser.act(p.id, { action: 'download', url: origin + '/large' }), /DENIED/);
        const cancelled = new AbortController();
        cancelled.abort();
        await assert.rejects(browser.act(p.id, { action: 'screenshot' }, cancelled.signal));
        const textPreview = await browser.preview(p.id, download.id);
        assert.equal(textPreview.kind, 'text');
        const assetCount = store.agentWorkspace.assets(p.id).length;
        assert.equal(assetCount, 2);
        // Reset the fixture-only origin before loading the product; persisted policies never allow loopback in production.
        await browser.dispose();
        store.agentWorkspace.savePolicy(p.id, { subtasksEnabled: true, origins: ['https://arxiv.org'], shareBrowserContent: false });
        store.close();
        store = null;
        console.log('UA12 product UI');
        await moduleAt('apps/desktop/main/index.js');
        let win;
        for (let i = 0; i < 250; i++) {
            win = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith(origin));
            if (win && !win.webContents.isLoadingMainFrame())
                break;
            await pause(100);
        }
        assert(win);
        const js = s => win.webContents.executeJavaScript(s), until = async (expr) => { for (let i = 0; i < 150; i++) {
            if (await js(expr))
                return;
            await pause(100);
        } throw Error('UA12_UI_TIMEOUT ' + expr); };
        await until('!document.querySelector(".new-task-button")?.disabled');
        await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("研究数据与交付"))?.click()');
        await until('!!document.querySelector("[data-testid=agent-workspace-tab]")');
        await js('document.querySelector("[data-testid=agent-workspace-tab]").click()');
        await until('document.querySelectorAll(".agent-workspace-panel .asset").length===2');
        assert(await js('document.querySelector("[data-testid=subtask-opt-in]").checked'));
        await js('Array.from(document.querySelectorAll(".agent-workspace-panel .asset")).find(b=>b.textContent.includes("image/png")).click()');
        await until('!!document.querySelector(".agent-workspace-drawer img")');
        for (const theme of ['materials-dark', 'codex-light'])
            for (const width of [820, 1600]) {
                win.setSize(width, 900);
                await js('document.documentElement.dataset.theme=' + JSON.stringify(theme));
                await pause(450);
                assert(await js('document.querySelector(".agent-workspace-panel").scrollWidth<=document.querySelector(".agent-workspace-panel").clientWidth+2'));
                assert(await js('(()=>{const panel=document.querySelector(".agent-workspace-panel").getBoundingClientRect();return panel.right<=innerWidth+2&&Array.from(document.querySelectorAll(".agent-workspace-panel .card")).every(e=>e.getBoundingClientRect().right<=panel.right+2)})()'));
                const colors = await js('({drawer:getComputedStyle(document.querySelector(".agent-workspace-drawer")).backgroundColor,card:getComputedStyle(document.querySelector(".agent-workspace-panel .card")).backgroundColor,classes:document.querySelector(".agent-workspace-drawer").className})');
                assert.equal(colors.drawer, colors.card, JSON.stringify(colors));
            }
        await js('document.querySelector(".agent-workspace-drawer .el-drawer__close-btn").click()');
        await pause(300);
        await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="English")?.click()');
        await until('document.querySelector(".agent-workspace-panel").textContent.includes("Research subtasks & browser")');
        const output = resolve('runtime/agent/ua-12');
        mkdirSync(output, { recursive: true });
        writeFileSync(join(output, 'workspace.png'), (await win.webContents.capturePage()).toPNG());
        await js('Array.from(document.querySelectorAll(".agent-workspace-panel button")).find(b=>b.textContent.includes("Use delegation example"))?.click()');
        await pause(200);
        assert(await js('Array.from(document.querySelectorAll("textarea")).some(e=>e.value.includes("delegate an independent"))'));
        writeFileSync(join(output, 'ui.json'), JSON.stringify({ passed: true, actualBrowser: true, manualFixtureLogin: true, authenticatedDownload: true, screenshotPixels: true, modelPixelQualification: false, noNodeIntegration: true, redirectAndUnapprovedUrlsDenied: true, assetHashPreview: true, bilingual: true, themes: ['materials-dark', 'codex-light'], widths: [820, 1600], exampleCopied: true }, null, 2) + '\n');
        code = 0;
        console.log('UA12 actual Electron browser/login/download/screenshot/preview/bilingual/theme/layout passed');
    }
    catch (e) {
        console.error(e);
    }
    finally {
        await browser?.dispose();
        store?.close();
        await new Promise(r => server ? server.close(r) : r());
        for (const w of BrowserWindow.getAllWindows())
            w.destroy();
        rmSync(temp, { recursive: true, force: true });
        app.exit(code);
    }
})();
