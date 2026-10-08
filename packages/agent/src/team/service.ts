import { randomUUID } from "node:crypto";
import {
  correctionInput,
  correctionReview,
  correctionConfirm,
  memberChange,
  teamManifest,
  type Correction,
} from "../../../contracts/src/team-research.js";
import type { TeamActor } from "./auth.js";
import { TeamProjection, atPointer } from "./projection.js";
import { digest } from "./store.js";
export class TeamResearchService {
  constructor(
    readonly projection: TeamProjection,
    readonly production: boolean,
  ) {}
  get store() {
    return this.projection.store;
  }
  overview(project: string, actor: TeamActor) {
    const member = this.store.require(project, actor.id);
    const allowed = (ref: unknown) => {
      try {
        this.projection.assertRef(project, ref);
        return true;
      } catch {
        return false;
      }
    };
    const original = this.store.manifest(project),
      manifestAccessChanged = original.refs.some((ref) => !allowed(ref));
    const manifest = manifestAccessChanged
      ? {
          ...original,
          materialSystem: "",
          conditions: [],
          notes: "",
          refs: original.refs.filter(allowed),
        }
      : original;
    return {
      project: this.store.project(project),
      member,
      members:
        this.store.project(project).ownerId === actor.id
          ? this.store.members(project)
          : [member],
      manifest,
      manifestAccessChanged,
      proposals: this.store
        .corrections(project)
        .filter(
          (c) => allowed(c.input.ref) && (!c.newRef || allowed(c.newRef)),
        ),
      audit: this.store.events(project),
      production: this.production,
      cloudExportAuthorized: false,
    };
  }
  changeMember(
    project: string,
    actor: TeamActor,
    account: string,
    input: unknown,
  ) {
    return this.store.transaction(() => {
      const p = this.store.project(project);
      this.store.require(project, actor.id);
      if (p.ownerId !== actor.id || p.ownerId === account)
        throw Error("TEAM_OWNER_REQUIRED");
      const q = memberChange.parse(input),
        old = this.store.member(project, account);
      if ((old?.revision ?? 0) !== q.expectedRevision)
        throw Error("TEAM_CONFLICT");
      if (!old && this.store.members(project).length >= 200)
        throw Error("TEAM_MEMBER_LIMIT");
      const next = this.store.setMember(project, account, {
        accountId: account,
        role: q.role,
        active: q.active,
        revision: q.expectedRevision + 1,
      });
      this.store.audit(project, actor.id, "member.changed", account, q);
      return next;
    });
  }
  async saveManifest(
    project: string,
    actor: TeamActor,
    input: unknown,
    expected: number,
    signal: AbortSignal,
    revalidate: () => Promise<void> = async () => {},
  ) {
    this.store.require(project, actor.id, ["editor"]);
    const grant = this.projection.grant(project, actor.id),
      v = teamManifest.parse(input);
    for (const ref of v.refs) {
      this.projection.assertRef(project, ref);
      await this.projection.raw(
        "moos_get_experiment",
        { ref, section: "observations", limit: 1 },
        signal,
      );
    }
    await revalidate();
    return this.store.transaction(() => {
      this.projection.check(project, actor.id, grant);
      const result = this.store.saveManifest(project, v, expected);
      this.store.audit(project, actor.id, "manifest.saved", project, {
        sha256: digest(result),
        revision: result.revision,
      });
      return result;
    });
  }
  async propose(
    project: string,
    actor: TeamActor,
    input: unknown,
    signal: AbortSignal,
    revalidate: () => Promise<void> = async () => {},
  ) {
    this.store.require(project, actor.id, ["editor"]);
    const q = correctionInput.parse(input),
      existing = this.store.request(project, q.requestId);
    if (existing) {
      if (
        existing.authorId !== actor.id ||
        digest(existing.input) !== digest(q)
      )
        throw Error("TEAM_IDEMPOTENCY_CONFLICT");
      return existing;
    }
    const grant = this.projection.grant(project, actor.id),
      ref = this.projection.assertRef(project, q.ref),
      data = await this.projection.record(ref, signal);
    if (
      digest(atPointer(data, q.pointer)) !== digest(q.before) ||
      !data.evidence?.some((e) => e.id === q.evidenceId)
    )
      throw Error("TEAM_CORRECTION_EVIDENCE_MISMATCH");
    await this.projection.raw(
      "moos_get_evidence",
      { ref, evidenceId: q.evidenceId },
      signal,
    );
    await revalidate();
    return this.store.transaction(() => {
      this.projection.check(project, actor.id, grant);
      const duplicate = this.store.request(project, q.requestId);
      if (duplicate) {
        if (
          duplicate.authorId !== actor.id ||
          digest(duplicate.input) !== digest(q)
        )
          throw Error("TEAM_IDEMPOTENCY_CONFLICT");
        return duplicate;
      }
      const now = new Date().toISOString(),
        c: Correction = {
          id: randomUUID(),
          projectId: project,
          authorId: actor.id,
          input: q,
          status: "proposed",
          revision: 1,
          reviewerId: null,
          reviewReason: "",
          createdAt: now,
          updatedAt: now,
          newRef: null,
          upstreamReceiptSha256: null,
          targetEntityId: String(
            atPointer(data, q.pointer.split("/").slice(0, 3).join("/")).id ??
              "",
          ),
        };
      this.store.saveCorrection(c, null);
      this.store.audit(project, actor.id, "correction.proposed", c.id, q);
      return c;
    });
  }
  async review(
    project: string,
    actor: TeamActor,
    id: string,
    input: unknown,
    signal: AbortSignal,
    revalidate: () => Promise<void> = async () => {},
  ) {
    this.store.require(project, actor.id, ["reviewer"]);
    const q = correctionReview.parse(input),
      c = this.store.correction(project, id),
      grant = this.projection.grant(project, actor.id);
    if (c.authorId === actor.id)
      throw Error("TEAM_INDEPENDENT_REVIEWER_REQUIRED");
    if (c.status !== "proposed" || c.revision !== q.expectedRevision)
      throw Error("TEAM_CONFLICT");
    this.projection.assertRef(project, c.input.ref);
    if (q.decision === "approve") {
      const data = await this.projection.record(c.input.ref, signal);
      if (digest(atPointer(data, c.input.pointer)) !== digest(c.input.before))
        throw Error("TEAM_SOURCE_STALE");
      await this.projection.raw(
        "moos_get_evidence",
        { ref: c.input.ref, evidenceId: c.input.evidenceId },
        signal,
      );
    }
    await revalidate();
    return this.store.transaction(() => {
      this.projection.check(project, actor.id, grant);
      const next = this.store.saveCorrection(
        {
          ...c,
          status:
            q.decision === "approve"
              ? "approved-awaiting-upstream"
              : "rejected",
          revision: c.revision + 1,
          reviewerId: actor.id,
          reviewReason: q.reason,
          updatedAt: new Date().toISOString(),
        },
        c.revision,
      );
      this.store.audit(project, actor.id, "correction." + q.decision, id, q);
      return next;
    });
  }
  packet(project: string, actor: TeamActor, id: string) {
    this.store.require(project, actor.id, ["editor", "reviewer"]);
    const c = this.store.correction(project, id);
    if (c.status !== "approved-awaiting-upstream")
      throw Error("TEAM_CORRECTION_NOT_APPROVED");
    this.projection.assertRef(project, c.input.ref);
    const packet = {
      schemaVersion: "ua13-moos-correction-v1",
      correction: c,
      correctionSha256: digest(c),
      canonicalWritePerformed: false,
      scientificStatus: "needs_review",
      instructions:
        "Submit through the authorized MOOS import/review workflow. This packet does not modify canonical data. Confirm only after the upstream creates a genuine new generation.",
    };
    this.store.audit(project, actor.id, "correction.exported", id, {
      sha256: digest(packet),
    });
    return packet;
  }
  async confirm(
    project: string,
    actor: TeamActor,
    id: string,
    input: unknown,
    signal: AbortSignal,
    revalidate: () => Promise<void> = async () => {},
  ) {
    this.store.require(project, actor.id, ["reviewer"]);
    const q = correctionConfirm.parse(input),
      c = this.store.correction(project, id);
    if (c.authorId === actor.id)
      throw Error("TEAM_INDEPENDENT_REVIEWER_REQUIRED");
    if (
      c.status !== "approved-awaiting-upstream" ||
      c.revision !== q.expectedRevision
    )
      throw Error("TEAM_CONFLICT");
    const grant = this.projection.grant(project, actor.id),
      ref = this.projection.assertRef(project, q.newRef),
      old = c.input.ref;
    if (
      ref.sourceId !== old.sourceId ||
      ref.experimentId !== old.experimentId ||
      ref.generation <= old.generation ||
      ref.packageSha256 === old.packageSha256 ||
      ref.projectionSha256 === old.projectionSha256 ||
      ref.reviewStatus !== "verified"
    )
      throw Error("TEAM_NEW_REVIEWED_GENERATION_REQUIRED");
    const data = await this.projection.record(ref, signal);
    if (
      String(
        atPointer(data, c.input.pointer.split("/").slice(0, 3).join("/")).id ??
          "",
      ) !== c.targetEntityId
    )
      throw Error("TEAM_ENTITY_CHANGED");
    if (
      digest(atPointer(data, c.input.pointer)) !== digest(c.input.after) ||
      !data.evidence?.some((e) => e.id === c.input.evidenceId)
    )
      throw Error("TEAM_UPSTREAM_CORRECTION_MISMATCH");
    await this.projection.raw(
      "moos_get_evidence",
      { ref, evidenceId: c.input.evidenceId },
      signal,
    );
    await revalidate();
    return this.store.transaction(() => {
      this.projection.check(project, actor.id, grant);
      const next = this.store.saveCorrection(
        {
          ...c,
          status: "applied",
          revision: c.revision + 1,
          newRef: ref,
          upstreamReceiptSha256: digest({ ref, data }),
          updatedAt: new Date().toISOString(),
        },
        c.revision,
      );
      this.store.audit(project, actor.id, "correction.upstream-confirmed", id, {
        receiptSha256: next.upstreamReceiptSha256,
      });
      return next;
    });
  }
}
