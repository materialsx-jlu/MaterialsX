import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Config {
  source: string;
  commit: string;
  skills: string[];
}

interface GitTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "skills/kdense-initial.json");
const config = JSON.parse(await readFile(configPath, "utf8")) as Config;
const destination = resolve(root, "vendor/kdense-scientific-agent-skills");
const repo = new URL(config.source).pathname.replace(/^\//, "").replace(/\.git$/, "");
const apiUrl = `https://api.github.com/repos/${repo}/git/trees/${config.commit}?recursive=1`;
const headers = { "User-Agent": "MaterialsX-M0", Accept: "application/vnd.github+json" };

const response = await fetch(apiUrl, { headers });
if (!response.ok) throw new Error(`GitHub tree request failed: ${response.status}`);
const treeResponse = (await response.json()) as { tree: GitTreeItem[]; truncated?: boolean };
if (treeResponse.truncated) throw new Error("GitHub returned a truncated tree; refusing a partial skill bundle.");

const selected = new Set(config.skills);
const files = treeResponse.tree
  .filter((item) => {
    const parts = item.path.split("/");
    return item.type === "blob" && parts[0] === "skills" && parts[1] !== undefined && selected.has(parts[1]);
  })
  .sort((a, b) => a.path.localeCompare(b.path));

for (const skill of config.skills) {
  if (!files.some((item) => item.path === `skills/${skill}/SKILL.md`)) {
    throw new Error(`Pinned tree does not contain skills/${skill}/SKILL.md`);
  }
}

const manifestFiles: Array<{ path: string; sha256: string; bytes: number; upstreamBlob: string }> = [];
for (let offset = 0; offset < files.length; offset += 12) {
  const batch = files.slice(offset, offset + 12);
  const downloaded = await Promise.all(
    batch.map(async (item) => {
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${config.commit}/${item.path}`;
      const rawResponse = await fetch(rawUrl, { headers });
      if (!rawResponse.ok) throw new Error(`Download failed for ${item.path}: ${rawResponse.status}`);
      const data = Buffer.from(await rawResponse.arrayBuffer());
      const outputPath = resolve(destination, item.path);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, data);
      return {
        path: item.path,
        sha256: createHash("sha256").update(data).digest("hex"),
        bytes: data.byteLength,
        upstreamBlob: item.sha,
      };
    }),
  );
  manifestFiles.push(...downloaded);
  process.stdout.write(`Synced ${Math.min(offset + batch.length, files.length)}/${files.length} files\n`);
}

for (const name of ["LICENSE.md", "SECURITY.md"]) {
  const rawUrl = `https://raw.githubusercontent.com/${repo}/${config.commit}/${name}`;
  const rawResponse = await fetch(rawUrl, { headers });
  if (!rawResponse.ok) throw new Error(`Download failed for ${name}: ${rawResponse.status}`);
  const data = Buffer.from(await rawResponse.arrayBuffer());
  await writeFile(resolve(destination, name), data);
  manifestFiles.push({
    path: name,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.byteLength,
    upstreamBlob: "root-file",
  });
}

const manifest = {
  schemaVersion: 1,
  source: config.source,
  commit: config.commit,
  generatedAt: new Date().toISOString(),
  skills: config.skills,
  fileCount: manifestFiles.length,
  totalBytes: manifestFiles.reduce((sum, item) => sum + item.bytes, 0),
  files: manifestFiles,
};
await writeFile(resolve(destination, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Pinned ${config.skills.length} skills (${manifest.fileCount} files, ${manifest.totalBytes} bytes)\n`);
