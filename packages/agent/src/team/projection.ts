import { randomUUID } from "node:crypto";
import type { MaterialsMcpClient } from "../mcp-client.js";
import {
  moosRefSchema,
  type MoosRef,
} from "../../../contracts/src/research-project.js";
import { TeamStore, digest } from "./store.js";
const NAMES = new Set([
  "moos_status",
  "moos_search",
  "moos_get_experiment",
  "moos_get_evidence",
  "moos_compare_observations",
  "moos_search_assets",
  "moos_read_asset",
  "moos_get_simulation",
]);
type Lease = {
  projectId: string;
  actorId: string;
  grant: string;
  expires: number;
  kind: "resource" | "asset" | "cursor";
  upstream: string;
  refs: MoosRef[];
  queryHash: string | null;
};
/** Filter at the service boundary; handles are account/project/grant-bound, never upstream locators accepted from clients. */
export class TeamProjection {
  private leases = new Map<string, Lease>();
  constructor(
    readonly store: TeamStore,
    readonly upstream: Pick<
      MaterialsMcpClient,
      "call" | "readResource" | "connect" | "discover" | "close"
    >,
  ) {}
  grant(projectId: string, actorId: string) {
    return digest({
      project: this.store.project(projectId),
      member: this.store.require(projectId, actorId),
    });
  }
  assertRef(project: string, input: unknown): MoosRef {
    const ref = moosRefSchema.parse(input);
    if (
      !this.store
        .project(project)
        .scopes.some(
          (s) =>
            s.sourceId === ref.sourceId && s.experimentId === ref.experimentId,
        )
    )
      throw Error("TEAM_FORBIDDEN");
    return ref;
  }
  check(project: string, actor: string, grant: string) {
    if (this.grant(project, actor) !== grant) throw Error("TEAM_GRANT_CHANGED");
  }
  issue(
    project: string,
    actor: string,
    kind: Lease["kind"],
    upstream: string,
    refs: MoosRef[],
    queryHash: string | null = null,
  ) {
    for (const [id, l] of this.leases)
      if (l.expires <= Date.now()) this.leases.delete(id);
    if (this.leases.size >= 512) throw Error("TEAM_HANDLE_LIMIT");
    const id = randomUUID();
    this.leases.set(id, {
      projectId: project,
      actorId: actor,
      grant: this.grant(project, actor),
      expires: Date.now() + 600000,
      kind,
      upstream,
      refs,
      queryHash,
    });
    return "moos-team://" + project + "/" + id;
  }
  lease(project: string, actor: string, value: unknown, kind: Lease["kind"]) {
    if (typeof value !== "string") throw Error("TEAM_HANDLE_DENIED");
    const u = new URL(value);
    const l =
      u.protocol === "moos-team:" &&
      u.hostname === project &&
      !u.search &&
      !u.hash
        ? this.leases.get(u.pathname.slice(1))
        : null;
    if (
      !l ||
      l.projectId !== project ||
      l.actorId !== actor ||
      l.kind !== kind ||
      l.expires <= Date.now()
    )
      throw Error("TEAM_HANDLE_DENIED");
    this.check(project, actor, l.grant);
    for (const ref of l.refs) this.assertRef(project, ref);
    return l;
  }
  async raw(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const result = await this.upstream.call(name, args, { signal });
    const t = (
      result.content as Array<{
        type: string;
        text?: string;
      }>
    ).find((c) => c.type === "text");
    const e = JSON.parse(t?.text ?? "null");
    if (result.isError)
      throw Error(
        ["unauthorized", "forbidden", "metadata_only"].includes(e?.error?.code)
          ? "TEAM_FORBIDDEN"
          : ["stale_version", "integrity_error"].includes(e?.error?.code)
            ? "TEAM_SOURCE_STALE"
            : "TEAM_UPSTREAM_UNAVAILABLE",
      );
    if (
      e?.adapterVersion !== "moos-mcp-v1" ||
      e?.projectionVersion !== "rpsme-experiment-sections-v1.1" ||
      e?.authorizationScope !== "local-research" ||
      e.cloudExportAuthorized !== false ||
      e.externalModelCalls !== 0
    )
      throw Error("TEAM_UPSTREAM_CONTRACT");
    return e;
  }
  async call(
    project: string,
    actor: string,
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    if (!NAMES.has(name)) throw Error("TEAM_TOOL_DENIED");
    const grant = this.grant(project, actor),
      args = structuredClone(input),
      refs: MoosRef[] = [];
    if (args.ref) refs.push(this.assertRef(project, args.ref));
    if (args.selections) {
      if (!Array.isArray(args.selections)) throw Error("TEAM_INVALID");
      for (const s of args.selections)
        refs.push(this.assertRef(project, s.ref));
    }
    if (
      [
        "moos_get_experiment",
        "moos_get_evidence",
        "moos_get_simulation",
      ].includes(name) &&
      !refs.length
    )
      throw Error("TEAM_FORBIDDEN");
    if (name === "moos_search_assets" && !refs.length)
      throw Error("TEAM_SCOPED_ASSETS_REQUIRED");
    const queryHash = digest({ name, args: { ...args, cursor: undefined } });
    if (args.cursor) {
      const lease = this.lease(project, actor, args.cursor, "cursor");
      if (lease.queryHash !== queryHash) throw Error("TEAM_CURSOR_CHANGED");
      args.cursor = lease.upstream;
    }
    if (name === "moos_read_asset") {
      const l = this.lease(project, actor, args.handle, "asset");
      if (args.representation !== "preview")
        throw Error("TEAM_ORIGINAL_ASSET_EXPORT_DENIED");
      args.handle = l.upstream;
      refs.push(...l.refs);
    }
    const e = await this.raw(name, args, signal);
    this.check(project, actor, grant);
    let data = e.data;
    if (name === "moos_status")
      data = {
        status: "connected",
        adapterVersion: e.adapterVersion,
        projectionVersion: e.projectionVersion,
        projectId: project,
        scopeCount: this.store.project(project).scopes.length,
        cloudExportAuthorized: false,
      };
    if (name === "moos_search") {
      if (!Array.isArray(data?.items)) throw Error("TEAM_UPSTREAM_CONTRACT");
      data = {
        items: data.items.filter((i: any) => {
          try {
            this.assertRef(project, i.ref);
            return true;
          } catch {
            return false;
          }
        }),
        nextCursor: data.nextCursor
          ? this.issue(project, actor, "cursor", data.nextCursor, [], queryHash)
          : null,
        totalCandidates: null,
        totalMatches: null,
        truncated: !!data.nextCursor,
        outcome: "no_match",
        reviewScope: args.reviewScope ?? "verified",
      };
      data.outcome = data.items.length
        ? "matched"
        : data.nextCursor
          ? "filtered_page"
          : "no_match";
    } else if (data?.nextCursor)
      data = {
        ...data,
        nextCursor: this.issue(
          project,
          actor,
          "cursor",
          data.nextCursor,
          refs,
          queryHash,
        ),
      };
    if (name === "moos_search_assets") {
      if (!Array.isArray(data?.items)) throw Error("TEAM_UPSTREAM_CONTRACT");
      data = {
        ...data,
        totalCandidates: null,
        totalMatches: null,
        items: data.items.map((i: any) => {
          const ref = this.assertRef(project, i.ref);
          if (refs.length && digest(ref) !== digest(refs[0]))
            throw Error("TEAM_UPSTREAM_CONTRACT");
          return {
            ...i,
            handle: this.issue(project, actor, "asset", i.handle, [ref]),
          };
        }),
      };
    }
    if (data?.resource)
      data = {
        ...data,
        resource: this.issue(project, actor, "resource", data.resource, refs),
      };
    const response = {
      adapterVersion: e.adapterVersion,
      projectionVersion: e.projectionVersion,
      retrievedAt: e.retrievedAt,
      externalModelCalls: 0,
      data,
      authorizationScope: "project-research",
      authorization: {
        projectId: project,
        subjectId: actor,
        grantRevision: grant,
      },
      receipts: [
        {
          kind: "project-gateway",
          tool: name,
          sha256: digest(data),
          scoped: true,
        },
      ],
      cloudExportAuthorized: false,
    };
    this.store.audit(project, actor, "moos." + name, project, {
      argsHash: digest(input),
      responseHash: digest(response),
    });
    return response;
  }
  async resource(
    project: string,
    actor: string,
    uri: string,
    signal: AbortSignal,
  ) {
    const l = this.lease(project, actor, uri, "resource"),
      r = await this.upstream.readResource(l.upstream, { signal });
    this.check(project, actor, l.grant);
    if (Buffer.byteLength(JSON.stringify(r)) > 12 * 1024 * 1024)
      throw Error("TEAM_RESOURCE_SIZE_LIMIT");
    for (const content of r.contents) {
      if (!("blob" in content)) continue;
      if (
        !l.refs.length ||
        content.mimeType !== "image/jpeg" ||
        typeof content.blob !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content.blob) ||
        content.blob.length > Math.ceil((2 * 1024 * 1024) / 3) * 4
      )
        throw Error("TEAM_PREVIEW_ONLY");
    }
    this.store.audit(project, actor, "moos.resource", project, {
      sha256: digest(r),
    });
    return {
      ...r,
      contents: r.contents.map((c: any) => {
        let text = c.text;
        if (typeof text === "string") {
          try {
            const e = JSON.parse(text);
            if (e?.adapterVersion) {
              text = JSON.stringify({
                adapterVersion: e.adapterVersion,
                projectionVersion: e.projectionVersion,
                retrievedAt: e.retrievedAt,
                externalModelCalls: 0,
                cloudExportAuthorized: false,
                data: e.data,
                authorizationScope: "project-research",
                authorization: {
                  projectId: project,
                  subjectId: actor,
                  grantRevision: l.grant,
                },
                receipts: [
                  {
                    kind: "project-gateway",
                    sha256: digest(e.data),
                    scoped: true,
                  },
                ],
              });
            }
          } catch {
            /* Non-JSON text remains data. */
          }
        }
        return {
          ...c,
          uri: uri + (c.uri.endsWith("#provenance") ? "#provenance" : ""),
          ...(typeof text === "string" ? { text } : {}),
        };
      }),
    };
  }
  async record(ref: MoosRef, signal: AbortSignal) {
    let cursor: string | null = null,
      data: Record<string, any[]> = {};
    for (let i = 0; i < 10; i++) {
      const e = await this.raw(
        "moos_get_experiment",
        { ref, section: "all", limit: 50, ...(cursor ? { cursor } : {}) },
        signal,
      );
      if (e.data.resource) {
        const r = await this.upstream.readResource(e.data.resource, { signal });
        e.data = JSON.parse(
          String(
            r.contents.find(
              (
                c,
              ): c is Extract<
                typeof c,
                {
                  text: string;
                }
              > => "text" in c,
            )?.text,
          ),
        );
      }
      if ((e.data.ref && digest(e.data.ref) !== digest(ref)) || !e.data.data)
        throw Error("TEAM_UPSTREAM_CONTRACT");
      for (const [k, v] of Object.entries(e.data.data)) {
        if (!Array.isArray(v)) throw Error("TEAM_UPSTREAM_CONTRACT");
        (data[k] ??= []).push(...v);
      }
      if (Buffer.byteLength(JSON.stringify(data)) > 4 * 1024 * 1024)
        throw Error("TEAM_SOURCE_TOO_LARGE");
      cursor = e.data.nextCursor;
      if (!cursor) return data;
    }
    throw Error("TEAM_SOURCE_TOO_LARGE");
  }
}
export function atPointer(data: Record<string, unknown>, pointer: string) {
  return pointer
    .slice(1)
    .split("/")
    .reduce((v: any, k) => {
      if (
        v === null ||
        typeof v !== "object" ||
        !Object.prototype.hasOwnProperty.call(v, k)
      )
        throw Error("TEAM_CORRECTION_FIELD_MISSING");
      return v[k];
    }, data);
}
