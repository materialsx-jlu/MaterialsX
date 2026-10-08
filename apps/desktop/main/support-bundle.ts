import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arch, platform } from "node:os";
import { app, dialog, type BrowserWindow } from "electron";
import type { ConnectionSummary, ReleaseReadiness } from "../../../packages/contracts/src/desktop.js";
import { redactSupportData } from "../../../packages/release-readiness/src/index.js";
import type { WorkspaceStore } from "./store.js";
import { loadedBuildIdentity } from "./build-identity.js";
interface SupportContext {
  mainWindow: BrowserWindow | null;
  store: WorkspaceStore;
  diagnostics: () => Promise<ConnectionSummary[]>;
  releaseReadiness: (connections?: ConnectionSummary[]) => Promise<ReleaseReadiness>;
  version: string;
}

export async function saveSupportBundle(context: SupportContext): Promise<{ canceled: boolean; path?: string }> {
  const { mainWindow, store, diagnostics, releaseReadiness, version } = context;
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
      version: version,
      packaged: app.isPackaged && process.env.MATERIALSX_DEV_BUNDLE !== '1',
      platform: platform(),
      architecture: arch(),
      electron: process.versions.electron,
      node: process.versions.node,
      buildIdentity: await loadedBuildIdentity(join(app.getAppPath(), "dist")),
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
