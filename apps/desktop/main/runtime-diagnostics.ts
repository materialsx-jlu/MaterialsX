import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ConnectionSummary, ModelSettings } from "../../../packages/contracts/src/desktop.js";
import type { ControlPlaneClient } from "../../../packages/control-plane-client/src/index.js";
import { discoverLocalModels, resolveManagedPython } from "../../../packages/pi-adapter/src/local-session.js";
const execFileAsync = promisify(execFile);

export async function runtimeDiagnostics(projectRoot: string, modelSettings: ModelSettings, controlPlane: Pick<ControlPlaneClient, "health">,moos:()=>Promise<ConnectionSummary>): Promise<ConnectionSummary[]> {
  const checks: ConnectionSummary[] = [
    {
      id: "pi",
      name: "Pi Agent Runtime",
      kind: "runtime",
      status: "ready",
      detail: "SDK 0.99.1 · 隔离资源加载",
    },
    await moos(),
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

