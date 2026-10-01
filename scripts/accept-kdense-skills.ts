import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

interface Manifest {
  commit: string;
  files: Array<{ path: string }>;
  skills: string[];
}

interface SkillConfig {
  commit: string;
  enabledSkills: string[];
  skills: string[];
}

interface SkillExample {
  zh: string;
  en: string;
}

function frontmatterValue(source: string, key: string): string | undefined {
  const block = source.match(/^---\s*\n([\s\S]*?)\n---/u);
  if (!block) return undefined;
  return block[1]?.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "");
}

const root = process.cwd();
const vendorRoot = resolve(root, "vendor/kdense-scientific-agent-skills");
const [manifest, config, descriptions, examples, packageJson] = await Promise.all([
  readFile(resolve(vendorRoot, "MANIFEST.json"), "utf8").then((value) => JSON.parse(value) as Manifest),
  readFile(resolve(root, "skills/kdense-initial.json"), "utf8").then((value) => JSON.parse(value) as SkillConfig),
  readFile(resolve(root, "skills/descriptions.zh.json"), "utf8").then(
    (value) => JSON.parse(value) as Record<string, string>,
  ),
  readFile(resolve(root, "skills/examples.json"), "utf8").then(
    (value) => JSON.parse(value) as Record<string, SkillExample[]>,
  ),
  readFile(resolve(root, "package.json"), "utf8").then(
    (value) => JSON.parse(value) as { build?: { extraResources?: Array<{ from?: string; to?: string }> } },
  ),
]);

const configuredResources = new Set(
  (packageJson.build?.extraResources ?? []).map((entry) => `${entry.from ?? ""}:${entry.to ?? ""}`),
);
const packageResourcesReady = configuredResources.has("vendor:vendor") && configuredResources.has("skills:skills");
const enabledSet = new Set(config.enabledSkills);
const tempRoot = await mkdtemp(resolve(tmpdir(), "materialsx-skill-acceptance-"));
const agentDir = resolve(tempRoot, "agent");
await mkdir(agentDir, { recursive: true });

let discoveredNames = new Set<string>();
let diagnostics: unknown[] = [];
try {
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    additionalSkillPaths: [resolve(vendorRoot, "skills")],
    skillsOverride: (current) => ({
      skills: current.skills.filter(
        (skill) => skill.baseDir.startsWith(vendorRoot) && enabledSet.has(skill.name),
      ),
      diagnostics: current.diagnostics.filter((diagnostic) => {
        const diagnosticPath = "path" in diagnostic ? String(diagnostic.path) : "";
        return diagnosticPath.startsWith(vendorRoot);
      }),
    }),
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    noExtensions: true,
  });
  await loader.reload();
  const loaded = loader.getSkills();
  discoveredNames = new Set(loaded.skills.map((skill) => skill.name));
  diagnostics = loaded.diagnostics;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

const findings = await Promise.all(
  manifest.skills.map(async (skill) => {
    const source = await readFile(resolve(vendorRoot, "skills", skill, "SKILL.md"), "utf8");
    const exampleSet = examples[skill] ?? [];
    const checks = {
      pinnedContent: manifest.files.some((file) => file.path === `skills/${skill}/SKILL.md`),
      metadata:
        frontmatterValue(source, "name") === skill &&
        Boolean(frontmatterValue(source, "description")) &&
        Boolean(frontmatterValue(source, "license")),
      chineseDescription: Boolean(descriptions[skill]?.trim()),
      bilingualExamples:
        exampleSet.length >= 1 &&
        exampleSet.length <= 2 &&
        exampleSet.every((example) => Boolean(example.zh?.trim()) && Boolean(example.en?.trim())),
      enabledByDefault: enabledSet.has(skill),
      piDiscovery: discoveredNames.has(skill),
      packagedResource: packageResourcesReady,
    };
    return {
      skill,
      status: Object.values(checks).every(Boolean) ? "pass" : "blocked",
      checks,
    };
  }),
);

const duplicateEnabled = config.enabledSkills.filter((skill, index) => config.enabledSkills.indexOf(skill) !== index);
const globalChecks = {
  pinnedCommitMatches: config.commit === manifest.commit,
  catalogMatchesManifest: JSON.stringify(config.skills) === JSON.stringify(manifest.skills),
  enabledCatalogMatchesManifest: JSON.stringify(config.enabledSkills) === JSON.stringify(manifest.skills),
  noDuplicateEnabledSkills: duplicateEnabled.length === 0,
  noPiDiagnostics: diagnostics.length === 0,
  packageResourcesReady,
};
const blocked = findings.filter((finding) => finding.status === "blocked").length;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "k-dense-ai/scientific-agent-skills",
  commit: manifest.commit,
  acceptanceScope: "Pinned Skill content, bilingual catalog/examples, Pi discovery, default enablement, and installer resources",
  total: findings.length,
  passed: findings.length - blocked,
  blocked,
  globalChecks,
  diagnostics,
  findings,
};

await mkdir(resolve(root, "artifacts/m4"), { recursive: true });
await writeFile(resolve(root, "artifacts/m4/kdense-skill-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`K-Dense Skill acceptance: ${report.passed}/${report.total} passed\n`);
process.stdout.write(`Report: artifacts/m4/kdense-skill-acceptance.json\n`);

if (blocked > 0 || !Object.values(globalChecks).every(Boolean)) process.exitCode = 1;
