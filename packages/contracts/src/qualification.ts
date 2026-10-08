import { z } from "zod";
import { modelConnectionSchema } from "./engine-selection.js";
import { permissionGrantSchema } from "./agent.js";
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const benchmarkSubject = z.enum(["pi", "codex", "reference-codex"]);
export const qualificationCase = z.strictObject({
  id: z.string().regex(/^UA14-\d{3}$/),
  family: z.enum([
    "file-edit",
    "summary",
    "fit",
    "comparison",
    "incompatible",
    "missing",
  ]),
  prompt: z.strictObject({ zh: z.string().min(20), en: z.string().min(20) }),
  seed: z.number().int().min(0),
  expected: z.strictObject({
    mean: z.number(),
    slope: z.number(),
    intercept: z.number(),
    unit: z.literal("MPa"),
  }),
  absoluteTolerance: z.literal(1e-10),
  scientificStatus: z.literal("synthetic-engineering-only"),
});
export type QualificationCase = z.infer<typeof qualificationCase>;
export const qualificationFingerprint = z.strictObject({
  sourceSha256: digestSchema,
  suiteSha256: digestSchema,
  lockSha256: digestSchema,
  version: z.string(),
  pi: z.string(),
  codex: z.string(),
  mcp: z.string(),
});
export type QualificationFingerprint = z.infer<typeof qualificationFingerprint>;
export const buildStampSchema = z.strictObject({
  schemaVersion: z.literal("materials-build-v1"), fingerprint: qualificationFingerprint,
  buildId: digestSchema, builtAt: z.iso.datetime(),
});
export type BuildStamp = z.infer<typeof buildStampSchema>;
export interface BuildIdentity {
  status: "verified" | "mismatch" | "unattested";
  stamp: BuildStamp | null; artifactSha256: string | null;
  checkedFiles: number; detail: string;
}
export const benchmarkResult = z.strictObject({
  caseId: qualificationCase.shape.id,
  locale: z.enum(["zh", "en"]),
  subject: benchmarkSubject,
  conditionSha256: digestSchema,
  inputSha256: digestSchema,
  model: modelConnectionSchema,
  weightsSha256: digestSchema.nullable(),
  platform: z.string(),
  machineSha256: digestSchema,
  startedAt: z.iso.datetime(),
  passed: z.boolean(),
  checks: z.record(z.string(), z.boolean()),
  grant: permissionGrantSchema.nullable(),
  taskState: z.string().nullable(),
  metrics: z.strictObject({
    totalMs: z.number().nonnegative(),
    firstOutputMs: z.number().nonnegative().nullable(),
    inputTokens: z.number().nonnegative().nullable(),
    cachedInputTokens: z.number().nonnegative().nullable(),
    outputTokens: z.number().nonnegative().nullable(),
    requests: z.number().int().nonnegative(),
    tools: z.number().int().nonnegative(),
    recoveries: z.number().int().nonnegative(),
  }),
  artifacts: z.array(
    z.strictObject({
      relativePath: z.string(),
      sha256: digestSchema,
      bytes: z.number().int().nonnegative(),
    }),
  ),
  finalTextSha256: digestSchema,
  error: z.string().nullable(),
  journalSha256: digestSchema.nullable(),
});
export type BenchmarkResult = z.infer<typeof benchmarkResult>;
export const benchmarkReport = z.strictObject({
  schemaVersion: z.literal("ua14-benchmark-v1"),
  fingerprint: qualificationFingerprint,
  createdAt: z.iso.datetime(),
  expectedCases: z.literal(60),
  results: z.array(benchmarkResult).max(360),
  reference: z.literal(
    "unmodified-bundled-codex-app-server-with-same-host-tools",
  ),
  scientificQualification: z.literal(false),
  externalModelCalls: z.literal(0),
});
export type BenchmarkReport = z.infer<typeof benchmarkReport>;
export const releaseEvidencePayload = z.strictObject({
  schemaVersion: z.literal("ua14-release-evidence-v1"),
  fingerprint: qualificationFingerprint,
  category: z.enum([
    "science",
    "installation",
    "signing",
    "license",
    "migration",
    "offline",
  ]),
  platform: z.enum(["darwin-arm64", "win32-x64", "linux-x64", "all"]),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  reviewerId: z.string().min(3),
  artifactSha256: digestSchema,
  checks: z.record(z.string(), z.literal(true)),
  reportSha256: digestSchema,
});
export const signedReleaseEvidence = z.strictObject({
  keyId: z.string(),
  payload: releaseEvidencePayload,
  payloadSha256: digestSchema,
  signature: z.string().max(200),
});
export const releaseTrust = z.strictObject({
  keys: z
    .array(
      z.strictObject({
        id: z.string().min(3),
        reviewerId: z.string().min(3),
        publicKey: z.string().max(4096),
        categories: z.array(releaseEvidencePayload.shape.category),
        revoked: z.boolean(),
      }),
    )
    .max(20),
});
export type SignedReleaseEvidence = z.infer<typeof signedReleaseEvidence>;
