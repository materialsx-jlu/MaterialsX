import { readFileSync, realpathSync, statSync } from "node:fs";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import layout from "../codex-runtime.json" with { type: "json" };
import { AgentError } from "../../contracts/src/agent.js";
export interface CodexRuntimeLocation {
  packaged?: boolean;
  resourcesPath?: string;
  projectRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}
export const CODEX_VERSION = layout.version;
export function codexRuntime(location: CodexRuntimeLocation = {}) {
  const platform = location.platform ?? process.platform,
    arch = location.arch ?? process.arch;
  const key = `${platform}-${arch}`;
  const target = (layout.targets as Record<string, string>)[key];
  if (!target)
    throw new AgentError(
      "UNAVAILABLE",
      "此平台尚未提供 MaterialsX 内置 Agent 运行程序",
    );
  try {
    const boundary = realpathSync(
      location.packaged
        ? resolve(location.resourcesPath ?? "")
        : resolve(location.projectRoot ?? process.cwd()),
    );
    if (location.packaged && !location.resourcesPath)
      throw Error("NO_RESOURCES_PATH");
    const bundle = join(boundary, "agent-runtime", "codex");
    const root = realpathSync(
      location.packaged
        ? join(bundle, target)
        : join(
            boundary,
            "node_modules",
            "@openai",
            `codex-${key}`,
            "vendor",
            target,
          ),
    );
    const contained = (path: string) => {
      const actual = realpathSync(path),
        local = relative(boundary, actual);
      if (isAbsolute(local) || local === ".." || local.startsWith(".." + sep))
        throw Error("OUTSIDE_MATERIALSX_RUNTIME");
      return actual;
    };
    contained(root);
    const metadata = JSON.parse(
      readFileSync(join(root, "codex-package.json"), "utf8"),
    );
    if (
      metadata.layoutVersion !== 1 ||
      metadata.version !== CODEX_VERSION ||
      metadata.target !== target ||
      metadata.entrypoint !== `bin/codex${platform === "win32" ? ".exe" : ""}`
    )
      throw Error("WRONG_RUNTIME");
    if (location.packaged) {
      const manifest = JSON.parse(
        readFileSync(join(bundle, "manifest.json"), "utf8"),
      );
      if (
        manifest.schemaVersion !== 1 ||
        manifest.version !== CODEX_VERSION ||
        manifest.platform !== platform ||
        manifest.arch !== arch ||
        manifest.target !== target
      )
        throw Error("WRONG_MANIFEST");
      if (!Array.isArray(manifest.files) || !manifest.files.length)
        throw Error("EMPTY_MANIFEST");
      for (const file of manifest.files) {
        if (
          typeof file.path !== "string" ||
          !file.path.startsWith(target + "/")
        )
          throw Error("INVALID_MANIFEST_FILE");
        contained(join(bundle, file.path));
      }
      for (const notice of ["LICENSE", "NOTICE"])
        contained(join(bundle, notice));
    }
    const suffix = platform === "win32" ? ".exe" : "";
    const required = [
      `bin/codex${suffix}`,
      `bin/codex-code-mode-host${suffix}`,
      `codex-path/rg${suffix}`,
    ];
    for (const file of required) {
      const path = contained(join(root, file));
      if (!statSync(path).isFile()) throw Error("MISSING_COMPONENT");
    }
    const binary = contained(join(root, metadata.entrypoint));
    const systemPath =
      platform === "win32"
        ? [
            join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
            process.env.SystemRoot ?? "C:\\Windows",
          ]
        : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
    return {
      binary,
      root,
      path: [join(root, "codex-path"), dirname(binary), ...systemPath].join(
        delimiter,
      ),
    };
  } catch {
    throw new AgentError(
      "UNAVAILABLE",
      location.packaged
        ? "MaterialsX 内置 Agent 运行文件缺失或版本不匹配，请重新安装 MaterialsX"
        : "项目缺少固定版本 Agent 依赖，请在 MaterialsX 项目执行 npm ci",
    );
  }
}
export function codexBinary(location?: CodexRuntimeLocation): string {
  return codexRuntime(location).binary;
}
