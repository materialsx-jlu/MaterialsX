import {
  benchmarkReport,
  signedReleaseEvidence,
  releaseTrust,
  type QualificationFingerprint,
  type BenchmarkReport,
} from "../../../contracts/src/qualification.js";
import { canonical } from "../../../atomistic/src/discovery-io.js";
import { verifyMetadataSignature } from "../../../atomistic/src/signed-metadata.js";
import { qualifyReliability } from './reliability.js';
import { summarizeResults } from "./metrics.js";
export const releaseChecks = {
  science: [
    "heldout-real-sources",
    "sixty-gold-fields",
    "facts-units-citations",
    "domain-boundaries",
    "reproduction",
    "independent-expert-review",
  ],
  installation: [
    "actual-os-machine",
    "clean-install",
    "no-system-codex",
    "local-model",
    "terminal-patch-mcp",
    "permissions",
    "restart-switch",
    "real-artifacts",
  ],
  signing: [
    "official-signature",
    "signature-verified",
    "notarization-or-authenticode",
  ],
  license: [
    "dependencies-reviewed",
    "skills-and-model-rights",
    "sample-rights",
    "agpl-source-available",
  ],
  migration: [
    "old-projects",
    "m5-entitlements-unchanged",
    "m6-artifacts-unchanged",
    "backup-restore",
    "update-failure-rollback",
  ],
  offline: ["authorized-samples", "no-hidden-download", "bundled-runtime"],
} as const;
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
/** Fail closed. Old stages or booleans/file existence cannot qualify the current source tree. */
export function qualifyRelease(input: {
  fingerprint: QualificationFingerprint;
  benchmark: unknown;
  reliability?: unknown[];
  reliabilityVerified?: boolean;
  attestations: unknown[];
  trust: unknown;
  artifactSha256: string | null;
  technicalPassed: boolean;
  now?: number;
}) {
  const checks: Array<{ id: string; passed: boolean; reason: string }> = [];
  const check = (id: string, passed: boolean, reason: string) =>
    checks.push({ id, passed, reason });
  check(
    "technical-current",
    input.technicalPassed,
    "Requires current completed technical verification, not a previous stage report.",
  );
  let benchmark: BenchmarkReport | null = null;
  try {
    benchmark = benchmarkReport.parse(input.benchmark);
  } catch {
    /* Invalid/missing is a blocker. */
  }
  check(
    "benchmark-current",
    !!benchmark && equal(benchmark.fingerprint, input.fingerprint),
    "Benchmark must bind the exact source, suite and lockfile.",
  );
  check('ap6-evidence-verified',input.reliabilityVerified===true,'Verify actual per-batch reports, original baselines and captured log hashes.');
  const reliability=qualifyReliability(input.reliability??[],input.fingerprint);
  for(const c of reliability.checks)check(c.id,c.passed,c.reason);
  const rows = benchmark?.results ?? [];
  const keys = rows.map((r) => r.subject + ":" + r.caseId + ":" + r.locale);
  const cells = new Map(
    rows.map((r) => [r.subject + ":" + r.caseId + ":" + r.locale, r]),
  );
  const ids = Array.from(
    { length: 60 },
    (_, i) => "UA14-" + String(i + 1).padStart(3, "0"),
  );
  const complete =
    keys.length === 360 &&
    new Set(keys).size === 360 &&
    ids.every((id) =>
      ["zh", "en"].every((locale) =>
        ["pi", "codex", "reference-codex"].every((s) =>
          cells.has(s + ":" + id + ":" + locale),
        ),
      ),
    );
  check(
    "sixty-bilingual-three-subjects",
    complete,
    "60 cases × 2 languages × 3 subjects, without duplicates or omissions.",
  );
  const comparable =
    complete &&
    ids.every((id) =>
      ["zh", "en"].every((locale) => {
        const match = ["pi", "codex", "reference-codex"].map(
          (s) => cells.get(s + ":" + id + ":" + locale)!,
        );
        return match.every(
          (r) =>
            r.conditionSha256 === match[0]!.conditionSha256 &&
            r.inputSha256 === match[0]!.inputSha256 &&
            r.platform === match[0]!.platform &&
            r.machineSha256 === match[0]!.machineSha256 &&
            r.weightsSha256 !== null &&
            r.weightsSha256 === match[0]!.weightsSha256 &&
            equal(r.model, match[0]!.model) &&
            !!r.grant &&
            equal(
              { ...r.grant, grantId: "", projectId: "", conversationId: "" },
              {
                ...match[0]!.grant,
                grantId: "",
                projectId: "",
                conversationId: "",
              },
            ),
        );
      }),
    );
  check(
    "same-model-conditions",
    comparable,
    "Same weights, model revision/protocol, machine, input, budget and permissions; unknown identity cannot pass.",
  );
  const summary = summarizeResults(rows);
  const reference = summary.find((r) => r.subject === "reference-codex")!;
  for (const subject of ["pi", "codex"]) {
    const s = summary.find((r) => r.subject === subject)!;
    check(
      subject + "-success",
      complete &&
        s.completionRate !== null &&
        reference.completionRate !== null &&
        s.completionRate >= 0.9 &&
        reference.completionRate - s.completionRate <= 0.05,
      "At least 90%; within five percentage points of the same-model reference.",
    );
    check(
      subject + "-time",
      comparable &&
        !!s.p50TotalMs &&
        !!reference.p50TotalMs &&
        s.p50TotalMs <= 1.5 * reference.p50TotalMs,
      "Comparable median total duration ≤1.5× reference.",
    );
    check(
      subject + "-tokens",
      comparable &&
        s.totalTokens !== null &&
        reference.totalTokens !== null &&
        reference.totalTokens > 0 &&
        s.totalTokens <= 1.5 * reference.totalTokens,
      "Actual complete token usage ≤1.5× reference; unknown usage is not zero.",
    );
  }
  const trust = releaseTrust.safeParse(input.trust),
    now = input.now ?? Date.now();
  const trusted = trust.success
    ? trust.data.keys.filter((k) => !k.revoked)
    : [];
  const verified = input.attestations.flatMap((raw) => {
    const parsed = signedReleaseEvidence.safeParse(raw);
    if (!parsed.success) return [];
    const a = parsed.data,
      key = trusted.find((k) => k.id === a.keyId),
      p = a.payload;
    if (
      !key ||
      key.reviewerId !== p.reviewerId ||
      !key.categories.includes(p.category) ||
      !equal(p.fingerprint, input.fingerprint) ||
      p.artifactSha256 !== input.artifactSha256 ||
      Date.parse(p.issuedAt) > now + 300000 ||
      Date.parse(p.expiresAt) <= now ||
      Date.parse(p.expiresAt) - Date.parse(p.issuedAt) > 30 * 86400000 ||
      Date.parse(p.expiresAt) <= Date.parse(p.issuedAt) ||
      !verifyMetadataSignature(a, new Map([[key.id, key.publicKey]]))
    )
      return [];
    return [p];
  });
  check(
    "artifact-identity",
    input.artifactSha256 !== null,
    "Qualification binds the exact installer/distribution digest.",
  );
  for (const [category, required] of Object.entries(releaseChecks))
    for (const platform of [
      "installation",
      "signing",
      "migration",
      "offline",
    ].includes(category)
      ? ["darwin-arm64", "win32-x64", "linux-x64"]
      : ["all"])
      check(
        category + ":" + platform,
        verified.some(
          (a) =>
            a.category === category &&
            a.platform === platform &&
            required.every((k) => a.checks[k] === true),
        ),
        "Requires independently reviewed, current signed evidence for " +
          required.join(", ") +
          ".",
      );
  return {
    schemaVersion: "ua14-release-gate-v1",
    generatedAt: new Date(now).toISOString(),
    fingerprint: input.fingerprint,
    formalReleaseReady: checks.every((c) => c.passed),
    checks,
    summary,
    reliability,
    scientificQualification: checks.some(
      (c) => c.id === "science:all" && c.passed,
    ),
    referenceScope:
      "Open-source App Server with shared host tools; not the commercial Codex product",
  };
}
