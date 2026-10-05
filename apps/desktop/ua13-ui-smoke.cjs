console.log("UA13 UI script loaded");
process.env.MATERIALSX_DISCOVERY_AUTOSYNC = "0";
process.env.MATERIALSX_MOOS_MCP_DIRECTORY = "/nonexistent/ua13";
delete process.env.MATERIALSX_RENDERER_URL;
const { app, BrowserWindow, safeStorage } = require("electron"),
  { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs"),
  { join, resolve } = require("node:path"),
  { tmpdir } = require("node:os"),
  { pathToFileURL } = require("node:url"),
  { createServer, request } = require("node:http"),
  assert = require("node:assert/strict");
app.on("window-all-closed", () => {});
const temp = mkdtempSync(join(tmpdir(), "mx-ua13-ui-")),
  project = join(temp, "project"),
  userData = join(temp, "state");
mkdirSync(project);
app.setPath("userData", userData);
const pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  moduleAt = (p) => import(pathToFileURL(resolve("dist", p)).href);
let outer, fixture, store;
(async () => {
  let code = 1;
  try {
    await app.whenReady();
    console.log("UA13 Electron ready");
    const { teamFixture } = await moduleAt(
      "packages/agent/src/team/test-fixture.js",
    );
    fixture = teamFixture();
    const internal = await fixture.start();
    outer = createServer((req, res) => {
      if (req.url.startsWith("/v1/research/")) {
        const forward = request(
          internal + req.url,
          {
            method: req.method,
            headers: {
              ...req.headers,
              host: fixture.server.options.publicOrigin.slice("http://".length),
            },
          },
          (response) => {
            res.writeHead(response.statusCode, response.headers);
            response.pipe(res);
          },
        );
        forward.on("error", () => res.writeHead(503).end("{}"));
        req.pipe(forward);
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/auth/refresh") {
        res.end(
          JSON.stringify({
            tokenType: "Bearer",
            accessToken: "editor",
            refreshToken: "fixture-refresh",
            expiresIn: 900,
            deviceId: "test-device",
          }),
        );
        return;
      }
      if (req.url === "/v1/me") {
        res.end(
          JSON.stringify({
            id: "editor",
            email: "editor@example.invalid",
            displayName: "Team fixture",
            role: "user",
            status: "active",
            version: "1",
            deviceId: "test-device",
            mfaVerified: false,
          }),
        );
        return;
      }
      if (req.url === "/v1/devices") {
        res.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      }
      res.writeHead(404).end("{}");
    });
    await new Promise((r) => outer.listen(0, "127.0.0.1", r));
    const origin = "http://127.0.0.1:" + outer.address().port;
    fixture.server.options.publicOrigin = origin;
    process.env.MATERIALSX_IDENTITY_URL = origin;
    const { WorkspaceStore } = await moduleAt("apps/desktop/main/store.js"),
      { SystemCredentialVault } = await moduleAt(
        "apps/desktop/main/credential-vault.js",
      ),
      { digest } = await moduleAt("packages/agent/src/team/store.js");
    store = new WorkspaceStore(join(userData, "materialsx.sqlite"));
    const p = store.createProject(project);
    store.saveTeamLink(
      p.id,
      { enabled: true, remoteProjectId: fixture.project.id, revision: 2 },
      1,
    );
    const snapshot = {
      id: require("node:crypto").randomUUID(),
      projectId: p.id,
      origin: "moos",
      title: "PVDF controlled fixture",
      ref: fixture.upstream.ref(),
      sha256: digest(fixture.upstream.data()),
      version: "fixture-1",
      retrievedAt: new Date().toISOString(),
      reviewStatus: "verified",
      evidence: [
        {
          sourceId: "1",
          generation: "1",
          sha256: "e".repeat(64),
          locator: "e-1",
        },
      ],
      data: fixture.upstream.data(),
      receipts: [],
    };
    store.research.saveSnapshot(snapshot);
    const rp = store.research.project(p.id);
    store.research.saveProject(
      { ...rp, revision: rp.revision + 1, selected: [snapshot.id] },
      rp.revision,
    );
    store.close();
    store = null;
    const vault = new SystemCredentialVault(
      join(userData, "platform-session.bin"),
      safeStorage,
    );
    assert(vault.available());
    await vault.write({ origin, refreshToken: "fixture-refresh" });
    console.log("UA13 fixture/vault prepared");
    await moduleAt("apps/desktop/main/index.js");
    let win;
    for (let i = 0; i < 200; i++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoadingMainFrame()) break;
      await pause(100);
    }
    assert(win);
    const js = (s) => win.webContents.executeJavaScript(s),
      until = async (expr) => {
        for (let i = 0; i < 150; i++) {
          if (await js(expr)) return;
          await pause(100);
        }
        throw Error(
          "UA13_UI_TIMEOUT " +
            expr +
            " " +
            (await js(
              'JSON.stringify({errors:Array.from(document.querySelectorAll(".team-error")).map(e=>e.textContent),inputs:Array.from(document.querySelectorAll(".el-drawer input")).map(e=>({value:e.value,checked:e.checked}))})',
            )),
        );
      };
    console.log("UA13 product loaded");
    await until('!document.querySelector(".new-task-button")?.disabled');
    await js(
      'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("研究数据与交付"))?.click()',
    );
    await until('!!document.querySelector("[data-testid=team-tab]")');
    await js('document.querySelector("[data-testid=team-tab]").click()');
    await until(
      'document.querySelector("[data-testid=team-panel]")?.textContent.includes("Shared PVDF research")',
    );
    assert(
      await js(
        'document.querySelector("[data-testid=team-panel]").textContent.includes("编辑者")',
      ),
    );
    await js('document.querySelector("[data-testid=team-list]").click()');
    await until(
      'Array.from(document.querySelectorAll(".team-panel option")).some(e=>e.textContent.includes("Shared PVDF research"))',
    );
    await js('document.querySelector("[data-testid=team-propose]").click()');
    await until(
      '!!Array.from(document.querySelectorAll(".el-drawer")).find(e=>e.textContent.includes("提交数据纠错"))',
    );
    await js(
      `(()=>{const drawer=Array.from(document.querySelectorAll('.el-drawer')).find(e=>e.textContent.includes('提交数据纠错')),fields=drawer.querySelectorAll('input'),reason=drawer.querySelector('textarea');fields[2].value='15';fields[2].dispatchEvent(new Event('input',{bubbles:true}));reason.value='Checked against original paper page evidence';reason.dispatchEvent(new Event('input',{bubbles:true}));drawer.querySelector('input[type=checkbox]').click();})()`,
    );
    await pause(100);
    await js(
      'Array.from(document.querySelectorAll(".el-drawer button")).find(b=>b.textContent.includes("提交提议")).click()',
    );
    await until(
      'document.querySelector(".team-panel").textContent.includes("待审核")',
    );
    const proposal = fixture.store.corrections(fixture.project.id)[0];
    assert.equal(proposal.input.after, 15);
    assert.equal(proposal.authorId, "editor");
    await fixture.service.review(
      fixture.project.id,
      fixture.actor("reviewer"),
      proposal.id,
      {
        decision: "approve",
        expectedRevision: 1,
        reason: "Independent checked source evidence",
        humanConfirmed: true,
      },
      AbortSignal.timeout(5000),
    );
    await js(
      'Array.from(document.querySelectorAll(".team-heading button"))[0].click()',
    );
    await until(
      'document.querySelector(".team-panel").textContent.includes("等待 MOOS 更新")',
    );
    assert(
      !(await js(
        'Array.from(document.querySelectorAll(".correction-item button")).some(b=>b.textContent.includes("核验 MOOS 更新"))',
      )),
    ); // Editor cannot review own proposal.
    await js(
      'Array.from(document.querySelectorAll(".correction-item button")).find(b=>b.textContent.includes("导出回写包")).click()',
    );
    await until(
      'document.querySelector(".team-panel").textContent.includes("回写包已保存")',
    );
    for (const theme of ["materials-dark", "codex-light"])
      for (const width of [820, 1600]) {
        win.setSize(width, 950);
        await js(
          "document.documentElement.dataset.theme=" + JSON.stringify(theme),
        );
        await pause(400);
        assert(
          await js(
            'document.querySelector(".team-panel").scrollWidth<=document.querySelector(".team-panel").clientWidth+2',
          ),
        );
        assert(
          await js(
            '(()=>{const r=document.querySelector(".team-panel").getBoundingClientRect();return r.right<=innerWidth+2&&Array.from(document.querySelectorAll(".team-card")).every(e=>e.getBoundingClientRect().right<=r.right+2)})()',
          ),
        );
      }
    await js(
      'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="English")?.click()',
    );
    await until(
      'document.querySelector(".team-panel").textContent.includes("Team research")',
    );
    assert(
      await js(
        'document.querySelector(".team-panel").textContent.includes("Local model analysis only")',
      ),
    );
    const output = resolve("runtime/agent/ua-13");
    mkdirSync(output, { recursive: true });
    writeFileSync(
      join(output, "team.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    fixture.revoked.add("editor");
    await js(
      'Array.from(document.querySelectorAll(".team-heading button"))[0].click()',
    );
    await until(
      'document.querySelector(".team-panel").textContent.includes("Sign in to the platform")',
    );
    assert(
      !(await js(
        'document.querySelector(".team-panel").textContent.includes("15")',
      )),
    );
    writeFileSync(
      join(output, "ui.json"),
      JSON.stringify(
        {
          passed: true,
          fixture: true,
          realElectronIPC: true,
          m5Vault: true,
          proposal: true,
          independentReviewService: true,
          noSelfReview: true,
          realPacketFile: true,
          revocationMask: true,
          bilingual: true,
          themes: ["materials-dark", "codex-light"],
          widths: [820, 1600],
          productionQualification: false,
        },
        null,
        2,
      ) + "\n",
    );
    code = 0;
    console.log(
      "UA13 real Electron team panel, M5 vault, proposal/export, self-review denial, revocation and bilingual/theme layout passed",
    );
  } catch (e) {
    console.error(e);
  } finally {
    store?.close();
    outer?.closeAllConnections();
    if (outer) await new Promise((r) => outer.close(r));
    await fixture?.close();
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
    app.exit(code);
    setTimeout(
      () => rmSync(temp, { recursive: true, force: true }),
      10,
    ).unref();
  }
})();
