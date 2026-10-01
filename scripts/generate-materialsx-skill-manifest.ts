import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = process.cwd();
const vendorRoot = resolve(root, "vendor/materialsx-default-skills");
const skillRoot = resolve(vendorRoot, "skills");
const skills = ["materials-literature-rpsme-json", "materials-xyz-extraction"];

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
    "materials-literature-rpsme-json": "1.7.1",
    "materials-xyz-extraction": "2.0.0",
  },
  generatedAt: new Date().toISOString(),
  skills,
  files,
};

await writeFile(resolve(vendorRoot, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`MaterialsX default Skill manifest: ${skills.length} Skills, ${files.length} files\n`);
