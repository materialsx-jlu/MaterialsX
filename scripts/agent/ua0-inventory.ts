import {codexBinary} from '../../packages/agent/src/codex-engine.js';
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { resolve } from "node:path";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { sourceInventory } from "../check-source-size.js";

const root = process.cwd(), directory = resolve("runtime/agent/ua-0");
const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const status = git(["status", "--porcelain=v1", "--untracked-files=all"]).split("\n").filter(Boolean);
const files = await sourceInventory(root);
async function hash(path: string) { return createHash("sha256").update(await readFile(resolve(path))).digest("hex"); }
const ownership = [
  ["contracts", "packages/contracts/src/", "Product identities, action schemas, scientific states; ResearchGoalPlan implementation remains UA.1"],
  ["sessions", "packages/pi-adapter/src/local-session.ts", "Pi run/cancel/dispose and persisted session; no second tool loop"],
  ["document tools", "packages/pi-adapter/src/local-session-tools.ts", "Existing PDF read and RPSME guard helpers, compatible public exports"],
  ["RPSME", "packages/pi-adapter/src/rpsme-workflow.ts", "Real per-page extraction and artifact checks; keep independent until UA.6 migration"],
  ["science bridge", "packages/pi-adapter/src/science-bridge.ts", "Shared M6 selection and execution; engines delegate, never duplicate physics"],
  ["project storage", "apps/desktop/main/store.ts", "WorkspaceStore owns projects, conversations, messages, run ledger"],
  ["scientific execution", "packages/atomistic/src/runtime.ts", "Real workers, receipts and artifact verification"],
  ["weights", "packages/atomistic/src/catalog-weights.ts", "Catalogue installation uses existing package and adapter services"],
  ["discovery", "packages/atomistic/src/catalog-updates.ts", "Signed/reviewed catalogue updates; do not create second registry"],
  ["stream buffer", "packages/pi-adapter/src/text-stream-buffer.ts", "Existing bounded UI buffering; unify event IDs in UA.3"],
  ["cloud session", "packages/pi-adapter/src/platform-session.ts", "Pi Responses with platform task/request IDs"],
  ["billing", "services/control-plane/internal/gateway/", "M5 gateway/identity/metering/payments keep ownership"],
  ["MOOS", "/Users/user/Code/MOOS/go-backend/internal/knowledge/", "Source facts/review/version/assets remain in MOOS; adapter only in UA.2"],
];
const report = {
  stage: "UA.0", measuredAt: new Date().toISOString(), head: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]),
  dirty: status.length > 0, preexistingChangesPreserved: true,
  workingTree: { entries: status.length, trackedChanges: status.filter(line => !line.startsWith("??")).length,
    untracked: status.filter(line => line.startsWith("??")).length },
  runtime: { node: process.version, platform: `${platform()}-${arch()}`, pi: pkg.dependencies["@earendil-works/pi-coding-agent"],
    mcpSdk: pkg.dependencies["@modelcontextprotocol/sdk"], protocol: LATEST_PROTOCOL_VERSION, supportedProtocols: SUPPORTED_PROTOCOL_VERSIONS,
    codex: "0.160.0", codexInterface: "app-server v2 stdio JSON-RPC", productionProvider: "existing M5 gateway; compatibility not validated until UA.1",
    localProvider: "LM Studio OpenAI-compatible /v1; loaded model metadata measured separately" },
  hashes: { packageLock: await hash("package-lock.json"), gold: await hash("fixtures/agent/research-goals.v1.json"),
    codexBinary: await hash(codexBinary()),
    codexClientSchema: await hash("runtime/agent/ua-0/codex-schema/ClientRequest.json") },
  build: { core: pkg.scripts["build:core"], desktop: pkg.scripts["build:desktop"], admin: pkg.scripts["build:admin"],
    tests: pkg.scripts.test, go: pkg.scripts["control-plane:test"], python: "uv run --project python --frozen pytest python/tests" },
  sourceSize: { limit: 600, count: files.length, violations: files.filter(file => file.lines > 600), largest: files.slice(0, 10) },
  ownership,
};
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "inventory.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ head: report.head, workingTree: report.workingTree, runtime: report.runtime, sourceSize: report.sourceSize }, null, 2));
