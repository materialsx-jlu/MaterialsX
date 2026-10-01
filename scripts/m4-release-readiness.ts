import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import { resolve } from "node:path";
import { createReleaseReadiness } from "../packages/release-readiness/src/index.js";

interface PackageData { version: string }
interface SkillManifest { skills: string[] }
interface SkillConfig { enabledSkills: string[] }
interface AuditReport { blocked: number }

const root = process.cwd();
const packageData = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as PackageData;
const manifest = JSON.parse(
  await readFile(resolve(root, "vendor/kdense-scientific-agent-skills/MANIFEST.json"), "utf8"),
) as SkillManifest;
const skillConfig = JSON.parse(await readFile(resolve(root, "skills/kdense-initial.json"), "utf8")) as SkillConfig;
const materialsxSkillConfig = JSON.parse(
  await readFile(resolve(root, "skills/materialsx-default.json"), "utf8"),
) as SkillConfig;
const auditPath = resolve(root, "artifacts/m0/kdense-audit.json");
const audit = existsSync(auditPath)
  ? (JSON.parse(await readFile(auditPath, "utf8")) as AuditReport)
  : { blocked: manifest.skills.length };

const evidence = (name: string): boolean => existsSync(resolve(root, "release/evidence", name));
const report = createReleaseReadiness({
  version: packageData.version,
  platform: `${platform()}-${arch()}`,
  packaged: existsSync(resolve(root, "release/dist/mac-arm64/MaterialsX.app")),
  signed: process.env.MATERIALSX_RELEASE_SIGNED === "1",
  skillCount: skillConfig.enabledSkills.length + materialsxSkillConfig.enabledSkills.length,
  licenseBlocked: audit.blocked,
  databaseIntegrity: "not-run-in-cli",
  runtimeReady: 0,
  runtimeTotal: 0,
  macOSInstallEvidence: evidence("macos-arm64-install.json"),
  windowsInstallEvidence: evidence("windows-x64-install.json"),
  scienceEvaluationEvidence: evidence("science-holdout.json"),
  updateRollbackEvidence: evidence("update-rollback.json"),
});

await mkdir(resolve(root, "artifacts/m4"), { recursive: true });
await writeFile(resolve(root, "artifacts/m4/release-readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `M4 readiness: ${report.passed} passed, ${report.warnings} warnings, ${report.blocked} blocked\n` +
    `Report: artifacts/m4/release-readiness.json\n`,
);
if (process.argv.includes("--strict") && report.blocked > 0) process.exitCode = 1;
