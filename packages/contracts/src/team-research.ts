import { z } from "zod";
import { moosRefSchema } from "./research-project.js";
const id = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.:-]+$/),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const teamRole = z.enum(["reader", "editor", "reviewer"]);
export const teamScope = z.strictObject({
  sourceId: z.number().int().positive().safe(),
  experimentId: z.number().int().positive().safe(),
});
export const teamProject = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  ownerId: id,
  revision: z.number().int().positive(),
  scopes: z.array(teamScope).max(100),
  description: z.string().max(2000),
  updatedAt: z.iso.datetime(),
});
export type TeamProject = z.infer<typeof teamProject>;
export const teamMember = z.strictObject({
  accountId: id,
  role: teamRole,
  active: z.boolean(),
  revision: z.number().int().positive(),
});
export type TeamMember = z.infer<typeof teamMember>;
export const teamLink = z
  .strictObject({
    enabled: z.boolean(),
    remoteProjectId: z.uuid().nullable(),
    revision: z.number().int().positive(),
  })
  .refine((v) => !v.enabled || !!v.remoteProjectId, "Remote project required");
export type TeamLink = z.infer<typeof teamLink>;
export const teamManifest = z.strictObject({
  materialSystem: z.string().max(300),
  conditions: z.array(z.string().min(1).max(2000)).max(32),
  notes: z.string().max(8000),
  refs: z.array(moosRefSchema).max(100),
  revision: z.number().int().positive(),
});
export type TeamManifest = z.infer<typeof teamManifest>;
const scalar = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const correctionInput = z
  .strictObject({
    requestId: z.uuid(),
    ref: moosRefSchema,
    pointer: z
      .string()
      .regex(
        /^\/(?:observations|recipes|ingredients|processes|nodes)\/\d+\/[A-Za-z][A-Za-z0-9_]*(?:\/[A-Za-z0-9_-]+)*$/,
      )
      .max(300),
    before: scalar,
    after: scalar,
    reason: z.string().min(10).max(2000),
    evidenceId: z.string().min(1).max(220),
    humanConfirmed: z.literal(true),
  })
  .refine(
    (v) => JSON.stringify(v.before) !== JSON.stringify(v.after),
    "Correction must change a value",
  );
export type CorrectionInput = z.infer<typeof correctionInput>;
export const correctionSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  authorId: id,
  input: correctionInput,
  targetEntityId: z.string().min(1).max(220),
  status: z.enum([
    "proposed",
    "rejected",
    "approved-awaiting-upstream",
    "applied",
  ]),
  revision: z.number().int().positive(),
  reviewerId: id.nullable(),
  reviewReason: z.string().max(2000),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  newRef: moosRefSchema.nullable(),
  upstreamReceiptSha256: hash.nullable(),
});
export type Correction = z.infer<typeof correctionSchema>;
export const correctionReview = z.strictObject({
  expectedRevision: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(10).max(2000),
  humanConfirmed: z.literal(true),
});
export const correctionConfirm = z.strictObject({
  expectedRevision: z.number().int().positive(),
  newRef: moosRefSchema,
  humanConfirmed: z.literal(true),
});
export const memberChange = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  role: teamRole,
  active: z.boolean(),
  reason: z.string().min(5).max(500),
});
export const teamAudit = z.strictObject({
  sequence: z.number().int().positive(),
  projectId: z.uuid(),
  actorId: id,
  action: z.string(),
  targetId: z.string(),
  detailSha256: hash,
  createdAt: z.iso.datetime(),
});
export const teamOverview = z.strictObject({
  project: teamProject,
  member: teamMember,
  members: z.array(teamMember).max(200),
  manifest: teamManifest,
  manifestAccessChanged: z.boolean(),
  proposals: z.array(correctionSchema).max(200),
  audit: z.array(teamAudit).max(100),
  production: z.boolean(),
  cloudExportAuthorized: z.literal(false),
});
export type TeamOverview = z.infer<typeof teamOverview>;
export type TeamWorkspace = {
  link: TeamLink;
  identityConfigured: boolean;
  remote: TeamOverview | null;
  error: string | null;
};
export interface TeamResearchAPI {
  importTeamManifest(
    projectId: string,
  ): Promise<import("./research-project.js").ResearchProject>;
  getTeamResearch(projectId: string): Promise<TeamWorkspace>;
  listTeamProjects(): Promise<
    Array<{
      id: string;
      name: string;
      role: z.infer<typeof teamRole>;
    }>
  >;
  saveTeamLink(
    projectId: string,
    link: TeamLink,
    expectedRevision: number,
  ): Promise<TeamLink>;
  saveTeamManifest(
    projectId: string,
    manifest: TeamManifest,
    expectedRevision: number,
  ): Promise<TeamManifest>;
  changeTeamMember(
    projectId: string,
    accountId: string,
    input: z.infer<typeof memberChange>,
  ): Promise<TeamMember>;
  proposeResearchCorrection(
    projectId: string,
    input: CorrectionInput,
  ): Promise<Correction>;
  reviewResearchCorrection(
    projectId: string,
    id: string,
    input: z.infer<typeof correctionReview>,
  ): Promise<Correction>;
  exportResearchCorrection(
    projectId: string,
    id: string,
  ): Promise<{
    path: string;
    sha256: string;
    bytes: number;
  }>;
  confirmResearchCorrection(
    projectId: string,
    id: string,
    input: z.infer<typeof correctionConfirm>,
  ): Promise<Correction>;
}
