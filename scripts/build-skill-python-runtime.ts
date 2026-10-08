import {normalizeRuntimeLinks,removeRuntimeBytecode} from "./managed-runtime-links.js";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, symlink, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const targetName = process.argv[2];
const dependencies = ["jsonschema>=4.21,<5", "PyMuPDF>=1.24,<2", "Pillow>=10,<13", "python-calamine>=0.8,<0.9"];
const runtimeVersion = 3;

if (targetName !== "macos-arm64" && targetName !== "windows-x64" && targetName !== "linux-x64") {
  throw new Error("Usage: tsx scripts/build-skill-python-runtime.ts <macos-arm64|windows-x64|linux-x64>");
}

const target = resolve(root, "runtime/skill-python", targetName);
const metadataPath = resolve(target, "RUNTIME.json");
try {
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { runtimeVersion?: number };
  if (metadata.runtimeVersion === runtimeVersion) {
    if (targetName === "macos-arm64") await normalizeRuntimeLinks(target);
    await removeRuntimeBytecode(target);
    process.stdout.write(`Skill Python runtime already ready: ${targetName}\n`);
    process.exit(0);
  }
} catch {
  // Build a fresh platform runtime below.
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

if (targetName === "macos-arm64") {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("macos-arm64 runtime must be assembled on macOS arm64");
  }
  await execFileAsync("uv", ["python", "install", "3.12"], { cwd: root, timeout: 180_000 });
  const { stdout } = await execFileAsync("uv", ["python", "find", "3.12", "--managed-python"], {
    cwd: root,
    timeout: 30_000,
  });
  const interpreter = stdout.trim();
  if (!interpreter) throw new Error("uv did not return a managed Python 3.12 interpreter");
  await cp(dirname(dirname(interpreter)), target, { recursive: true });
  for (const [name, destination] of [
    ["python", "python3.12"],
    ["python3", "python3.12"],
    ["python3-config", "python3.12-config"],
  ] as const) {
    const link = resolve(target, "bin", name);
    await rm(link, { force: true });
    await symlink(destination, link);
  }
  await execFileAsync(
    "uv",
    [
      "pip",
      "install",
      "--target",
      resolve(target, "lib/python3.12/site-packages"),
      "--python",
      resolve(target, "bin/python3.12"),
      ...dependencies,
    ],
    { cwd: root, timeout: 180_000, maxBuffer: 10_000_000 },
  );
} else if (targetName === "windows-x64") {
  const archive = resolve(root, "runtime/skill-python/python-3.12.10-embed-amd64.zip");
  const response = await fetch("https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip");
  if (!response.ok) throw new Error(`Python.org returned HTTP ${response.status}`);
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  await execFileAsync("tar", ["-xf", archive, "-C", target], { cwd: root, timeout: 120_000 });
  await rm(archive, { force: true });
  const sitePackages = resolve(target, "Lib/site-packages");
  await mkdir(sitePackages, { recursive: true });
  await execFileAsync(
    "uv",
    [
      "pip",
      "install",
      "--target",
      sitePackages,
      "--python-version",
      "3.12",
      "--python-platform",
      "x86_64-pc-windows-msvc",
      "--only-binary",
      ":all:",
      ...dependencies,
    ],
    { cwd: root, timeout: 180_000, maxBuffer: 10_000_000 },
  );
  await writeFile(resolve(target, "python312._pth"), "python312.zip\n.\nLib/site-packages\nimport site\n");
} else {
  // uv downloads its pinned standalone CPython; never copy macOS executables into Linux.
  const downloads = resolve(root, "runtime/release-build/python");
  await execFileAsync("uv", ["python", "install", "cpython-3.12.10-linux-x86_64-gnu", "--install-dir", downloads, "--no-bin"], {cwd:root, timeout:180_000});
  const entry = (await readdir(downloads)).find(name=>name.startsWith("cpython-3.12.10-linux-x86_64-gnu"));
  if (!entry) throw Error("LINUX_MANAGED_PYTHON_MISSING");
  await cp(resolve(downloads, entry), target, {recursive:true, verbatimSymlinks:true});
  await execFileAsync("uv", ["pip", "install", "--target", resolve(target, "lib/python3.12/site-packages"),
    "--python-version", "3.12", "--python-platform", "x86_64-unknown-linux-gnu", "--only-binary", ":all:",
    "jsonschema==4.26.0", "PyMuPDF==1.28.2", "Pillow==12.3.0", "python-calamine==0.8.2"], {cwd:root, timeout:180_000, maxBuffer:10_000_000});
}

if (targetName !== "windows-x64") await normalizeRuntimeLinks(target);
await removeRuntimeBytecode(target);

await writeFile(
  metadataPath,
  `${JSON.stringify(
    {
      runtimeVersion,
      target: targetName,
      python: targetName === "macos-arm64" ? "3.12" : "3.12.10",
      dependencies,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`Built Skill Python runtime: ${targetName}\n`);
