import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  TeamResearchAPI,
  teamLink,
  teamManifest,
  teamOverview,
  teamMember,
  teamRole,
  correctionInput,
  correctionSchema,
  correctionReview,
  correctionConfirm,
  memberChange,
  type TeamLink,
  type TeamWorkspace,
} from "../../../packages/contracts/src/team-research.js";
import type { IdentityClient } from "../../../packages/control-plane-client/src/identity.js";
import { MaterialsMcpClient } from "../../../packages/agent/src/mcp-client.js";
import { SourceFailure } from "../../../packages/agent/src/data-source-router.js";
import type { WorkspaceStore } from "./store.js";
import type { ResearchService } from "./research-service.js";
/** Desktop transport owns no credentials or account database; the original M5 vault is the only credential source. */
export class TeamResearchWorkspace implements TeamResearchAPI {
  private clients = new Map<string, MaterialsMcpClient>();
  private accessKeys = new Map<string, string>();
  constructor(
    private store: WorkspaceStore,
    private research: ResearchService,
    private identity: Pick<IdentityClient, "origin" | "researchRequest">,
  ) {
    research.teamClient = (id) => this.source(id);
    research.teamAccessKey = (id) => this.accessKeys.get(id) ?? null;
    research.authorizeProject = (id, cloud) => this.authorize(id, cloud);
  }
  private owned(id: string) {
    z.uuid().parse(id);
    if (!this.store.getProject(id)) throw Error("TEAM_LOCAL_PROJECT_NOT_FOUND");
    return this.store.teamLink(id);
  }
  private idle(id: string) {
    this.owned(id);
    if (
      this.store
        .listConversations()
        .filter((c) => c.projectId === id)
        .some((c) =>
          this.store.agentJournal
            .forConversation(c.id)
            .some((t) => t.state === "running"),
        )
    )
      throw Error("TEAM_STOP_RUNNING_RESEARCH_FIRST");
  }
  private blocked(id: string) {
    for (const s of this.store.research.snapshots(id).filter((s) => s.ref))
      this.store.research.receipt({
        id: randomUUID(),
        projectId: id,
        taskId: null,
        tool: "moos_get_experiment",
        args: { ref: s.ref },
        origin: "moos",
        outcome: "denied",
        at: new Date().toISOString(),
        sha256: null,
        detail: "Team access not confirmed / 团队访问未确认",
      });
  }
  private source(id: string) {
    const link = this.owned(id);
    if (!link.remoteProjectId) return undefined;
    if (!link.enabled || !this.identity.origin)
      throw new SourceFailure(
        "denied",
        "Team project disconnected / 团队项目连接已关闭",
      );
    let client = this.clients.get(id);
    if (!client) {
      const path = "/v1/research/projects/" + link.remoteProjectId + "/mcp",
        origin = this.identity.origin;
      const request: typeof fetch = async (input, init) => {
        const u = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (u.origin !== origin || u.pathname !== path || u.search || u.hash)
          throw Error("TEAM_TRANSPORT_ORIGIN_DENIED");
        return this.identity.researchRequest(path, init);
      };
      client = new MaterialsMcpClient({
        url: origin + path,
        projectId: link.remoteProjectId,
        fetch: request,
      });
      this.clients.set(id, client);
    }
    return client;
  }
  private path(id: string, suffix = "") {
    const l = this.owned(id);
    if (!l.enabled || !l.remoteProjectId)
      throw Error("TEAM_CONNECTION_DISABLED");
    return "/v1/research/projects/" + l.remoteProjectId + suffix;
  }
  private async request(path: string, body?: unknown) {
    const r = await this.identity.researchRequest(path, {
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (!r.ok)
      throw Error(
        r.status === 401
          ? "TEAM_LOGIN_REQUIRED"
          : r.status === 403
            ? "TEAM_ACCESS_DENIED"
            : r.status === 409
              ? "TEAM_VERSION_OR_SOURCE_CHANGED"
              : "TEAM_SERVICE_UNAVAILABLE",
      );
    const text = await r.text();
    if (Buffer.byteLength(text) > 4 * 1024 * 1024)
      throw Error("TEAM_RESPONSE_TOO_LARGE");
    return JSON.parse(text);
  }
  async listTeamProjects() {
    return z
      .object({
        items: z
          .array(
            z.strictObject({
              id: z.uuid(),
              name: z.string().max(120),
              role: teamRole,
            }),
          )
          .max(200),
      })
      .parse(await this.request("/v1/research/projects")).items;
  }
  async getTeamResearch(id: string): Promise<TeamWorkspace> {
    const link = this.owned(id);
    if (!link.enabled || !link.remoteProjectId) {
      this.accessKeys.delete(id);
      if (link.remoteProjectId) this.blocked(id);
      return {
        link,
        identityConfigured: !!this.identity.origin,
        remote: null,
        error: null,
      };
    }
    try {
      const remote = teamOverview.parse(await this.request(this.path(id)));
      this.accessKeys.set(
        id,
        createHash("sha256")
          .update(
            JSON.stringify({
              project: remote.project.id,
              revision: remote.project.revision,
              member: remote.member,
              link: link.revision,
            }),
          )
          .digest("hex"),
      );
      for (const s of this.store.research.snapshots(id))
        if (
          s.ref &&
          !remote.project.scopes.some(
            (scope) =>
              scope.sourceId === s.ref!.sourceId &&
              scope.experimentId === s.ref!.experimentId,
          )
        )
          this.store.research.receipt({
            id: randomUUID(),
            projectId: id,
            taskId: null,
            tool: "moos_get_experiment",
            args: { ref: s.ref },
            origin: "moos",
            outcome: "denied",
            at: new Date().toISOString(),
            sha256: null,
            detail: "Outside current team scope / 超出团队数据范围",
          });
      return {
        link,
        identityConfigured: !!this.identity.origin,
        remote,
        error: null,
      };
    } catch (e) {
      this.accessKeys.delete(id);
      this.blocked(id);
      await this.clients.get(id)?.close();
      this.clients.delete(id);
      return {
        link,
        identityConfigured: !!this.identity.origin,
        remote: null,
        error: String(e),
      };
    }
  }
  private async authorize(id: string, cloud: boolean) {
    const link = this.owned(id);
    if (!link.remoteProjectId) return;
    if (cloud)
      throw Error(
        "TEAM_LOCAL_MODEL_REQUIRED: 团队数据未授权发送给外部模型 / Team data requires a local model",
      );
    const state = await this.getTeamResearch(id);
    if (!state.remote)
      throw new SourceFailure(
        "denied",
        "Team access not confirmed / 团队访问未确认",
      );
    const p = this.store.research.project(id);
    for (const s of this.store.research.snapshots(id))
      if (p.selected.includes(s.id) && s.ref)
        try {
          await this.research.router.verify(s, null);
        } catch (e) {
          this.blocked(id);
          throw e;
        }
  }
  async saveTeamLink(id: string, input: TeamLink, expected: number) {
    this.idle(id);
    const v = teamLink.parse(input),
      old = this.owned(id);
    if (old.remoteProjectId && !v.remoteProjectId)
      throw Error(
        "TEAM_KEEP_DISABLED_BINDING: 请关闭连接；含团队资料的工作区保留授权绑定",
      );
    if (v.enabled)
      teamOverview.parse(
        await this.request("/v1/research/projects/" + v.remoteProjectId),
      );
    const result = this.store.saveTeamLink(id, v, expected);
    this.blocked(id);
    await this.clients.get(id)?.close();
    this.clients.delete(id);
    return result;
  }
  async saveTeamManifest(
    id: string,
    input: z.infer<typeof teamManifest>,
    expected: number,
  ) {
    this.idle(id);
    return teamManifest.parse(
      await this.request(this.path(id, "/manifest"), {
        manifest: teamManifest.parse(input),
        expectedRevision: expected,
      }),
    );
  }
  async importTeamManifest(id: string) {
    this.idle(id);
    const state = await this.getTeamResearch(id);
    if (!state.remote) throw Error("TEAM_ACCESS_DENIED");
    if (state.remote.manifestAccessChanged)
      throw Error("TEAM_SHARED_SCOPE_CHANGED");
    const manifest = state.remote.manifest;
    for (const ref of manifest.refs) await this.research.select(id, ref);
    const old = this.store.research.project(id);
    return this.research.save(
      {
        ...old,
        revision: old.revision + 1,
        materialSystem: manifest.materialSystem,
        conditions: manifest.conditions,
        decisions: [
          ...old.decisions,
          {
            at: new Date().toISOString(),
            origin: "user",
            text:
              "Imported shared research conditions revision " +
              manifest.revision,
          },
        ],
      },
      old.revision,
    );
  }
  async changeTeamMember(
    id: string,
    account: string,
    input: z.infer<typeof memberChange>,
  ) {
    this.idle(id);
    z.string()
      .regex(/^[A-Za-z0-9_.:-]{1,128}$/)
      .parse(account);
    return teamMember.parse(
      await this.request(
        this.path(id, "/members/" + account),
        memberChange.parse(input),
      ),
    );
  }
  async proposeResearchCorrection(
    id: string,
    input: z.infer<typeof correctionInput>,
  ) {
    this.idle(id);
    return correctionSchema.parse(
      await this.request(
        this.path(id, "/corrections"),
        correctionInput.parse(input),
      ),
    );
  }
  async reviewResearchCorrection(
    id: string,
    correction: string,
    input: z.infer<typeof correctionReview>,
  ) {
    this.idle(id);
    z.uuid().parse(correction);
    return correctionSchema.parse(
      await this.request(
        this.path(id, "/corrections/" + correction + "/review"),
        correctionReview.parse(input),
      ),
    );
  }
  async exportResearchCorrection(id: string, correction: string) {
    this.idle(id);
    z.uuid().parse(correction);
    const packet = await this.request(
      this.path(id, "/corrections/" + correction + "/export"),
    );
    const parsed = correctionSchema.parse(packet.correction);
    if (
      parsed.id !== correction ||
      parsed.projectId !== this.owned(id).remoteProjectId ||
      packet.canonicalWritePerformed !== false
    )
      throw Error("TEAM_PACKET_MISMATCH");
    const data = JSON.stringify(packet, null, 2) + "\n",
      root = this.store.getProject(id)!.path,
      relative =
        "materials-output/team/correction-" +
        correction +
        "-" +
        randomUUID() +
        ".json";
    let directory = await realpath(root);
    for (const part of ["materials-output", "team"]) {
      directory = join(directory, part);
      await mkdir(directory, { recursive: true });
      if (
        (await lstat(directory)).isSymbolicLink() ||
        (await realpath(directory)) !== directory
      )
        throw Error("TEAM_OUTPUT_SYMLINK");
    }
    await writeFile(join(directory, relative.split("/").at(-1)!), data, {
      flag: "wx",
      mode: 0o600,
    });
    return {
      path: relative,
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: Buffer.byteLength(data),
    };
  }
  async confirmResearchCorrection(
    id: string,
    correction: string,
    input: z.infer<typeof correctionConfirm>,
  ) {
    this.idle(id);
    z.uuid().parse(correction);
    return correctionSchema.parse(
      await this.request(
        this.path(id, "/corrections/" + correction + "/confirm"),
        correctionConfirm.parse(input),
      ),
    );
  }
  async close() {
    await Promise.all([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
  }
}
