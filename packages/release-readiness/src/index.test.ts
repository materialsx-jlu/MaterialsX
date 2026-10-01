import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createReleaseReadiness, redactSupportData } from "./index.js";

describe("release readiness", () => {
  it("keeps unmet release requirements visible as blockers", () => {
    const report = createReleaseReadiness({
      version: "0.0.1",
      platform: "darwin-arm64",
      packaged: false,
      signed: false,
      skillCount: 18,
      licenseBlocked: 0,
      databaseIntegrity: "ok",
      runtimeReady: 7,
      runtimeTotal: 8,
      macOSInstallEvidence: false,
      windowsInstallEvidence: false,
      scienceEvaluationEvidence: false,
      updateRollbackEvidence: false,
    });
    assert.ok(report.blocked >= 6);
    assert.equal(report.checks.find((item) => item.id === "skills-target")?.status, "blocked");
    assert.equal(report.checks.find((item) => item.id === "runtime-health")?.status, "warning");
  });

  it("accepts the expanded default Skill catalog", () => {
    const report = createReleaseReadiness({
      version: "0.0.1",
      platform: "darwin-arm64",
      packaged: true,
      signed: false,
      skillCount: 84,
      licenseBlocked: 0,
      databaseIntegrity: "ok",
      runtimeReady: 8,
      runtimeTotal: 8,
      macOSInstallEvidence: false,
      windowsInstallEvidence: false,
      scienceEvaluationEvidence: false,
      updateRollbackEvidence: false,
    });
    assert.equal(report.checks.find((item) => item.id === "skills-target")?.status, "pass");
  });

  it("redacts secrets, paths, endpoints and research content recursively", () => {
    const redacted = redactSupportData({
      apiKey: "secret",
      projectPath: "/Users/research/private",
      localEndpoint: "http://127.0.0.1:1234/v1",
      nested: { messageContent: "unpublished result", status: "ready" },
    });
    assert.deepEqual(redacted, {
      apiKey: "[REDACTED]",
      projectPath: "[REDACTED]",
      localEndpoint: "[REDACTED]",
      nested: { messageContent: "[REDACTED]", status: "ready" },
    });
  });
});
