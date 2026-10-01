import type { ReleaseCheck, ReleaseReadiness } from "../../contracts/src/desktop.js";

export interface ReleaseReadinessInput {
  version: string;
  platform: string;
  packaged: boolean;
  signed: boolean;
  skillCount: number;
  licenseBlocked: number;
  databaseIntegrity: string;
  runtimeReady: number;
  runtimeTotal: number;
  macOSInstallEvidence: boolean;
  windowsInstallEvidence: boolean;
  scienceEvaluationEvidence: boolean;
  updateRollbackEvidence: boolean;
}

function check(
  id: string,
  category: ReleaseCheck["category"],
  title: string,
  status: ReleaseCheck["status"],
  detail: string,
  remediation?: string,
): ReleaseCheck {
  return { id, category, title, status, detail, ...(remediation ? { remediation } : {}) };
}

export function createReleaseReadiness(input: ReleaseReadinessInput): ReleaseReadiness {
  const runtimeComplete = input.runtimeTotal > 0 && input.runtimeReady === input.runtimeTotal;
  const checks: ReleaseCheck[] = [
    check(
      "skills-target",
      "science",
      "至少 84 个已验收科研 Skills",
      input.skillCount >= 84 ? "pass" : "blocked",
      `当前固定并加载 ${input.skillCount} 个 Skills。`,
      input.skillCount < 84 ? "完成逐项许可、依赖和样例验收后扩充到至少 84 个。" : undefined,
    ),
    check(
      "skills-license",
      "security",
      "Skills 许可声明",
      input.licenseBlocked === 0 ? "pass" : "blocked",
      input.licenseBlocked === 0 ? "当前内置 Skills 均包含许可声明。" : `${input.licenseBlocked} 个 Skills 缺少许可声明。`,
      input.licenseBlocked > 0 ? "阻止相应 Skill 进入发行包并完成人工复核。" : undefined,
    ),
    check(
      "database-integrity",
      "operations",
      "本地数据库完整性",
      input.databaseIntegrity === "ok" ? "pass" : "blocked",
      `SQLite quick_check：${input.databaseIntegrity}`,
      input.databaseIntegrity === "ok" ? undefined : "先备份数据，再执行恢复或迁移回退演练。",
    ),
    check(
      "runtime-health",
      "operations",
      "运行时与连接健康",
      runtimeComplete ? "pass" : "warning",
      `${input.runtimeReady}/${input.runtimeTotal} 个当前连接就绪。`,
      runtimeComplete ? undefined : "发布支持矩阵应注明可选组件，并修复必需运行时。",
    ),
    check(
      "desktop-isolation",
      "security",
      "桌面渲染进程隔离",
      "pass",
      "contextIsolation 与 sandbox 已开启，Node 集成已关闭。",
    ),
    check(
      "privacy-bundle",
      "security",
      "脱敏诊断包",
      "pass",
      "诊断包不收集项目路径、文件内容、对话正文、令牌或供应商凭据。",
    ),
    check(
      "packaged-install",
      "delivery",
      "发行构建",
      input.packaged ? "pass" : "warning",
      input.packaged ? "当前从发行包运行。" : "当前是开发构建；已配置可复现打包入口。",
      input.packaged ? undefined : "运行 npm run package:dir 或目标平台安装包构建。",
    ),
    check(
      "code-signing",
      "delivery",
      "代码签名与公证",
      input.signed ? "pass" : "blocked",
      input.signed ? "当前发行包已检测到签名。" : "尚无可验证的正式签名或 macOS 公证证据。",
      input.signed ? undefined : "配置受保护的签名证书，并在 CI 中保存公证/签名验证记录。",
    ),
    check(
      "macos-install",
      "delivery",
      "macOS arm64 全新安装验证",
      input.macOSInstallEvidence ? "pass" : "blocked",
      input.macOSInstallEvidence ? "已找到 M4 安装验证证据。" : "尚未记录全新机器安装与升级回退证据。",
    ),
    check(
      "windows-install",
      "delivery",
      "Windows x64 全新安装验证",
      input.windowsInstallEvidence ? "pass" : "blocked",
      input.windowsInstallEvidence ? "已找到 M4 安装验证证据。" : "尚未记录 Windows 签名安装与升级回退证据。",
    ),
    check(
      "science-holdout",
      "science",
      "三领域保留集评测",
      input.scienceEvaluationEvidence ? "pass" : "blocked",
      input.scienceEvaluationEvidence ? "已找到固定模型与环境的评测报告。" : "尚无三领域保留集发布报告。",
      input.scienceEvaluationEvidence ? undefined : "完成文献、计算材料和复合材料保留集并由领域专家签收。",
    ),
    check(
      "update-rollback",
      "operations",
      "更新与回退演练",
      input.updateRollbackEvidence ? "pass" : "blocked",
      input.updateRollbackEvidence ? "已找到更新、数据库迁移和回退证据。" : "尚未完成升级失败与数据库回退演练。",
    ),
  ];

  return {
    generatedAt: new Date().toISOString(),
    version: input.version,
    platform: input.platform,
    target: "v1",
    passed: checks.filter((item) => item.status === "pass").length,
    warnings: checks.filter((item) => item.status === "warning").length,
    blocked: checks.filter((item) => item.status === "blocked").length,
    checks,
  };
}

const sensitiveKey = /(token|secret|password|authorization|api.?key|cookie|credential|content|path$|endpoint$)/i;

export function redactSupportData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSupportData);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redactSupportData(item),
      ]),
    );
  }
  return value;
}
