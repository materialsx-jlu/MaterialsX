import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { qualificationCases } from "../../../../fixtures/agent/ua14-cases.js";
import {
  benchmarkResult,
  qualificationFingerprint,
} from "../../../contracts/src/qualification.js";
import { signMetadata } from "../../../atomistic/src/signed-metadata.js";
import { qualifyRelease, releaseChecks } from "./gate.js";
import { executionMetrics, percentile } from "./metrics.js";
import {
  productionPath,
  publicResourcePath,
  checkPublicText,
  auditProductionPackage,
} from "../../../../scripts/release-package-audit.mjs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackage } from "@electron/asar";
const sha = "a".repeat(64),
  fp = qualificationFingerprint.parse({
    sourceSha256: sha,
    suiteSha256: sha,
    lockSha256: sha,
    version: "fixture",
    pi: "0.99.1",
    codex: "0.160.0",
    mcp: "1.31.0",
  });
const now = Date.parse("2026-10-06T00:00:00.000Z");
test("sixty distinct frozen engineering cases carry paired languages and scalar tolerances", () => {
  assert.equal(qualificationCases.length, 60);
  assert.equal(new Set(qualificationCases.map((c) => c.id)).size, 60);
  for (const c of qualificationCases) {
    assert(c.prompt.zh && c.prompt.en);
    assert.equal(c.scientificStatus, "synthetic-engineering-only");
    assert.equal(c.absoluteTolerance, 1e-10);
  }
  assert.deepEqual(
    [...new Set(qualificationCases.map((c) => c.family))],
    ["file-edit", "summary", "fit", "comparison", "incompatible", "missing"],
  );
});
test("missing usage is unknown; fields from one request do not make incomplete usage complete", () => {
  assert.equal(executionMetrics(null, 10, null).inputTokens, null);
  const state = {
    requests: [
      {
        usage: {
          input_tokens: 100,
          output_tokens: 4,
          input_tokens_details: { cached_tokens: 80 },
        },
        state: "completed",
      },
      { usage: null, state: "unknown" },
    ],
    attempts: [],
  } as any;
  assert.equal(executionMetrics(state, 10, 1).inputTokens, null);
  assert.equal(executionMetrics(state, 10, 1).recoveries, 1);
  assert.equal(percentile([1, 4, 2, 3], 0.95), 4);
});
test("release rejects old booleans, incomplete cells, missing model identity and different same-case conditions", () => {
  const base = {
    fingerprint: fp,
    benchmark: { passed: true, total: 60 },
    attestations: [],
    trust: null,
    artifactSha256: null,
    technicalPassed: false,
    now,
  };
  assert(!qualifyRelease(base).formalReleaseReady);
  const rows = qualificationCases.flatMap((c) =>
    ["zh", "en"].flatMap((locale) =>
      ["pi", "codex", "reference-codex"].map((subject) =>
        benchmarkResult.parse({
          caseId: c.id,
          locale,
          subject,
          conditionSha256: sha,
          inputSha256: sha,
          model: {
            id: "model-" + "a".repeat(32),
            source: "local",
            modelId: "fixture",
            endpoint: "http://127.0.0.1:1234/v1",
            protocol: "chat-completions",
            contextWindow: 8192,
            maxOutputTokens: 512,
            revision: "frozen",
          },
          weightsSha256: sha,
          platform: "darwin-arm64",
          machineSha256: sha,
          startedAt: new Date(now).toISOString(),
          passed: true,
          checks: { receipts: true },
          grant: {
            grantId: "11111111-1111-4111-8111-111111111113",
            projectId: "11111111-1111-4111-8111-111111111111",
            conversationId: "11111111-1111-4111-8111-111111111112",
            permissions: ["read", "search"],
            approvedBy: "local-user",
            maxCredits: null,
            maxSeconds: 90,
          },
          taskState: "completed_with_limitations",
          metrics: {
            totalMs: 10,
            firstOutputMs: 1,
            inputTokens: 100,
            cachedInputTokens: 1,
            outputTokens: 10,
            requests: 1,
            tools: 1,
            recoveries: 0,
          },
          artifacts: [],
          finalTextSha256: sha,
          error: null,
          journalSha256: sha,
        }),
      ),
    ),
  );
  const benchmark = {
    schemaVersion: "ua14-benchmark-v1",
    fingerprint: fp,
    createdAt: new Date(now).toISOString(),
    expectedCases: 60,
    results: rows,
    reference: "unmodified-bundled-codex-app-server-with-same-host-tools",
    scientificQualification: false,
    externalModelCalls: 0,
  };
  const good = qualifyRelease({ ...base, benchmark });
  assert(good.checks.find((c) => c.id === "same-model-conditions")?.passed);
  assert(!good.formalReleaseReady);
  rows[0]!.weightsSha256 = null;
  assert(
    !qualifyRelease({ ...base, benchmark }).checks.find(
      (c) => c.id === "same-model-conditions",
    )?.passed,
  );
  rows[0]!.weightsSha256 = sha;
  rows[0]!.conditionSha256 = "b".repeat(64);
  assert(
    !qualifyRelease({ ...base, benchmark }).checks.find(
      (c) => c.id === "same-model-conditions",
    )?.passed,
  );
});
test("signed independent evidence binds source, artifact, reviewer, category, expiry and trust revocation", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519"),
    key = {
      id: "expert-key",
      reviewerId: "expert-user",
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      categories: ["science"],
      revoked: false,
    };
  const payload = {
    schemaVersion: "ua14-release-evidence-v1",
    fingerprint: fp,
    category: "science",
    platform: "all",
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
    reviewerId: "expert-user",
    artifactSha256: sha,
    reportSha256: sha,
    checks: Object.fromEntries(releaseChecks.science.map((k) => [k, true])),
  };
  const signed = signMetadata(payload, "expert-key", privateKey),
    input = {
      fingerprint: fp,
      benchmark: null,
      attestations: [signed],
      trust: { keys: [key] },
      artifactSha256: sha,
      technicalPassed: true,
      now,
    };
  assert(
    qualifyRelease(input).checks.find((c) => c.id === "science:all")?.passed,
  );
  assert(
    !qualifyRelease({ ...input, artifactSha256: "b".repeat(64) }).checks.find(
      (c) => c.id === "science:all",
    )?.passed,
  );
  key.revoked = true;
  assert(!qualifyRelease(input).scientificQualification);
  key.revoked = false;
  signed.payload.expiresAt = new Date(now - 1).toISOString();
  assert(!qualifyRelease(input).scientificQualification);
});
test("actual ASAR audit rejects development harnesses and secrets, preserves valid Skill scripts", async () => {
  assert(!productionPath("dist/scripts/local-payment-probe.js"));
  assert(!productionPath("dist/a.test.js"));
  assert(productionPath("dist/apps/desktop/main/index.js"));
  assert(
    publicResourcePath(
      "vendor/materialsx-default-skills/skills/paper/scripts/prepare_document_set.py",
    ),
  );
  assert(!publicResourcePath("vendor/skills/.env"));
  assert(checkPublicText("sk-" + "Q".repeat(30)));
  const temp = await mkdtemp(join(tmpdir(), "mx-ua14-package-"));
  try {
    const source = join(temp, "source"),
      resources = join(temp, "resources");
    await mkdir(source);
    await mkdir(resources);
    await writeFile(join(source, "index.js"), 'console.log("safe")');
    await createPackage(source, join(resources, "app.asar"));
    assert((await auditProductionPackage(resources)).passed);
    await mkdir(join(source, "tests"));
    await writeFile(
      join(source, "tests", "smoke.js"),
      'console.log("fixture")',
    );
    await createPackage(source, join(resources, "app.asar"));
    await assert.rejects(
      auditProductionPackage(resources),
      /forbidden-build-content/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("current technical proof requires complete recipes and genuine log digests, not only pass flags", async () => {
  const { verifyTechnical, technicalStepIds } = await import("./technical.js");
  const r = {
    schemaVersion: "ua14-technical-v1",
    fingerprint: fp,
    startedAt: new Date(now - 1000).toISOString(),
    finishedAt: new Date(now).toISOString(),
    steps: technicalStepIds.map((id) => ({
      id,
      command: "fixture-only",
      exitCode: 0,
      elapsedMs: 1,
      outputSha256: sha,
    })),
    complete: true,
    passed: true,
    scientificQualification: false,
    modelSemanticQualification: false,
  };
  assert(await verifyTechnical(r, fp, async () => sha, now));
  assert(!(await verifyTechnical(r, fp, async () => null, now)));
  assert(!(await verifyTechnical(r, fp, async () => sha, now + 86400001)));
  r.steps.pop();
  assert(!(await verifyTechnical(r, fp, async () => sha, now)));
});
