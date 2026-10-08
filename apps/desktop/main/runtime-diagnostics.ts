import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ConnectionSummary, ModelSettings } from "../../../packages/contracts/src/desktop.js";
import { mx03RetailCatalogSchema, mx03WalletSchema } from '../../../packages/contracts/src/mx-v03.js';
import { cloudCatalogSchema } from '../../../packages/contracts/src/platform.js';
import type { IdentityClient } from '../../../packages/control-plane-client/src/identity.js';
import { discoverLocalModels, resolveManagedPython } from "../../../packages/pi-adapter/src/local-session.js";
const execFileAsync = promisify(execFile);

export async function mxPointsDiagnostic(identity: Pick<IdentityClient, 'snapshot' | 'platformRequest'>): Promise<ConnectionSummary> {
  const base = { id: 'mx-points', name: 'MX 点与模型网关', kind: 'runtime' as const };
  try {
    const account = await identity.snapshot();
    if (account.status !== 'connected') return { ...base, status: 'attention', detail: '请登录平台账户以读取 MX 点钱包和模型目录' };
    const [walletResponse, priceResponse, modelResponse] = await Promise.all([
      identity.platformRequest('/v1/mx-points/wallet'),
      identity.platformRequest('/v1/mx-points/prices'),
      identity.platformRequest('/v1/models'),
    ]);
    if (!walletResponse.ok || !priceResponse.ok || !modelResponse.ok) throw new Error('MX 点接口不可用');
    const [wallet, price, catalog] = await Promise.all([
      walletResponse.json().then(value => mx03WalletSchema.parse(value)),
      priceResponse.json().then(value => mx03RetailCatalogSchema.parse(value)),
      modelResponse.json().then(value => cloudCatalogSchema.parse(value)),
    ]);
    const activeModels = catalog.items.filter(item => item.enabled && item.accessMode === 'mx-points').length;
    if (price.status !== 'approved' || !activeModels)
      return { ...base, status: 'attention', detail: 'MX 点钱包可读，但当前没有开放的计费模型' };
    if (Number(wallet.available) <= 0)
      return { ...base, status: 'attention', detail: 'MX 点钱包与价格目录在线；余额为 0，充值后可使用模型' };
    return { ...base, status: 'ready', detail: `钱包、价格目录与 ${activeModels} 个计费模型已连通 · 可用 ${wallet.available} MX 点` };
  } catch {
    return { ...base, status: 'offline', detail: 'MX 点钱包、价格目录或模型网关不可用；请检查平台服务与登录状态' };
  }
}

export async function runtimeDiagnostics(projectRoot: string, modelSettings: ModelSettings, mx:()=>Promise<ConnectionSummary>,moos:()=>Promise<ConnectionSummary>): Promise<ConnectionSummary[]> {
  const checks: ConnectionSummary[] = [
    await moos(),
    await mx(),
    {
      id: "pi",
      name: "Pi Agent Runtime",
      kind: "runtime",
      status: "ready",
      detail: "SDK 0.99.1 · 隔离资源加载",
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
  return checks;
}
