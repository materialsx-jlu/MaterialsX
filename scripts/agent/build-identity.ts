import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fingerprint } from "../../packages/release-readiness/src/qualification/fingerprint.js";
import { buildStampSchema, createBuildStamp, sealBuild, inspectBuild } from "../../packages/release-readiness/src/qualification/build-identity.js";
const root = process.cwd(), mode = process.argv[2], dist = resolve("dist");
if (mode === "--prepare") {
  const stamp = createBuildStamp(await fingerprint(root));
  await mkdir(dist, { recursive: true });
  await writeFile(resolve(dist, "build-stamp.json"), JSON.stringify(stamp) + "\n");
  console.log(JSON.stringify(stamp));
} else if (mode === "--seal") {
  const stamp = buildStampSchema.parse(JSON.parse(await readFile(resolve(dist, "build-stamp.json"), "utf8")));
  if (JSON.stringify(stamp.fingerprint) !== JSON.stringify(await fingerprint(root))) throw Error("SOURCE_CHANGED_DURING_BUILD");
  const manifest = await sealBuild(dist, stamp);
  await writeFile(resolve(dist, "build-identity.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ buildId: manifest.buildId, artifactSha256: manifest.artifactSha256, files: manifest.files.length }));
} else if (mode === "--inspect") {
  console.log(JSON.stringify(await inspectBuild(resolve(process.argv[3] ?? dist)), null, 2));
} else throw Error("Expected --prepare, --seal or --inspect");
