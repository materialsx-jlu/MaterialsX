import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { sourceInventory } from "../../../../scripts/check-source-size.js";
import { canonical, hash } from "../../../atomistic/src/discovery-io.js";
import { qualificationFingerprint } from "../../../contracts/src/qualification.js";
import { qualificationCases } from "../../../../fixtures/agent/ua14-cases.js";
export async function fingerprint(root: string) {
  const files = new Set((await sourceInventory(root)).map((f) => f.path));
  async function metadata(dir: string) {
    for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) throw Error("QUALIFICATION_SOURCE_SYMLINK");
      if (e.isDirectory()) await metadata(p);
      else if (/\.(json|ya?ml|md|toml|lock)$/.test(p)) files.add(p);
    }
  }
  for (const dir of [
    "fixtures",
    "schemas",
    "skills",
    "methods",
    "docs/agent",
    ".github",
  ])
    await metadata(dir);
  for (const p of [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "LICENSE",
    "NOTICE",
    "README.md",
    "THIRD_PARTY_LICENSES.md",
    "docs/UNIFIED_AGENT_DEVELOPMENT_PLAN.md",
    "models/potentials/release-lock.json",
    "vendor/materialsx-default-skills/MANIFEST.json",
  ])
    files.add(p);
  const entries = [];
  for (const p of [...files].sort()) {
    if ((await lstat(join(root, p))).isSymbolicLink())
      throw Error("QUALIFICATION_SOURCE_SYMLINK");
    entries.push([p, hash(await readFile(join(root, p)))]);
  }
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  return qualificationFingerprint.parse({
    sourceSha256: hash(canonical(entries)),
    suiteSha256: hash(canonical(qualificationCases)),
    lockSha256: hash(await readFile(join(root, "package-lock.json"))),
    version: pkg.version,
    pi: pkg.dependencies["@earendil-works/pi-coding-agent"],
    codex: pkg.dependencies["@openai/codex"],
    mcp: pkg.dependencies["@modelcontextprotocol/sdk"],
  });
}
