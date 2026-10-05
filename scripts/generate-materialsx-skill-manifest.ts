import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = process.cwd();
const vendorRoot = resolve(root, "vendor/materialsx-default-skills");
const skillRoot = resolve(vendorRoot, "skills");
const skills = (JSON.parse(await readFile(resolve(root,"skills/materialsx-default.json"),"utf8")) as {skills:string[]}).skills;

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return files.flat().sort();
}

const paths = (await walk(skillRoot)).filter(
  (path) => !path.includes("/__pycache__/") && !path.endsWith(".pyc"),
);
const files = await Promise.all(
  paths.map(async (path) => {
    const [content, metadata] = await Promise.all([readFile(path), stat(path)]);
    return {
      path: relative(vendorRoot, path).replaceAll("\\", "/"),
      bytes: metadata.size,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }),
);

const manifest = {
  schemaVersion: 1,
  source: "MaterialsX curated local Skill snapshots",
  versions: {
    "materials-literature-rpsme-json": "1.7.1+UA.6.0",
    "materials-xyz-extraction": "2.0.0",
    "materials-skill-creator": "UA.5.0",
    "materials-potential-discovery": "6.11.0",
    "materials-research-workbench": "UA.7.0",
    "materials-tensile-analysis": "UA.8.0",
    "materials-next-experiment": "UA.9.0",
    "materials-method-packages": "UA.10.0",
    "materials-long-compute": "UA.11.0",
    ...Object.fromEntries(skills.filter(s=>s.startsWith("materials-mlip-")||s.startsWith("materials-atomic-")).map(s=>[s,s==="materials-mlip-md"?"6.5.0":["materials-mlip-selection","materials-mlip-singlepoint","materials-mlip-relaxation"].includes(s)?"6.15.0":"6.4.0"])),
  },
  generatedAt: new Date().toISOString(),
  skills,
  files,
};

await writeFile(resolve(vendorRoot, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`MaterialsX default Skill manifest: ${skills.length} Skills, ${files.length} files\n`);
