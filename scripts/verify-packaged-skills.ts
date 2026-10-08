import { execFile } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = process.cwd();
const packageVersion = (JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version: string }).version;
const releaseRoot = resolve(root, "release/dist", packageVersion);
const hostPlatform = process.platform === "win32" ? "Windows x64" : process.platform === "linux" ? "Linux x64" : "macOS arm64";
const resourceArg = process.argv.indexOf("--resources");
if (resourceArg >= 0 && !process.argv[resourceArg + 1]) throw new Error("--resources requires a local Resources directory");
const candidates = resourceArg >= 0 ? [{
  platform: hostPlatform,
  resources: resolve(process.argv[resourceArg + 1]!),
}] : [
  {
    platform: "macOS arm64",
    resources: resolve(releaseRoot, "mac-arm64/MaterialsX.app/Contents/Resources"),
  },
  {
    platform: "Windows x64",
    resources: resolve(releaseRoot, "win-unpacked/resources"),
  },
  {
    platform: "Linux x64",
    resources: resolve(releaseRoot, "linux-unpacked/resources"),
  },
];

const reports: Array<{ platform: string; resources: string; skills: number; models: number; runtime: "pass"; status: "pass" }> = [];
for (const candidate of candidates) {
  try {
    await access(candidate.resources);
  } catch {
    continue;
  }
  let skillCount = 0;
  const skillNames: string[] = [];
  const catalogs: Array<[string, string]> = [
    ["vendor/kdense-scientific-agent-skills", "skills/kdense-initial.json"],
    ["vendor/materialsx-default-skills", "skills/materialsx-default.json"],
  ];
  for (const [vendor, configPath] of catalogs) {
    const manifest = JSON.parse(
      await readFile(resolve(candidate.resources, vendor, "MANIFEST.json"), "utf8"),
    ) as { skills: string[] };
    const config = JSON.parse(await readFile(resolve(candidate.resources, configPath), "utf8")) as {
      enabledSkills: string[];
    };
    if (JSON.stringify(config.enabledSkills) !== JSON.stringify(manifest.skills)) {
      throw new Error(`${candidate.platform} package does not enable every pinned Skill in ${vendor}`);
    }
    await Promise.all(
      manifest.skills.map((skill) => access(resolve(candidate.resources, vendor, "skills", skill, "SKILL.md"))),
    );
    skillCount += manifest.skills.length;
    skillNames.push(...manifest.skills);
  }
  if (new Set(skillNames).size !== skillCount || skillCount < 84) {
    throw new Error(`${candidate.platform} package has duplicate Skills or fewer than 84 accepted Skills`);
  }
  await Promise.all([
    access(resolve(candidate.resources, "skills/descriptions.zh.json")),
    access(resolve(candidate.resources, "skills/descriptions.en.json")),
    access(resolve(candidate.resources, "skills/examples.json")),
    access(resolve(candidate.resources, "skills/categories.json")),
  ]);
  const [descriptionsZh, descriptionsEn, examples, categories] = await Promise.all([
    readFile(resolve(candidate.resources, "skills/descriptions.zh.json"), "utf8"),
    readFile(resolve(candidate.resources, "skills/descriptions.en.json"), "utf8"),
    readFile(resolve(candidate.resources, "skills/examples.json"), "utf8"),
    readFile(resolve(candidate.resources, "skills/categories.json"), "utf8"),
  ]);
  const chineseNames = Object.keys(JSON.parse(descriptionsZh) as Record<string, unknown>);
  const exampleNames = Object.keys(JSON.parse(examples) as Record<string, unknown>);
  const englishNames = Object.keys(JSON.parse(descriptionsEn) as Record<string, unknown>);
  const expectedNames = new Set(skillNames);
  if (chineseNames.length !== skillCount || exampleNames.length !== skillCount
    || chineseNames.some((name) => !expectedNames.has(name))
    || exampleNames.some((name) => !expectedNames.has(name))
    || englishNames.some((name) => !expectedNames.has(name))) {
    throw new Error(`${candidate.platform} package has incomplete Skill descriptions or examples`);
  }
  const categoryEntries = JSON.parse(categories) as Array<{ id: string; skills: string[] }>;
  const categorized = categoryEntries.flatMap((entry) => entry.skills);
  if (new Set(categoryEntries.map((entry) => entry.id)).size !== categoryEntries.length
    || categorized.length !== skillCount || new Set(categorized).size !== skillCount
    || categorized.some((name) => !expectedNames.has(name))) {
    throw new Error(`${candidate.platform} package has incomplete or duplicate Skill categories`);
  }
  const modelCatalog = JSON.parse(
    await readFile(resolve(candidate.resources, "models/catalog.json"), "utf8"),
  ) as { models: Array<{ id: string; descriptionZh: string; descriptionEn: string }> };
  if (modelCatalog.models.length !== 100 || new Set(modelCatalog.models.map((item) => item.id)).size !== 100) {
    throw new Error(`${candidate.platform} package does not contain the 100-entry model directory`);
  }
  const windows = candidate.platform.startsWith("Windows");
  const python = resolve(candidate.resources, "python-runtime", windows ? "python.exe" : "bin/python3.12");
  const sitePackages = resolve(
    candidate.resources,
    "python-runtime",
    windows ? "Lib/site-packages" : "lib/python3.12/site-packages",
  );
  await Promise.all([
    access(python),
    access(resolve(sitePackages, "jsonschema/__init__.py")),
    access(resolve(sitePackages, "pymupdf/__init__.py")),
    access(resolve(sitePackages, "PIL/__init__.py")),
  ]);
  if ((!windows && process.platform === "darwin") || (windows && process.platform === "win32")) {
    if (!windows) {
      const python3 = resolve(candidate.resources, "python-runtime/bin/python3");
      const resolvedPython3 = await realpath(python3);
      if (!resolvedPython3.startsWith(resolve(candidate.resources, "python-runtime"))) {
        throw new Error(`${candidate.platform} packaged python3 escapes the bundled runtime: ${resolvedPython3}`);
      }
    }
    const { stdout } = await execFileAsync(
      python,
      [
        "-B",
        resolve(
          candidate.resources,
          "vendor/materialsx-default-skills/skills/materials-literature-rpsme-json/scripts/check_environment.py",
        ),
      ],
      { timeout: 30_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
    const environment = JSON.parse(stdout) as { ready?: boolean };
    if (!environment.ready) throw new Error(`${candidate.platform} packaged Skill Python runtime is not ready`);
  }
  reports.push({ platform: candidate.platform, resources: candidate.resources, skills: skillCount, models: modelCatalog.models.length, runtime: "pass", status: "pass" });
}

if (reports.length === 0) throw new Error("No unpacked MaterialsX application was found; build a package first");
process.stdout.write(`${JSON.stringify({ packages: reports }, null, 2)}\n`);
