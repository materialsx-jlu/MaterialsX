import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { build } from "esbuild";
import assert from "node:assert/strict";
import { listPackage } from "@electron/asar";
import { verifyCodexBundle } from "../codex-runtime-package.mjs";
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw Error("MACOS_ARM64_PACKAGE_SMOKE_ONLY");
const run = promisify(execFile),
  root = process.cwd(),
  work = resolve("runtime/agent/codex-package-smoke");
const appSource = join(work, "source"),
  output = join(work, "output");
await mkdir(appSource, { recursive: true });
await build({
  entryPoints: ["apps/desktop/codex-package-smoke.ts"],
  outfile: join(appSource, "main.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: ["electron"],
  sourcemap: false,
  banner: {
    js: "import { createRequire as __mxRequire } from 'node:module'; const require = __mxRequire(import.meta.url);",
  },
});
await writeFile(
  join(appSource, "package.json"),
  JSON.stringify(
    {
      name: "materialsx-codex-bundle-smoke",
      productName: "MaterialsX",
      version: "0.0.1",
      main: "main.mjs",
      type: "module",
      author: "MaterialsX",
      description: "Isolated package regression",
      license: "AGPL-3.0-only",
    },
    null,
    2,
  ),
);
const production = JSON.parse(await readFile("package.json", "utf8"));
const config = {
  extends: null,
  appId: "cn.edu.jlu.materialsx.bundle-test",
  productName: "MaterialsX",
  directories: { app: appSource, output },
  files: ["main.mjs", "package.json", "!node_modules/**/*"],
  asar: true,
  npmRebuild: false,
  beforePack: resolve(production.build.beforePack),
  afterPack: resolve(production.build.afterPack),
  mac: { target: "dir", identity: null },
  extraMetadata: { version: "0.0.1" },
};
const configFile = join(work, "builder.json");
await writeFile(configFile, JSON.stringify(config, null, 2));
const packed = await run(
  process.execPath,
  [
    resolve("node_modules/electron-builder/cli.js"),
    "--dir",
    "--mac",
    "--arm64",
    "--config",
    configFile,
  ],
  {
    cwd: root,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    maxBuffer: 4 * 1024 * 1024,
  },
);
console.log(packed.stdout);
const app = join(output, "mac-arm64", "MaterialsX.app"),
  resources = join(app, "Contents", "Resources");
const appFiles = listPackage(join(resources, "app.asar"));
assert(
  !appFiles.some((path) => path.startsWith("/node_modules")),
  "isolated test app must have no external node_modules",
);
const manifest = await verifyCodexBundle(
  join(resources, "agent-runtime", "codex"),
  "darwin",
  "arm64",
);
const isolated = join(work, "isolated");
await mkdir(isolated, { recursive: true });
const launch = run(join(app, "Contents", "MacOS", "MaterialsX"), [], {
  cwd: isolated,
  env: {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: isolated,
    LANG: "en_US.UTF-8",
    MATERIALSX_BUNDLE_SMOKE_DIR: isolated,
  },
  timeout: 90000,
  maxBuffer: 2 * 1024 * 1024,
});
launch.child.stdout.on("data", (chunk) => process.stdout.write(chunk));
launch.child.stderr.on("data", (chunk) => process.stderr.write(chunk));
await launch;
const report = JSON.parse(
  await readFile(join(isolated, "report.json"), "utf8"),
);
const result = {
  ...report,
  nodeModulesInTestApp: false,
  resourceCount: manifest.files.length,
  runtimeBytes: manifest.files.reduce((n, f) => n + f.size, 0),
  installationPackage: false,
  unsignedEngineeringApp: true,
};
await writeFile(
  join(work, "package-report.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
