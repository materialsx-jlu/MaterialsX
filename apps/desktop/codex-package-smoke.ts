import { app } from "electron";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CodexEngine } from "../../packages/agent/src/codex-engine.js";
import { codexRuntime } from "../../packages/agent/src/codex-runtime.js";
import { HostMcp } from "../../packages/agent/src/host-mcp.js";
import {
  permissionGrantSchema,
  taskRefSchema,
} from "../../packages/contracts/src/agent.js";
import { composerResponse } from "../../fixtures/agent/composer-response.js";
const dir = process.env.MATERIALSX_BUNDLE_SMOKE_DIR ?? "";
if (!dir) throw Error("ISOLATED_TEST_DIRECTORY_REQUIRED");
app.setPath("userData", join(dir, "electron-data"));
async function runSmoke() {
  let mcp: HostMcp | undefined;
  try {
    assert(
      app.isPackaged,
      "Test must start from an actual packaged Electron application",
    );
    const location = { packaged: true, resourcesPath: process.resourcesPath };
    const runtime = codexRuntime(location);
    assert(runtime.binary.startsWith(process.resourcesPath));
    assert(!runtime.path.includes("homebrew"));
    const project = join(dir, "project");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "probe.txt"), "before\n");
    mcp = new HostMcp({
      files: [],
      skills: [
        {
          id: "bundle-fixture",
          name: "fixture",
          text: "Bundle fixture evidence",
          sha256: "a".repeat(64),
        },
      ],
    });
    await mcp.start();
    const projectId = randomUUID(),
      conversationId = randomUUID();
    let round = 0;
    const receipts: any[] = [],
      requests: any[] = [];
    const patch =
      "*** Begin Patch\n*** Update File: probe.txt\n@@\n-before\n+after\n*** End Patch";
    const engine = new CodexEngine({
      runtime: location,
      home: join(dir, "agent-home"),
      maxOutput: 512,
      mcp: { url: mcp.url, token: mcp.token, tools: mcp.toolNames },
      invoke: async (payload) => {
        requests.push(payload);
        assert.equal((payload as any).model, "materials-research");
        round++;
        assert(round <= 4);
        return composerResponse(
          round,
          round === 1
            ? 'text(await tools.exec_command({cmd:"rg before probe.txt; command -v rg; if command -v node >/dev/null 2>&1; then exit 21; fi",max_output_tokens:500,login:false}));'
            : round === 2
              ? `text(await tools.apply_patch(${JSON.stringify(patch)}));text(await tools.mcp__materialsx__read_skill({name:"bundle-fixture"}));`
              : null,
        );
      },
    });
    const result = await engine.run({
      projectPath: project,
      content:
        "显示 probe.txt，然后修改 before 为 after，读取 bundle-fixture Skill。",
      task: taskRefSchema.parse({
        projectId,
        conversationId,
        taskId: randomUUID(),
      }),
      grant: permissionGrantSchema.parse({
        projectId,
        conversationId,
        grantId: randomUUID(),
        permissions: ["read", "search", "terminal", "patch"],
        approvedBy: "native-dialog",
        maxCredits: "1",
        maxSeconds: 90,
      }),
      onEvent: (event) => {
        if (event.type === "receipt") receipts.push(event.receipt);
      },
    });
    assert.equal(result.state, "completed_with_limitations");
    assert.equal(await readFile(join(project, "probe.txt"), "utf8"), "after\n");
    assert(
      receipts.some((r) => r.kind === "commandExecution" && r.exitCode === 0),
      JSON.stringify(receipts),
    );
    assert(
      JSON.stringify(requests).includes(runtime.root + "/codex-path/rg"),
      "terminal must use bundled ripgrep",
    );
    assert(receipts.some((r) => r.kind === "fileChange"));
    assert(receipts.some((r) => r.kind === "mcpToolCall"));
    const report = {
      passed: true,
      packagedElectron: app.isPackaged,
      runtimeVersion: "0.160.0",
      runtimeInsideMaterialsX: true,
      systemCodexRequired: false,
      systemNodeRequired: false,
      globalPathExcluded: true,
      nativeComposer: true,
      terminal: true,
      patch: true,
      mcp: true,
      transport: "scripted Responses",
      intelligenceValidated: false,
      modelCalls: 0,
      packagedBinary: runtime.binary,
      rounds: round,
    };
    await writeFile(
      join(dir, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
    await mcp.close();
    app.exit(0);
  } catch (error) {
    console.error(error);
    await mcp?.close();
    app.exit(1);
  }
}
void app
  .whenReady()
  .then(runSmoke)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
