import { z } from "zod";
import {
  digestSchema,
  qualificationFingerprint,
  type QualificationFingerprint,
} from "../../../contracts/src/qualification.js";
import { canonical } from "../../../atomistic/src/discovery-io.js";
export const technicalStepIds = [
  "check",
  "test",
  "control-plane:test",
  "m5:contracts:check",
  "m6:contracts:check",
  "skills:accept",
  "ua7:numeric",
  "ua8:numeric",
  "ua9:numeric",
  "ua10:reference",
  "ua13:engines",
  "build",
  "secret-scan",
  "migration",
  "python-regression",
] as const;
const schema = z.strictObject({
  schemaVersion: z.literal("ua14-technical-v1"),
  fingerprint: qualificationFingerprint,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  steps: z.array(
    z.strictObject({
      id: z.enum(technicalStepIds),
      command: z.string(),
      exitCode: z.number().int(),
      elapsedMs: z.number().nonnegative(),
      outputSha256: digestSchema,
    }),
  ),
  complete: z.boolean(),
  passed: z.boolean(),
  scientificQualification: z.literal(false),
  modelSemanticQualification: z.literal(false),
});
/** Verify actual captured log hashes and completed recipes; stale flags alone never grant current qualification. */
export async function verifyTechnical(
  raw: unknown,
  fp: QualificationFingerprint,
  logHash: (index: number) => Promise<string | null>,
  now = Date.now(),
) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return false;
  const r = parsed.data;
  if (
    !r.complete ||
    !r.passed ||
    canonical(r.fingerprint) !== canonical(fp) ||
    r.steps.length !== technicalStepIds.length ||
    Date.parse(r.finishedAt) > now + 300000 ||
    Date.parse(r.startedAt) > Date.parse(r.finishedAt) ||
    now - Date.parse(r.finishedAt) > 86400000
  )
    return false;
  for (const [i, s] of r.steps.entries())
    if (
      s.id !== technicalStepIds[i] ||
      s.exitCode !== 0 ||
      (await logHash(i)) !== s.outputSha256
    )
      return false;
  return true;
}
