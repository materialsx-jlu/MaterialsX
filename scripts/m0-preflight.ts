import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { arch, platform, release } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

interface Check {
  id: string;
  status: "pass" | "missing" | "blocked";
  detail: string;
}

const root = process.cwd();
const checks: Check[] = [];

function command(name: string, args: string[] = ["--version"]): Check {
  const run = spawnSync(name, args, { encoding: "utf8", timeout: 15_000 });
  if (run.error && "code" in run.error && run.error.code === "ENOENT") {
    return { id: name, status: "missing", detail: "executable not found" };
  }
  const detail = `${run.stdout || run.stderr}`.trim().split("\n")[0] ?? "";
  return { id: name, status: run.status === 0 ? "pass" : "blocked", detail: detail || `exit ${run.status}` };
}

checks.push(command("node"), command("npm"), command("uv"));
const nativeQe = command("pw.x", ["-help"]);
checks.push(command("tesseract"));
const localQeEnv = resolve(root, "runtime/m0-solvers/qe-osx64");
const localQe = spawnSync("conda", ["list", "-p", localQeEnv, "qe", "--json"], {
  encoding: "utf8",
  timeout: 15_000,
});
const localLammps = resolve(root, "runtime/m0-solvers/lammps/bin/lmp");
const lammpsCheck = spawnSync(localLammps, ["-help"], { encoding: "utf8", timeout: 15_000 });
checks.push(
  lammpsCheck.status === 0
    ? { id: "lmp", status: "pass", detail: `${lammpsCheck.stdout}`.trim().split("\n")[0] ?? localLammps }
    : command("lmp", ["-help"]),
);

const docker = spawnSync("docker", ["info", "--format", "{{.OSType}}/{{.Architecture}}"], {
  encoding: "utf8",
  timeout: 15_000,
});
checks.push({
  id: "docker-daemon",
  status: docker.status === 0 ? "pass" : docker.error ? "missing" : "blocked",
  detail: `${docker.stdout || docker.stderr}`.trim().split("\n")[0] || `exit ${docker.status}`,
});
const qeImage = process.env.MATERIALSX_QE_IMAGE ?? "tiagoftc/quantum-espresso:latest";
if (localQe.status === 0) {
  const packages = JSON.parse(localQe.stdout || "[]") as Array<{ version?: string; subdir?: string }>;
  const installed = packages[0];
  checks.push({
    id: "quantum-espresso",
    status: installed ? "pass" : "missing",
    detail: installed ? `project environment: QE ${installed.version ?? "unknown"} (${installed.subdir ?? "unknown"})` : "project QE environment is empty",
  });
} else if (nativeQe.status === "pass") {
  checks.push({ id: "quantum-espresso", status: "pass", detail: `native: ${nativeQe.detail}` });
} else if (docker.status === 0) {
  const image = spawnSync("docker", ["image", "inspect", qeImage], { encoding: "utf8", timeout: 15_000 });
  checks.push({
    id: "quantum-espresso",
    status: image.status === 0 ? "pass" : "missing",
    detail: image.status === 0 ? `docker image: ${qeImage}` : `native pw.x absent; Docker image not cached: ${qeImage}`,
  });
} else {
  checks.push({ id: "quantum-espresso", status: "missing", detail: "native pw.x absent and Docker unavailable" });
}

const manifestPath = resolve(root, "vendor/kdense-scientific-agent-skills/MANIFEST.json");
try {
  await access(manifestPath, constants.R_OK);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    commit: string;
    skills: string[];
    files: Array<{ path: string; sha256: string }>;
  };
  let mismatches = 0;
  for (const file of manifest.files) {
    const content = await readFile(resolve(root, "vendor/kdense-scientific-agent-skills", file.path));
    if (createHash("sha256").update(content).digest("hex") !== file.sha256) mismatches += 1;
  }
  checks.push({
    id: "kdense-initial-skills",
    status: manifest.skills.length >= 18 && mismatches === 0 ? "pass" : "blocked",
    detail: `${manifest.skills.length} pinned skills at ${manifest.commit.slice(0, 12)}, ${mismatches} hash mismatches`,
  });
} catch (error) {
  checks.push({ id: "kdense-initial-skills", status: "missing", detail: String(error) });
}

const materialsxManifestPath = resolve(root, "vendor/materialsx-default-skills/MANIFEST.json");
try {
  await access(materialsxManifestPath, constants.R_OK);
  const manifest = JSON.parse(await readFile(materialsxManifestPath, "utf8")) as {
    skills: string[];
    files: Array<{ path: string; sha256: string }>;
  };
  let mismatches = 0;
  for (const file of manifest.files) {
    const content = await readFile(resolve(root, "vendor/materialsx-default-skills", file.path));
    if (createHash("sha256").update(content).digest("hex") !== file.sha256) mismatches += 1;
  }
  checks.push({
    id: "materialsx-default-skills",
    status: manifest.skills.length === 2 && mismatches === 0 ? "pass" : "blocked",
    detail: `${manifest.skills.length} built-in extraction Skills, ${mismatches} hash mismatches`,
  });
} catch (error) {
  checks.push({ id: "materialsx-default-skills", status: "missing", detail: String(error) });
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  host: { platform: platform(), arch: arch(), release: release(), node: process.version },
  checks,
  summary: {
    passed: checks.filter((item) => item.status === "pass").length,
    missing: checks.filter((item) => item.status === "missing").length,
    blocked: checks.filter((item) => item.status === "blocked").length,
  },
};

await mkdir(resolve(root, "artifacts/m0"), { recursive: true });
await writeFile(resolve(root, "artifacts/m0/preflight.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (
  checks.some(
    (item) =>
      ["node", "npm", "uv", "kdense-initial-skills", "materialsx-default-skills"].includes(item.id) &&
      item.status !== "pass",
  )
) {
  process.exitCode = 1;
}
