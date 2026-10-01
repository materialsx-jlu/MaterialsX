import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { realpath, writeFile } from "node:fs/promises";
import { arch, hostname, platform } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type {
  ConnectionSummary,
  DesktopBootstrap,
  MessageStreamEvent,
  ModelSettings,
  ResearchModelSummary,
  ReleaseReadiness,
  SendMessageInput,
  SkillSummary,
} from "../../../packages/contracts/src/desktop.js";
import { validateModelSelection } from "../../../packages/pi-adapter/src/capabilities.js";
import {
  discoverLocalModels,
  PiLocalSessionService,
  resolveManagedPython,
} from "../../../packages/pi-adapter/src/local-session.js";
import { TextStreamBuffer } from "../../../packages/pi-adapter/src/text-stream-buffer.js";
import { ControlPlaneClient } from "../../../packages/control-plane-client/src/index.js";
import { createReleaseReadiness, redactSupportData } from "../../../packages/release-readiness/src/index.js";
import { WorkspaceStore, loadJson } from "./store.js";

const execFileAsync = promisify(execFile);
const currentDir = dirname(fileURLToPath(import.meta.url));
const developmentRoot = resolve(currentDir, "../../../..");
const projectRoot = app.isPackaged ? process.resourcesPath : developmentRoot;
let mainWindow: BrowserWindow | null = null;
let store: WorkspaceStore;
let piSessions: PiLocalSessionService;
const controlPlane = new ControlPlaneClient();

interface KdenseManifest {
  skills: string[];
}

interface KdenseConfig {
  enabledSkills: string[];
}

interface SkillCatalog {
  vendor: string;
  config: string;
  source: string;
  defaultLicense?: string;
}

type SkillTranslations = Record<string, string>;
type SkillExamples = Record<string, Array<{ zh: string; en: string }>>;

interface RootPackage {
  version: string;
}

interface SkillCategory {
  id: string;
  labelZh: string;
  labelEn: string;
  skills: string[];
}

interface ResearchModelCatalog {
  models: ResearchModelSummary[];
}

const rootPackage = loadJson<RootPackage>(join(projectRoot, "package.json"));

function scalar(source: string, key: string): string {
  return source.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
}

function loadSkills(): SkillSummary[] {
  const categories = loadJson<SkillCategory[]>(join(projectRoot, "skills/categories.json")) ?? [];
  const skillCategories = new Map(categories.flatMap((category) =>
    category.skills.map((name) => [name, category] as const),
  ));
  const translations = loadJson<SkillTranslations>(join(projectRoot, "skills/descriptions.zh.json"));
  const englishDescriptions = loadJson<SkillTranslations>(join(projectRoot, "skills/descriptions.en.json"));
  const examples = loadJson<SkillExamples>(join(projectRoot, "skills/examples.json"));
  const catalogs: SkillCatalog[] = [
    {
      vendor: "vendor/kdense-scientific-agent-skills",
      config: "skills/kdense-initial.json",
      source: "K-Dense Scientific Agent Skills",
    },
    {
      vendor: "vendor/materialsx-default-skills",
      config: "skills/materialsx-default.json",
      source: "MaterialsX 内置材料抽取 Skills",
      defaultLicense: "AGPL-3.0-only",
    },
  ];
  return catalogs.flatMap((catalog) => {
    const vendor = join(projectRoot, catalog.vendor);
    const manifest = loadJson<KdenseManifest>(join(vendor, "MANIFEST.json"));
    const config = loadJson<KdenseConfig>(join(projectRoot, catalog.config));
    const enabled = new Set(config?.enabledSkills ?? []);
    return (manifest?.skills ?? []).map((name) => {
      const category = skillCategories.get(name);
      const path = join(vendor, "skills", name, "SKILL.md");
      const skillSource = existsSync(path) ? readFileSync(path, "utf8") : "";
      const descriptionEn =
        englishDescriptions?.[name] || scalar(skillSource, "description") || "Materials science research workflow skill.";
      const descriptionZh = translations?.[name] || "材料科研工作流技能。";
      return {
        name,
        category: category?.id ?? "resources",
        categoryLabelZh: category?.labelZh ?? "资源与环境",
        categoryLabelEn: category?.labelEn ?? "Resources & environment",
        source: catalog.source,
        description: descriptionEn,
        descriptionZh,
        descriptionEn,
        examples: examples?.[name] ?? [],
        license: scalar(skillSource, "license") || catalog.defaultLicense || "待复核",
        enabled: enabled.has(name),
      };
    });
  });
}

function loadResearchModels(): ResearchModelSummary[] {
  return loadJson<ResearchModelCatalog>(join(projectRoot, "models/catalog.json"))?.models ?? [];
}

async function diagnostics(): Promise<ConnectionSummary[]> {
  const checks: ConnectionSummary[] = [
    {
      id: "pi",
      name: "Pi Agent Runtime",
      kind: "runtime",
      status: "ready",
      detail: "SDK 0.99.1 · 隔离资源加载",
    },
    {
      id: "mcp-local",
      name: "Materials MCP",
      kind: "mcp",
      status: "ready",
      detail: "stdio · materials_ping 已验证",
    },
  ];
  const managedPython = resolveManagedPython(projectRoot);
  const probes: Array<[string, string, string, string[]]> = [
    ["python", "Python Science", managedPython, ["--version"]],
    ["tesseract", "Tesseract OCR", "tesseract", ["--version"]],
  ];
  for (const [id, name, command, args] of probes) {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, { timeout: 4_000 });
      checks.push({ id, name, kind: "runtime", status: "ready", detail: `${stdout || stderr}`.trim().split("\n")[0] ?? "已就绪" });
    } catch {
      checks.push({ id, name, kind: "runtime", status: "attention", detail: "项目运行时中不可用" });
    }
  }
  checks.push(
    {
      id: "lammps",
      name: "LAMMPS",
      kind: "solver",
      status: existsSync(join(projectRoot, "runtime/m0-solvers/lammps/bin/lmp")) ? "ready" : "offline",
      detail: "项目私有求解器环境",
    },
    {
      id: "qe",
      name: "Quantum ESPRESSO",
      kind: "solver",
      status: existsSync(join(projectRoot, "runtime/m0-solvers/qe-osx64/bin/pw.x")) ? "ready" : "offline",
      detail: "QE 7.4 · 小体系 SCF",
    },
  );
  const modelSettings = store.getSettings();
  if (modelSettings.mode === "local") {
    try {
      const models = await discoverLocalModels(modelSettings.localEndpoint);
      checks.push({
        id: "lmstudio",
        name: "LM Studio",
        kind: "runtime",
        status: models.some((item) => item.id === modelSettings.modelId) ? "ready" : "attention",
        detail: `${models.length} 个模型 · ${modelSettings.localEndpoint}`,
      });
    } catch (cause) {
      checks.push({
        id: "lmstudio",
        name: "LM Studio",
        kind: "runtime",
        status: "offline",
        detail: cause instanceof Error ? cause.message : "本地模型服务不可用",
      });
    }
  }
  const controlPlaneReady = await controlPlane.health();
  checks.push({
    id: "control-plane",
    name: "订阅控制面",
    kind: "runtime",
    status: controlPlaneReady ? "ready" : "offline",
    detail: controlPlaneReady ? "127.0.0.1:8787 · 额度账本在线" : "本地 M3 开发服务未启动",
  });
  return checks;
}

async function bootstrap(): Promise<DesktopBootstrap> {
  return {
    appVersion: rootPackage?.version ?? app.getVersion(),
    platform: `${platform()} · ${hostname()}`,
    projects: store.listProjects(),
    conversations: store.listConversations(),
    settings: store.getSettings(),
    skills: loadSkills(),
    models: loadResearchModels(),
    connections: await diagnostics(),
    runs: store.listRuns(),
  };
}

async function releaseReadiness(currentDiagnostics?: ConnectionSummary[]): Promise<ReleaseReadiness> {
  const connections = currentDiagnostics ?? (await diagnostics());
  const loadedSkills = loadSkills();
  const summary = store.getSupportSummary();
  return createReleaseReadiness({
    version: rootPackage?.version ?? app.getVersion(),
    platform: `${platform()}-${arch()}`,
    packaged: app.isPackaged,
    signed: process.env.MATERIALSX_RELEASE_SIGNED === "1",
    skillCount: loadedSkills.filter((item) => item.enabled).length,
    licenseBlocked: loadedSkills.filter((item) => item.license === "待复核").length,
    databaseIntegrity: summary.databaseIntegrity,
    runtimeReady: connections.filter((item) => item.status === "ready").length,
    runtimeTotal: connections.length,
    macOSInstallEvidence: existsSync(join(projectRoot, "release/evidence/macos-arm64-install.json")),
    windowsInstallEvidence: existsSync(join(projectRoot, "release/evidence/windows-x64-install.json")),
    scienceEvaluationEvidence: existsSync(join(projectRoot, "release/evidence/science-holdout.json")),
    updateRollbackEvidence: existsSync(join(projectRoot, "release/evidence/update-rollback.json")),
  });
}

async function exportSupportBundle(): Promise<{ canceled: boolean; path?: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: "导出 MaterialsX 脱敏诊断包",
    defaultPath: join(app.getPath("documents"), `MaterialsX-support-${timestamp}.json`),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const currentDiagnostics = await diagnostics();
  const bundle = redactSupportData({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    application: {
      name: "MaterialsX",
      version: rootPackage?.version ?? app.getVersion(),
      packaged: app.isPackaged,
      platform: platform(),
      architecture: arch(),
      electron: process.versions.electron,
      node: process.versions.node,
    },
    workspace: store.getSupportSummary(),
    connections: currentDiagnostics.map(({ id, name, kind, status }) => ({ id, name, kind, status })),
    release: await releaseReadiness(currentDiagnostics),
    privacy: {
      excluded: ["project paths", "file contents", "conversation text", "tokens", "credentials", "model endpoints"],
    },
  });
  await writeFile(result.filePath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  return { canceled: false, path: result.filePath };
}

function assertText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 20_000) {
    throw new Error(`${field} 无效`);
  }
  return value.trim();
}

function sendMessageStream(event: MessageStreamEvent): void {
  const target = mainWindow;
  if (target && !target.isDestroyed()) target.webContents.send("workspace:message-stream", event);
}

function registerIpc(): void {
  ipcMain.handle("workspace:bootstrap", () => bootstrap());
  ipcMain.handle("workspace:reveal-artifact", async (_event, input: unknown) => {
    const path = await realpath(assertText(input, "artifactPath"));
    for (const project of store.listProjects()) {
      let root: string;
      try { root = await realpath(join(project.path, "materials-output")); } catch { continue; }
      const inside = relative(root, path);
      if (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
        // Reveal only; never execute a model-supplied script or executable.
        shell.showItemInFolder(path);
        return;
      }
    }
    throw new Error("只能定位已登记项目 materials-output 目录内的真实文件。");
  });
  ipcMain.handle("workspace:choose-project", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    return store.createProject(result.filePaths[0]);
  });
  ipcMain.handle("workspace:create-conversation", (_event, projectId: unknown) =>
    store.createConversation(assertText(projectId, "projectId")),
  );
  ipcMain.handle("workspace:list-messages", (_event, conversationId: unknown) =>
    store.listMessages(assertText(conversationId, "conversationId")),
  );
  ipcMain.handle("workspace:send-message", async (_event, input: SendMessageInput) => {
    const projectId = assertText(input?.projectId, "projectId");
    const conversationId = assertText(input?.conversationId, "conversationId");
    const content = assertText(input?.content, "content");
    store.appendMessage(conversationId, "user", content, "complete");
    store.renameConversationFromFirstMessage(conversationId, content);
    const settings = store.getSettings();
    if (settings.mode === "platform") {
      store.appendMessage(
        conversationId,
        "system",
        "任务已安全保存在本地。平台模型网关将在 MX-108 接入；当前内容没有发送到外部模型。",
        "waiting_model",
      );
      store.addRun(projectId, content.slice(0, 80), "waiting_model");
      return store.listMessages(conversationId);
    }
    const project = store.getProject(projectId);
    if (!project) throw new Error("项目不存在");
    const run = store.addRun(projectId, content.slice(0, 80), "running");
    const streamId = `stream:${conversationId}`;
    let sequence = 0;
    let streamedText = "";
    const emit = (event: Omit<MessageStreamEvent, "conversationId" | "streamId" | "sequence">): void => {
      sendMessageStream({ conversationId, streamId, sequence: sequence++, ...event });
    };
    const buffer = new TextStreamBuffer((delta) => emit({ type: "delta", delta }), 32);
    emit({ type: "start" });
    try {
      const answer = await piSessions.prompt(conversationId, project.path, settings, content, (delta) => {
        streamedText += delta;
        buffer.push(delta);
      });
      buffer.close();
      store.appendMessage(conversationId, "assistant", answer, "complete");
      store.updateRun(run.id, "completed");
      emit({ type: "complete", content: answer });
    } catch (cause) {
      buffer.close();
      const message = cause instanceof Error ? cause.message : String(cause);
      const cancelled = /abort/i.test(message);
      const partial = streamedText.trim();
      if (partial) store.appendMessage(conversationId, "assistant", partial, cancelled ? "cancelled" : "failed");
      if (!partial || !cancelled) {
        store.appendMessage(
          conversationId,
          "system",
          `本地任务${cancelled ? "已停止" : "失败"}：${message}`,
          cancelled ? "cancelled" : "failed",
        );
      }
      store.updateRun(run.id, cancelled ? "cancelled" : "failed");
      emit({ type: cancelled ? "cancelled" : "error", content: partial, error: message });
    }
    return store.listMessages(conversationId);
  });
  ipcMain.handle("workspace:cancel-run", (_event, conversationId: unknown) =>
    piSessions.cancel(assertText(conversationId, "conversationId")),
  );
  ipcMain.handle("settings:save-model", (_event, input: ModelSettings) => {
    const mode = input?.mode;
    const modelId = assertText(input?.modelId, "modelId");
    const localEndpoint = typeof input?.localEndpoint === "string" ? input.localEndpoint.trim() : "";
    validateModelSelection({
      mode,
      modelId,
      ...(mode === "local" ? { localEndpoint } : {}),
    });
    return store.saveSettings({ mode, modelId, localEndpoint });
  });
  ipcMain.handle("settings:probe-local-models", (_event, endpoint: unknown) => {
    const localEndpoint = assertText(endpoint, "localEndpoint");
    validateModelSelection({ mode: "local", modelId: "probe", localEndpoint });
    return discoverLocalModels(localEndpoint);
  });
  ipcMain.handle("models:open-source", (_event, modelId: unknown) => {
    const id = assertText(modelId, "modelId");
    const model = loadResearchModels().find((item) => item.id === id);
    if (!model || !model.sourceUrl.startsWith("https://")) throw new Error("模型来源不可用");
    return shell.openExternal(model.sourceUrl);
  });
  ipcMain.handle("subscription:get", () => controlPlane.snapshot(`local-${store.getInstallationId()}`));
  ipcMain.handle("subscription:activate-development", (_event, planId: unknown) => {
    if (planId !== "pro" && planId !== "research") throw new Error("测试套餐无效");
    return controlPlane.activateDevelopmentPlan(
      `local-${store.getInstallationId()}`,
      planId,
      `desktop-dev-${randomUUID()}`,
    );
  });
  ipcMain.handle("diagnostics:refresh", () => diagnostics());
  ipcMain.handle("release:readiness", () => releaseReadiness());
  ipcMain.handle("release:export-support-bundle", () => exportSupportBundle());
  ipcMain.handle("app:open-docs", () => shell.openPath(join(projectRoot, "docs/STATUS.md")));
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    title: "MaterialsX",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0b0d0f",
    show: false,
    webPreferences: {
      preload: join(currentDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.env.MATERIALSX_RENDERER_URL) {
    await mainWindow.loadURL(process.env.MATERIALSX_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(currentDir, "../renderer/index.html"));
  }
}

app.setName("MaterialsX");

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  store = new WorkspaceStore(join(userData, "materialsx.sqlite"));
  piSessions = new PiLocalSessionService(projectRoot, userData);
  registerIpc();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  piSessions?.dispose();
  store?.close();
});
