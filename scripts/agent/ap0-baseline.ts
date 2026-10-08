// Baseline capture/orchestration only; generation uses existing M5 and Codex entry points.
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { cpus, totalmem, release } from "node:os";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fingerprint } from "../../packages/release-readiness/src/qualification/fingerprint.js";
import { inspectBuild, buildManifestSchema } from "../../packages/release-readiness/src/qualification/build-identity.js";
import { codexRuntime, CODEX_VERSION } from "../../packages/agent/src/codex-runtime.js";
import { DEFAULT_MODEL_SETTINGS } from "../../packages/contracts/src/model-defaults.js";
import { hash, canonical } from "../../packages/atomistic/src/discovery-io.js";
import { extractFile, listPackage } from "@electron/asar";

export async function freezeBaseline(directory: string, conditions: unknown) {
  const root = process.cwd(), fp = await fingerprint(root);
  const runtime = codexRuntime({ projectRoot: root });
  const build = await inspectBuild(resolve("dist"));
  const snapshot = { schemaVersion: "ap0-baseline-v1", capturedAt: new Date().toISOString(), fingerprint: fp,
    conditions, conditionSha256: hash(canonical(conditions)), defaults: DEFAULT_MODEL_SETTINGS,
    runtime: { engine: "codex", version: CODEX_VERSION, binarySha256: hash(await readFile(runtime.binary)),
      origin: "MaterialsX project dependency; not system Codex" },
    machine: { platform: process.platform, arch: process.arch, os: release(), cpu: cpus()[0]?.model ?? null,
      ramBytes: totalmem(), node: process.versions.node },
    build, buildMatchesSource: build.status === "verified" && canonical(build.stamp?.fingerprint) === canonical(fp),
    modelIdentity: "advertised supplier ID; underlying weights not independently verified",
    scientificQualification: false };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "baseline-before.json"), JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
  return async () => {
    const after = await fingerprint(root);
    const result = { capturedAt: new Date().toISOString(), fingerprint: after,
      unchanged: canonical(fp) === canonical(after), conditionSha256: snapshot.conditionSha256 };
    await writeFile(join(directory, "baseline-after.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    return result;
  };
}
async function installedIdentity(appPath: string) {
  const archive = join(appPath, "Contents/Resources/app.asar");
  try {
    if (!(await lstat(archive)).isFile()) throw Error("APP_ARCHIVE_INVALID");
    const paths = listPackage(archive, { isPack: false }).map(p => p.replaceAll("\\", "/").replace(/^\/+/, ""));
    if (!paths.includes("dist/build-identity.json")) return { status: "unattested", detail: "Existing app has no build manifest" };
    const manifest = buildManifestSchema.parse(JSON.parse(extractFile(archive, "dist/build-identity.json").toString()));
    const current = await inspectBuild(resolve("dist"));
    const files = manifest.files.map(f => {
      if (!f.path.startsWith("apps/desktop/") || f.path.split("/").some(p => p === ".." || p === "." || !p))
        throw Error("APP_MANIFEST_PATH_INVALID");
      const bytes = extractFile(archive, "dist/" + f.path);
      return { path: f.path, sha256: hash(bytes), bytes: bytes.length };
    });
    const actualPaths = paths.filter(p => p.startsWith("dist/apps/desktop/") && !p.endsWith(".map") && !/\.test\.|smoke/i.test(p))
      .filter(p => { try { extractFile(archive, p); return true; } catch { return false; } }).map(p => p.slice(5)).sort();
    const valid = canonical(files) === canonical(manifest.files) && hash(canonical(files)) === manifest.artifactSha256
      && canonical(actualPaths) === canonical(files.map(f => f.path).sort());
    return { status: valid ? "bytes-verified" : "mismatch", buildId: manifest.buildId,
      matchesDevelopment: valid && current.status === "verified" && current.stamp?.buildId === manifest.buildId
        && current.artifactSha256 === manifest.artifactSha256,
      detail: "Disk inspection only; installed process not launched or migrated" };
  } catch (e) {
    return { status: (e as NodeJS.ErrnoException).code === "ENOENT" ? "not-found" : "mismatch",
      detail: "No verified installed build; never infer identity from version number" };
  }
}
async function main() {
  const live = process.argv.includes("--live");
  const output = resolve("runtime/agent/ap-0", new Date().toISOString().replace(/[:.]/g, "-"));
  const finish = await freezeBaseline(output, { provider: "RootFlowAI", publicRoute: "materials-research",
    upstreamModel: "gpt-5.6-sol", protocol: "responses", engine: "codex", cases: ["advice", "repair"],
    perTask: { maxRequests: 16, maxOutputTokens: 4096, maxSeconds: 300, maxCredits: "500" },
    input: "synthetic only", payments: 0, productionWalletMutations: 0, live });
  const index = process.argv.indexOf("--app");
  const installed = await installedIdentity(index >= 0 ? resolve(process.argv[index + 1]!) : "/Applications/MaterialsX.app");
  const commands = live ? [
    ["scripts/agent/rootflow-evaluation.ts", "--live", "--case=advice", "--case=repair", "--output=" + join(output, "materialsx")],
    ["scripts/agent/rootflow-baseline.ts", "--live", "--repair-only", "--output=" + join(output, "native")],
  ] : [];
  const runs: { script: string; exitCode: number; elapsedMs: number; logSha256: string }[] = [];
  for (const args of commands) {
    const started = Date.now(), chunks: Buffer[] = [];
    const exitCode = await new Promise<number>((done, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let size = 0;
      const save = (b: Buffer) => { size += b.length; if (size > 8 * 1024 * 1024) child.kill(); else chunks.push(b); };
      child.stdout.on("data", save); child.stderr.on("data", save);
      const timeout = setTimeout(() => child.kill("SIGTERM"), 15 * 60 * 1000);
      child.once("error", e => { clearTimeout(timeout); reject(e); });
      child.once("close", code => { clearTimeout(timeout); done(code ?? 1); });
    });
    const log = Buffer.concat(chunks);
    await writeFile(join(output, "run-" + runs.length + ".log"), log, { mode: 0o600 });
    runs.push({ script: args[0]!, exitCode, elapsedMs: Date.now() - started, logSha256: hash(log) });
    console.log(JSON.stringify(runs.at(-1)));
  }
  const after = await finish();
  const results = live ? await Promise.all([
    join(output, "materialsx/report.json"), join(output, "native/report.json"),
  ].map(async path => {
    try { return { path, report: JSON.parse(await readFile(resolve(path), "utf8")) }; }
    catch { return { path, report: null }; }
  })) : [];
  const report = { capturedAt: new Date().toISOString(), output, sourceUnchanged: after.unchanged, installed, runs, results,
    live, scientificQualification: false, comparison: "Native repair diagnostic differs in supervision/tool exposure. Not a fair performance claim.",
    completion: "Capture retains failures and unknowns; it is not AP.6 stability or release qualification." };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  await writeFile(resolve("runtime/agent/ap-0/latest.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  await writeFile(resolve("runtime/agent/ap-0", live ? "latest-live.json" : "latest-offline.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ output, sourceUnchanged: after.unchanged, installed, live }));
  if (!after.unchanged || runs.some(r => r.exitCode !== 0)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
