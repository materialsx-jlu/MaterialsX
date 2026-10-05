import { dirname, resolve } from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { AgentError } from "../../contracts/src/agent.js";
/** Outer sandbox also restricts reads. Codex workspace-write alone only restricts writes. */
export async function codexSandbox(
  binary: string,
  home: string,
  project: string,
  endpoints: string[] = [],
) {
  if (process.platform !== "darwin")
    throw new AgentError(
      "UNAVAILABLE",
      "Codex 项目隔离目前已验收 macOS；其他平台暂使用 Pi",
    );
  home = await realpath(home);
  project = await realpath(project);
  binary = await realpath(binary);
  const temporary = resolve(home, "tmp");
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  const quoted = (p: string) => JSON.stringify(resolve(p));
  const readRoots = [
    "/private/preboot/Cryptexes/OS",
    "/private/etc",
    "/Library/Preferences",
    "/private/var/db/dyld",
    "/System/Library",
    "/System/Applications",
    "/System/Volumes/Preboot",
    "/System/Cryptexes",
    "/usr",
    "/bin",
    "/sbin",
    "/Library/Apple",
    "/opt/homebrew/Cellar",
    "/opt/homebrew/bin",
    "/opt/homebrew/opt",
    ...(dirname(dirname(binary))!=="/"?[dirname(dirname(binary))]:[]),
  ];
  const ports = endpoints.map((endpoint) => {
    const url = new URL(endpoint);
    if (url.hostname !== "127.0.0.1" || !url.port) throw new AgentError("PERMISSION_DENIED", "沙箱仅允许宿主管理的 loopback 服务");
    return url.port;
  });
  const profile = `(version 1)
(deny default)
(allow process* sysctl-read mach* ipc* signal)
(allow file-read-metadata)
(allow file-read* (literal "/"))
(allow file-read* file-write* (subpath "/dev"))
(allow file-read* ${readRoots.map((p) => `(subpath ${quoted(p)})`).join(" ")})
(allow file-read* file-write* (subpath ${quoted(project)}) (subpath ${quoted(home)}) (subpath ${quoted(temporary)}))
${ports.map((port) => `(allow network-outbound (remote ip "localhost:${port}"))`).join("\n")}
(allow network-inbound (local ip "localhost:*"))`;
  // Deny known credential filenames even when they are inside the approved project.
  const secrets =
    "(^|/)(\\.env(\\.[^/]*)?|[^/]*\\.env|[^/]*\\.(pem|key|p12|pfx)|id_rsa|id_ed25519|auth\\.json|credentials\\.json)$";
  const scoped =
    profile + `\n(deny file-read* (regex ${JSON.stringify(secrets)}))`;
  return {
    command: "/usr/bin/sandbox-exec",
    args: ["-p", scoped, binary, "app-server", "--stdio"],
    temporary,
  };
}
