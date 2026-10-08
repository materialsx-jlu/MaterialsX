import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBuildStamp, sealBuild, inspectBuild } from "./build-identity.js";
import { baselineTiming } from "./baseline-timing.js";
import type { QualificationFingerprint } from "../../../contracts/src/qualification.js";
import type { TaskExecution } from "../../../contracts/src/task-execution.js";
const fp: QualificationFingerprint = { sourceSha256: "a".repeat(64), suiteSha256: "b".repeat(64),
  lockSha256: "c".repeat(64), version: "test", pi: "test", codex: "test", mcp: "test" };
test("build identity detects modified, extra and missing bytes and a different loaded bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "mx-build-"));
  try {
    for (const dir of ["main", "preload", "renderer"]) await mkdir(join(root, "apps/desktop", dir), { recursive: true });
    const paths = ["main/index.js", "preload/index.cjs", "renderer/index.html"];
    for (const p of paths) await writeFile(join(root, "apps/desktop", p), p);
    assert.equal((await inspectBuild(root)).status, "unattested");
    const stamp = createBuildStamp(fp);
    const save = async () => writeFile(join(root, "build-identity.json"), JSON.stringify(await sealBuild(root, stamp)));
    await save();
    assert.equal((await inspectBuild(root, stamp)).status, "verified");
    assert.equal((await inspectBuild(root, createBuildStamp({ ...fp, version: "other" }))).status, "mismatch");
    await writeFile(join(root, "apps/desktop/main/index.js"), "changed");
    assert.equal((await inspectBuild(root, stamp)).status, "mismatch");
    await save();
    await writeFile(join(root, "apps/desktop/renderer/extra.js"), "extra");
    assert.equal((await inspectBuild(root, stamp)).status, "mismatch");
    await rm(join(root, "apps/desktop/renderer/extra.js"));
    await rm(join(root, "apps/desktop/preload/index.cjs"));
    assert.equal((await inspectBuild(root, stamp)).status, "mismatch");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("build manifest rejects traversal and symlink entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "mx-build-"));
  try {
    await mkdir(join(root, "apps/desktop"), { recursive: true });
    await symlink("/etc/hosts", join(root, "apps/desktop/outside"));
    await assert.rejects(sealBuild(root, createBuildStamp(fp)), /BUILD_SYMLINK/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("baseline timing preserves overlapping operations, unknown ends and unknown token usage", () => {
  const state = { requests: [
    { id: "r1", phase: "execute", startedAt: 110, endedAt: 160, firstTokenAt: 125, state: "completed", usage: null },
    { id: "r2", phase: "execute", startedAt: 150, endedAt: null, firstTokenAt: null, state: "unknown", usage: null },
  ], attempts: [{ id: "a", method: "read", startedAt: 155, endedAt: 175, state: "completed" }] } as unknown as TaskExecution;
  const out = baselineTiming(state, [], 100, 200, 105);
  assert.equal(out.totalMs, 100); assert.equal(out.requestUnionMs, 90);
  assert.equal(out.toolUnionMs, 20); assert.equal(out.unclassifiedMs, 10);
  assert.equal(out.unresolvedRequests, 1); assert.equal(out.firstFeedbackMs, 5);
  assert.equal(out.firstProviderDeltaMs, 25); assert.equal(out.inputTokens, null);
  assert.equal(out.intervals.requests[1]?.endMs, null);
});
