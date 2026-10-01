import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const vendorRoot = resolve(root, "vendor/materialsx-default-skills");
const python =
  process.platform === "win32"
    ? resolve(root, "python/.venv/Scripts/python.exe")
    : resolve(root, "python/.venv/bin/python");

interface Manifest {
  files: Array<{ path: string; bytes: number; sha256: string }>;
  skills: string[];
}
interface SkillConfig { enabledSkills: string[]; skills: string[] }
interface SkillExample { zh: string; en: string }

function frontmatterValue(source: string, key: string): string | undefined {
  const block = source.match(/^---\s*\n([\s\S]*?)\n---/u);
  return block?.[1]?.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "");
}

async function runPython(args: string[]): Promise<{ passed: boolean; detail: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(python, args, { cwd: root, timeout: 120_000, maxBuffer: 10_000_000 });
    return { passed: true, detail: `${stdout}${stderr}`.trim().split("\n").slice(-3).join(" | ") || "passed" };
  } catch (cause) {
    const error = cause as Error & { stdout?: string; stderr?: string };
    return { passed: false, detail: `${error.stdout ?? ""}${error.stderr ?? ""}${error.message}`.trim().slice(-2000) };
  }
}

const [manifest, config, descriptionsZh, descriptionsEn, examples, packageJson] = await Promise.all([
  readFile(resolve(vendorRoot, "MANIFEST.json"), "utf8").then((value) => JSON.parse(value) as Manifest),
  readFile(resolve(root, "skills/materialsx-default.json"), "utf8").then((value) => JSON.parse(value) as SkillConfig),
  readFile(resolve(root, "skills/descriptions.zh.json"), "utf8").then((value) => JSON.parse(value) as Record<string, string>),
  readFile(resolve(root, "skills/descriptions.en.json"), "utf8").then((value) => JSON.parse(value) as Record<string, string>),
  readFile(resolve(root, "skills/examples.json"), "utf8").then((value) => JSON.parse(value) as Record<string, SkillExample[]>),
  readFile(resolve(root, "package.json"), "utf8").then((value) => JSON.parse(value) as { build?: { extraResources?: Array<{ from?: string; to?: string }> } }),
]);

const fileIntegrity = await Promise.all(
  manifest.files.map(async (file) => {
    const content = await readFile(resolve(vendorRoot, file.path));
    return content.byteLength === file.bytes && createHash("sha256").update(content).digest("hex") === file.sha256;
  }),
);

const tempRoot = await mkdtemp(resolve(tmpdir(), "materialsx-default-skill-acceptance-"));
await mkdir(resolve(tempRoot, "agent"), { recursive: true });
let discovered = new Set<string>();
let diagnostics: unknown[] = [];
try {
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: resolve(tempRoot, "agent"),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    additionalSkillPaths: [resolve(vendorRoot, "skills")],
    skillsOverride: (current) => ({
      skills: current.skills.filter((skill) => skill.baseDir.startsWith(vendorRoot)),
      diagnostics: current.diagnostics.filter((diagnostic) => {
        const path = "path" in diagnostic ? String(diagnostic.path) : "";
        return path.startsWith(vendorRoot);
      }),
    }),
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    noExtensions: true,
  });
  await loader.reload();
  const loaded = loader.getSkills();
  discovered = new Set(loaded.skills.map((skill) => skill.name));
  diagnostics = loaded.diagnostics;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

const runtimeChecks = {
  nativePdfReadingOrder: await runPython([
    resolve(vendorRoot, "skills/materials-literature-rpsme-json/scripts/test_native_reading_order.py"),
  ]),
  environment: await runPython([
    resolve(vendorRoot, "skills/materials-literature-rpsme-json/scripts/check_environment.py"),
  ]),
  xyzV2: await runPython([
    resolve(vendorRoot, "skills/materials-xyz-extraction/scripts/test_xyz_v2.py"),
  ]),
  xyzLegacy: await runPython([
    resolve(vendorRoot, "skills/materials-xyz-extraction/scripts/test_validate_extraction.py"),
  ]),
  xyzExample: await runPython([
    resolve(vendorRoot, "skills/materials-xyz-extraction/scripts/xyz_v2.py"),
    "validate",
    resolve(vendorRoot, "skills/materials-xyz-extraction/examples/polymers-16-00897-v2.xyz.json"),
    "--report",
    resolve(tempRoot, "xyz-example-validation.json"),
  ]),
};
await rm(tempRoot, { recursive: true, force: true });

const enabled = new Set(config.enabledSkills);
const findings = await Promise.all(
  manifest.skills.map(async (skill) => {
    const source = await readFile(resolve(vendorRoot, "skills", skill, "SKILL.md"), "utf8");
    const skillExamples = examples[skill] ?? [];
    const checks = {
      metadata: frontmatterValue(source, "name") === skill && Boolean(frontmatterValue(source, "description")),
      chineseDescription: Boolean(descriptionsZh[skill]?.trim()),
      englishDescription: Boolean(descriptionsEn[skill]?.trim()),
      bilingualExamples: [1, 2].includes(skillExamples.length) && skillExamples.every((item) => item.zh.trim() && item.en.trim()),
      enabledByDefault: enabled.has(skill),
      piDiscovery: discovered.has(skill),
    };
    return { skill, status: Object.values(checks).every(Boolean) ? "pass" : "blocked", checks };
  }),
);

const resources = new Set((packageJson.build?.extraResources ?? []).map((item) => `${item.from}:${item.to}`));
const globalChecks = {
  catalogMatchesManifest: JSON.stringify(config.skills) === JSON.stringify(manifest.skills),
  enabledCatalogMatchesManifest: JSON.stringify(config.enabledSkills) === JSON.stringify(manifest.skills),
  manifestIntegrity: fileIntegrity.every(Boolean),
  noCompiledPythonCache: manifest.files.every((file) => !file.path.endsWith(".pyc") && !file.path.includes("/__pycache__/")),
  noPiDiagnostics: diagnostics.length === 0,
  packagedResources: resources.has("vendor:vendor") && resources.has("skills:skills"),
  pythonEnvironment: runtimeChecks.environment.passed,
  xyzV2Tests: runtimeChecks.xyzV2.passed,
  xyzLegacyTests: runtimeChecks.xyzLegacy.passed,
  xyzExampleValid: runtimeChecks.xyzExample.passed,
};
const blocked = findings.filter((item) => item.status === "blocked").length;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "MaterialsX curated local Skill snapshots",
  acceptanceScope: "Content integrity, bilingual catalog/examples, Pi discovery, default enablement, Python runtime, script tests, and installer resources",
  total: findings.length,
  passed: findings.length - blocked,
  blocked,
  globalChecks,
  runtimeChecks,
  diagnostics,
  findings,
};

await mkdir(resolve(root, "artifacts/m4"), { recursive: true });
await writeFile(resolve(root, "artifacts/m4/materialsx-skill-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`MaterialsX default Skill acceptance: ${report.passed}/${report.total} passed\n`);
process.stdout.write("Report: artifacts/m4/materialsx-skill-acceptance.json\n");
if (blocked || !Object.values(globalChecks).every(Boolean)) process.exitCode = 1;
