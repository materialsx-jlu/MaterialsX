import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface Manifest {
  commit: string;
  skills: string[];
}

function frontmatterValue(source: string, key: string): string | undefined {
  const block = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!block) return undefined;
  const match = block[1]!.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
}

const root = process.cwd();
const vendorRoot = resolve(root, "vendor/kdense-scientific-agent-skills");
const manifest = JSON.parse(await readFile(resolve(vendorRoot, "MANIFEST.json"), "utf8")) as Manifest;
const findings: Array<{
  skill: string;
  name: string | null;
  license: string | null;
  compatibility: string | null;
  status: string;
}> = [];

for (const skill of manifest.skills) {
  const source = await readFile(resolve(vendorRoot, "skills", skill, "SKILL.md"), "utf8");
  const name = frontmatterValue(source, "name");
  const license = frontmatterValue(source, "license");
  const compatibility = frontmatterValue(source, "compatibility");
  findings.push({
    skill,
    name: name ?? null,
    license: license ?? null,
    compatibility: compatibility ?? null,
    status: name === skill && Boolean(license) ? "pass" : "blocked",
  });
}

const report = {
  source: "k-dense-ai/scientific-agent-skills",
  commit: manifest.commit,
  total: findings.length,
  passed: findings.filter((item) => item.status === "pass").length,
  blocked: findings.filter((item) => item.status === "blocked").length,
  findings,
};
await mkdir(resolve(root, "artifacts/m0"), { recursive: true });
await writeFile(resolve(root, "artifacts/m0/kdense-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.blocked > 0) process.exitCode = 1;
