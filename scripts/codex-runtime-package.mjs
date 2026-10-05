import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import layout from "../packages/agent/codex-runtime.json" with { type: "json" };
const exec = promisify(execFile);
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
export function codexTarget(platform, arch) {
  const target = layout.targets[`${platform}-${arch}`];
  if (!target)
    throw Error(`UNSUPPORTED_BUNDLED_CODEX_TARGET: ${platform}-${arch}`);
  return target;
}
async function inspectSource(root, platform, arch) {
  const metadata = await json(join(root, "codex-package.json"));
  const suffix = platform === "win32" ? ".exe" : "";
  if (
    metadata.version !== layout.version ||
    metadata.target !== codexTarget(platform, arch) ||
    metadata.entrypoint !== `bin/codex${suffix}` ||
    metadata.layoutVersion !== 1
  )
    throw Error("CODEX_SOURCE_VERSION_MISMATCH");
  for (const file of [
    metadata.entrypoint,
    `bin/codex-code-mode-host${suffix}`,
    `codex-path/rg${suffix}`,
  ])
    if (!(await stat(join(root, file))).isFile())
      throw Error("CODEX_SOURCE_INCOMPLETE");
}
/** Build-time only. Never searches globally installed Codex or downloads on the user's computer. */
export async function prepareCodexSource(project, platform, arch) {
  const target = codexTarget(platform, arch),
    version = layout.version,
    key = `${platform}-${arch}`;
  const pkg = await json(join(project, "package.json"));
  if (pkg.dependencies["@openai/codex"] !== version)
    throw Error("CODEX_DEPENDENCY_NOT_PINNED");
  const lock = await json(join(project, "package-lock.json"));
  const locked = lock.packages[`node_modules/@openai/codex-${key}`];
  if (locked?.version !== `${version}-${key}` || !locked.integrity)
    throw Error("CODEX_TARGET_NOT_LOCKED");
  const installed = join(project, "node_modules", "@openai", `codex-${key}`);
  try {
    const actual = await realpath(installed);
    const local = relative(resolve(project), actual);
    if (isAbsolute(local) || local === ".." || local.startsWith(".." + sep))
      throw Error("EXTERNAL_CODEX_INSTALLATION");
    if (
      (await json(join(installed, "package.json"))).version !== locked.version
    )
      throw Error("CODEX_PACKAGE_VERSION_MISMATCH");
    const source = join(installed, "vendor", target);
    await inspectSource(source, platform, arch);
    return { source, integrity: locked.integrity };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Cross-compilation may not have the target optional npm package locally installed.
  const cache = join(project, "runtime", "agent", "codex-packages", key);
  const source = join(cache, "package", "vendor", target);
  try {
    await inspectSource(source, platform, arch);
    return { source, integrity: locked.integrity };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(cache, { recursive: true });
  const args = [
    "pack",
    `@openai/codex@${version}-${key}`,
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    cache,
  ];
  const cli = process.env.npm_execpath;
  if (process.platform === "win32" && !cli)
    throw Error("BUILD_CROSS_TARGET_VIA_NPM_SCRIPT_REQUIRED");
  const packed = cli
    ? await exec(process.execPath, [cli, ...args], {
        cwd: project,
        maxBuffer: 1024 * 1024,
      })
    : await exec("npm", args, { cwd: project, maxBuffer: 1024 * 1024 });
  const name = JSON.parse(packed.stdout)[0].filename;
  if (name !== name.split(/[\\/]/).at(-1)) throw Error("INVALID_PACKAGE_NAME");
  const archive = join(cache, name);
  const [algorithm, expected] = locked.integrity.split("-");
  if (
    algorithm !== "sha512" ||
    createHash(algorithm)
      .update(await readFile(archive))
      .digest("base64") !== expected
  )
    throw Error("CODEX_PACKAGE_INTEGRITY_MISMATCH");
  await rm(join(cache, "package"), { recursive: true, force: true });
  await exec(process.platform === "win32" ? "tar.exe" : "tar", [
    "-xzf",
    archive,
    "-C",
    cache,
  ]);
  if (
    (await json(join(cache, "package", "package.json"))).version !==
    locked.version
  )
    throw Error("CODEX_PACKAGE_VERSION_MISMATCH");
  await inspectSource(source, platform, arch);
  return { source, integrity: locked.integrity };
}
async function inventory(root, subdir = "") {
  const files = [];
  for (const item of await readdir(join(root, subdir), {
    withFileTypes: true,
  })) {
    const path = [subdir, item.name].filter(Boolean).join("/");
    if (item.isSymbolicLink()) throw Error("NON_PORTABLE_CODEX_SYMLINK");
    if (item.isDirectory()) files.push(...(await inventory(root, path)));
    else if (item.isFile()) {
      const bytes = await readFile(join(root, path));
      files.push({
        path,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    } else throw Error("NON_PORTABLE_CODEX_FILE");
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function bundleCodex(project, resources, platform, arch) {
  const { source, integrity } = await prepareCodexSource(
    project,
    platform,
    arch,
  );
  const destination = join(resources, "agent-runtime", "codex"),
    target = codexTarget(platform, arch);
  await mkdir(destination, { recursive: true });
  // Delete only our previous target resources; no user state is inside the installation bundle.
  await rm(join(destination, target), { recursive: true, force: true });
  await cp(source, join(destination, target), {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
  for (const file of ["LICENSE", "NOTICE"])
    await cp(
      join(project, "docs", "third-party", "codex", file),
      join(destination, file),
    );
  const files = await inventory(destination, target);
  const manifest = {
    schemaVersion: 1,
    version: layout.version,
    platform,
    arch,
    target,
    npmIntegrity: integrity,
    hashPhase: "before-application-signing",
    files,
  };
  await writeFile(
    join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await verifyCodexBundle(destination, platform, arch);
  if (platform === process.platform && arch === process.arch) {
    const binary = join(
      destination,
      target,
      "bin",
      platform === "win32" ? "codex.exe" : "codex",
    );
    const result = await exec(binary, ["--version"], {
      env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
      // First execution of a large copied Mach-O can wait for macOS signature
      // validation. A cold build must not fail solely on the old five-second probe.
      timeout: 30000,
    });
    if (!result.stdout.includes(`codex-cli ${layout.version}`))
      throw Error("BUNDLED_CODEX_VERSION_MISMATCH");
  }
  return manifest;
}
/** Before signing: verify every copied upstream resource, not merely the main executable. */
export async function verifyCodexBundle(destination, platform, arch) {
  const manifest = await json(join(destination, "manifest.json"));
  if (
    manifest.version !== layout.version ||
    manifest.target !== codexTarget(platform, arch) ||
    manifest.platform !== platform ||
    manifest.arch !== arch
  )
    throw Error("BUNDLED_CODEX_TARGET_MISMATCH");
  await inspectSource(join(destination, manifest.target), platform, arch);
  const actual = await inventory(destination, manifest.target);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files))
    throw Error("BUNDLED_CODEX_RESOURCE_MISMATCH");
  for (const file of ["LICENSE", "NOTICE"])
    if (!(await stat(join(destination, file))).isFile())
      throw Error("BUNDLED_CODEX_LICENSE_MISSING");
  return manifest;
}
