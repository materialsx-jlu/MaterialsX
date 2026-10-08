import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fingerprint } from "../../packages/release-readiness/src/qualification/fingerprint.js";
import { hash, canonical } from "../../packages/atomistic/src/discovery-io.js";
import { technicalStepIds } from "../../packages/release-readiness/src/qualification/technical.js";
const root = process.cwd(),
  output = resolve("runtime/agent/ua-14");
await mkdir(output, { recursive: true, mode: 0o700 });
const fp = await fingerprint(root),
  startedAt = new Date().toISOString();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// Existing checks own their actual tool/science implementations. No generation, payment or model download.
const commands: Array<[string, string[]]> = [
  [npm, ["run", "check"]],
  [npm, ["test"]],
  [npm, ["run", "control-plane:test"]],
  [npm, ["run", "m5:contracts:check"]],
  [npm, ["run", "m6:contracts:check"]],
  [npm, ["run", "skills:accept"]],
  [npm, ["run", "ua7:numeric"]],
  [npm, ["run", "ua8:numeric"]],
  [npm, ["run", "ua9:numeric"]],
  [npm, ["run", "ua10:reference"]],
  [npm, ["run", "ua13:engines"]],
  [npm, ["run", "build"]],
  [
    "uv",
    [
      "run",
      "--project",
      "python",
      "--frozen",
      "python",
      "scripts/check-public-secrets.py",
    ],
  ],
  [process.execPath, ["--import", "tsx", "scripts/agent/ua14-migration.ts"]],
  ["uv", ["run", "--project", "python", "--frozen", "pytest", "python/tests"]],
];
const steps: Array<{
  id: (typeof technicalStepIds)[number];
  command: string;
  exitCode: number;
  elapsedMs: number;
  outputSha256: string;
}> = [];
for (const [file, args] of commands) {
  const start = Date.now(),
    chunks: Buffer[] = [];
  console.log("UA14 checking: " + file + " " + args.join(" "));
  const code = await new Promise<number>((done, reject) => {
    const p = spawn(file, args, {
      cwd: root,
      windowsHide: true,
      shell: process.platform === "win32" && file === npm,
      env: process.env,
    });
    let size = 0;
    const save = (b: Buffer) => {
      size += b.length;
      if (size > 8 * 1024 * 1024) p.kill();
      else chunks.push(b);
    };
    p.stdout.on("data", save);
    p.stderr.on("data", save);
    const timer = setTimeout(() => p.kill(), 180000);
    p.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.once("close", (c) => {
      clearTimeout(timer);
      done(c ?? 1);
    });
  });
  const bytes = Buffer.concat(chunks);
  await writeFile(join(output, "technical-" + steps.length + ".log"), bytes, {
    mode: 0o600,
  });
  steps.push({
    id: technicalStepIds[steps.length]!,
    command: [file, ...args].join(" "),
    exitCode: code,
    elapsedMs: Date.now() - start,
    outputSha256: hash(bytes),
  });
  const report = {
    schemaVersion: "ua14-technical-v1",
    fingerprint: fp,
    startedAt,
    finishedAt: new Date().toISOString(),
    steps,
    complete: steps.length === commands.length,
    passed:
      steps.length === commands.length && steps.every((s) => s.exitCode === 0),
    scientificQualification: false,
    modelSemanticQualification: false,
  };
  await writeFile(
    join(output, "technical.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log("UA14 result: " + code + " (" + steps.at(-1)!.elapsedMs + " ms)");
  if (code !== 0) {
    console.error(bytes.toString().slice(-5000));
    process.exitCode = 1;
    break;
  }
}
if (canonical(await fingerprint(root)) !== canonical(fp)) {
  process.exitCode = 1;
  throw Error("SOURCE_CHANGED_DURING_TECHNICAL_CHECKS");
}
