import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from "node:http";
import { createServer as createTLS } from "node:https";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { TeamIdentity, TeamActor } from "./auth.js";
import { TeamResearchService } from "./service.js";
import { MCP_PROTOCOL } from "../mcp-client.js";
export type TeamServerOptions = {
  publicOrigin: string;
  production: boolean;
  identity: TeamIdentity;
  service: TeamResearchService;
  tls?: {
    key: Buffer;
    cert: Buffer;
  };
  trustedLoopbackProxy?: boolean;
};
const status = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  return /UNAUTHORIZED|IDENTITY_MODE/.test(m)
    ? 401
    : /FORBIDDEN|DENIED|REQUIRED/.test(m)
      ? 403
      : /NOT_FOUND/.test(m)
        ? 404
        : /CONFLICT|STALE|CHANGED|MISMATCH/.test(m)
          ? 409
          : /UNAVAILABLE|CONTRACT/.test(m)
            ? 503
            : 400;
};
/** Stateless Streamable HTTP. Authentication and current ACL checks apply to every request and every final result. */
export class TeamServer {
  readonly http: HttpServer;
  private handlers = new Set<Promise<void>>();
  private requests = new Set<AbortController>();
  private limits = new Map<
    string,
    {
      at: number;
      count: number;
    }
  >();
  private inFlight = 0;
  constructor(readonly options: TeamServerOptions) {
    const u = new URL(options.publicOrigin);
    if (
      u.href !== u.origin + "/" ||
      u.username ||
      u.password ||
      (u.protocol !== "https:" &&
        !(
          options.production === false &&
          u.protocol === "http:" &&
          u.hostname === "127.0.0.1"
        ))
    )
      throw Error("TEAM_PUBLIC_ORIGIN_INVALID");
    if (options.production && !options.tls && !options.trustedLoopbackProxy)
      throw Error("TEAM_TLS_REQUIRED");
    if (options.service.production !== options.production)
      throw Error("TEAM_PRODUCTION_MODE_CONFLICT");
    const listener = (r: IncomingMessage, w: ServerResponse) => {
      const task = this.handle(r, w).catch(() => {
        w.destroy();
      });
      this.handlers.add(task);
      void task.finally(() => this.handlers.delete(task));
    };
    this.http = options.tls
      ? createTLS(options.tls, listener)
      : createServer(listener);
    this.http.requestTimeout = 35000;
    this.http.headersTimeout = 10000;
    this.http.maxHeadersCount = 40;
  }
  private json(w: ServerResponse, code: number, value: unknown) {
    if (w.writableEnded || w.destroyed) return;
    w.writeHead(code, { "Content-Type": "application/json" });
    w.end(JSON.stringify(value));
  }
  private async body(r: IncomingMessage) {
    if (!r.headers["content-type"]?.startsWith("application/json"))
      throw Error("TEAM_JSON_REQUIRED");
    const parts: Buffer[] = [];
    let size = 0;
    for await (const p of r) {
      size += p.length;
      if (size > 128 * 1024) throw Error("TEAM_BODY_LIMIT");
      parts.push(Buffer.from(p));
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  }
  private rate(ip: string, maximum: number) {
    const now = Date.now();
    for (const [k, v] of this.limits)
      if (v.at < now - 60000) this.limits.delete(k);
    const v = this.limits.get(ip) ?? { at: now, count: 0 };
    if (this.limits.size >= 1024 || ++v.count > maximum)
      throw Error("TEAM_RATE_LIMIT");
    this.limits.set(ip, v);
  }
  private async handle(r: IncomingMessage, w: ServerResponse) {
    w.setHeader("Cache-Control", "no-store");
    w.setHeader("X-Content-Type-Options", "nosniff");
    w.setHeader("Referrer-Policy", "no-referrer");
    if (this.options.production)
      w.setHeader("Strict-Transport-Security", "max-age=31536000");
    const controller = new AbortController(),
      signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
    this.requests.add(controller);
    w.on("close", () => {
      if (!w.writableEnded) controller.abort();
    });
    let entered = false;
    let auditedActor: string | null = null,
      auditedProject: string | null = null;
    try {
      const u = new URL(this.options.publicOrigin);
      if (
        r.headers.host !== u.host ||
        (r.headers.origin !== undefined && r.headers.origin !== u.origin) ||
        r.headers["x-user-id"] ||
        r.headers["x-reviewer-id"] ||
        r.headers["x-research-role"]
      )
        throw Error("TEAM_HEADER_DENIED");
      if (
        this.options.production &&
        !this.options.tls &&
        (!this.options.trustedLoopbackProxy ||
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            r.socket.remoteAddress ?? "",
          ))
      )
        throw Error("TEAM_TLS_REQUIRED");
      this.rate("ip:" + r.socket.remoteAddress, 2400);
      if (r.url === "/v1/research/health" && r.method === "GET") {
        this.json(w, 200, {
          service: "materialsx-team-moos",
          production: this.options.production,
        });
        return;
      }
      if (this.inFlight >= 16) throw Error("TEAM_IN_FLIGHT_LIMIT");
      this.inFlight++;
      entered = true;
      const auth = r.headers.authorization ?? "",
        actor = await this.options.identity.verify(auth, signal),
        path = r.url ?? "";
      auditedActor = actor.id;
      this.rate("account:" + actor.id + ":" + actor.deviceId, 1200);
      if (path === "/v1/research/projects" && r.method === "GET") {
        this.json(w, 200, {
          items: this.options.service.store.projects(actor.id).map((p) => ({
            id: p.id,
            name: p.name,
            role: this.options.service.store.require(p.id, actor.id).role,
          })),
        });
        return;
      }
      const m =
        /^\/v1\/research\/projects\/([a-f0-9-]{36})(?:\/(mcp|manifest|members\/([A-Za-z0-9_.:-]{1,128})|corrections(?:\/([a-f0-9-]{36})(?:\/(review|export|confirm))?)?))?$/.exec(
          path,
        );
      if (!m) throw Error("TEAM_NOT_FOUND");
      const project = z.uuid().parse(m[1]),
        service = this.options.service;
      service.store.project(project);
      auditedProject = project;
      service.store.require(project, actor.id);
      const grant = service.projection.grant(project, actor.id);
      const recheck = async () => {
        const current = await this.options.identity.verify(auth, signal);
        if (current.id !== actor.id || current.deviceId !== actor.deviceId)
          throw Error("TEAM_UNAUTHORIZED");
        service.projection.check(project, actor.id, grant);
        signal.throwIfAborted();
      };
      if (m[2] === "mcp") {
        if (!["GET", "POST", "DELETE"].includes(r.method ?? ""))
          throw Error("TEAM_METHOD_DENIED");
        if (r.method !== "POST") {
          this.json(w, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
          return;
        }
        await this.mcp(
          r,
          w,
          project,
          actor,
          signal,
          await this.body(r),
          recheck,
        );
        return;
      }
      let result: unknown;
      if (!m[2] && r.method === "GET")
        result = service.overview(project, actor);
      else if (m[2] === "manifest" && r.method === "POST") {
        const q = z
          .strictObject({
            manifest: z.unknown(),
            expectedRevision: z.number().int().positive(),
          })
          .parse(await this.body(r));
        result = await service.saveManifest(
          project,
          actor,
          q.manifest,
          q.expectedRevision,
          signal,
          recheck,
        );
      } else if (m[3] && r.method === "POST") {
        const q = await this.body(r);
        await recheck();
        result = service.changeMember(project, actor, m[3], q);
      } else if (m[2] === "corrections" && r.method === "POST")
        result = await service.propose(
          project,
          actor,
          await this.body(r),
          signal,
          recheck,
        );
      else if (m[4] && m[5] === "review" && r.method === "POST")
        result = await service.review(
          project,
          actor,
          m[4],
          await this.body(r),
          signal,
          recheck,
        );
      else if (m[4] && m[5] === "export" && r.method === "GET") {
        await recheck();
        result = service.packet(project, actor, m[4]);
      } else if (m[4] && m[5] === "confirm" && r.method === "POST")
        result = await service.confirm(
          project,
          actor,
          m[4],
          await this.body(r),
          signal,
          recheck,
        );
      else throw Error("TEAM_NOT_FOUND");
      // A role change invalidates its actor's old grant only when that same actor is changed (owner changes others).
      await recheck();
      this.json(w, 200, result);
    } catch (e) {
      if (auditedActor && auditedProject)
        this.options.service.store.audit(
          auditedProject,
          auditedActor,
          "request.denied",
          auditedProject,
          {
            code:
              e instanceof Error && /^TEAM_[A-Z_]+$/.test(e.message)
                ? e.message
                : "TEAM_INVALID_REQUEST",
          },
        );
      this.json(
        w,
        e instanceof Error && e.message === "TEAM_RATE_LIMIT" ? 429 : status(e),
        {
          error: {
            code:
              e instanceof Error && /^TEAM_[A-Z_]+$/.test(e.message)
                ? e.message
                : "TEAM_INVALID_REQUEST",
            retryable: false,
          },
        },
      );
    } finally {
      this.requests.delete(controller);
      if (entered) this.inFlight--;
    }
  }
  private async mcp(
    r: IncomingMessage,
    w: ServerResponse,
    project: string,
    actor: TeamActor,
    signal: AbortSignal,
    body: any,
    recheck: () => Promise<void>,
  ) {
    if (
      body?.method !== "initialize" &&
      r.headers["mcp-protocol-version"] !== MCP_PROTOCOL
    )
      throw Error("TEAM_PROTOCOL_REQUIRED");
    const projection = this.options.service.projection;
    await projection.upstream.connect();
    const tools = projection.upstream
      .discover()
      .filter(
        (t) =>
          t.readOnly &&
          /^moos_(?:status|search|get_experiment|get_evidence|compare_observations|search_assets|read_asset|get_simulation)$/.test(
            t.name,
          ),
      );
    const server = new Server(
      { name: "materialsx-project-moos", version: "0.1.0" },
      { capabilities: { tools: {}, resources: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      await recheck();
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.inputSchema as any,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
          },
        })),
      };
    });
    server.setRequestHandler(CallToolRequestSchema, async (q, extra) => {
      try {
        if (!tools.some((t) => t.name === q.params.name))
          throw Error("TEAM_TOOL_DENIED");
        const e = await projection.call(
          project,
          actor.id,
          q.params.name,
          q.params.arguments ?? {},
          AbortSignal.any([signal, extra.signal]),
        );
        await recheck();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(e) }],
        };
      } catch (e) {
        this.options.service.store.audit(
          project,
          actor.id,
          "moos.denied",
          q.params.name,
          {
            code: status(e),
          },
        );
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: {
                  code:
                    status(e) === 403 || status(e) === 401
                      ? "forbidden"
                      : status(e) === 409
                        ? "stale_version"
                        : "unavailable",
                },
              }),
            },
          ],
        };
      }
    });
    server.setRequestHandler(ReadResourceRequestSchema, async (q, extra) => {
      try {
        const v = await projection.resource(
          project,
          actor.id,
          q.params.uri,
          AbortSignal.any([signal, extra.signal]),
        );
        await recheck();
        return v as any;
      } catch (e) {
        this.options.service.store.audit(
          project,
          actor.id,
          "moos.resource-denied",
          project,
          {
            code: status(e),
          },
        );
        throw new McpError(
          ErrorCode.InvalidParams,
          status(e) === 403 || status(e) === 401
            ? "TEAM_FORBIDDEN"
            : "TEAM_RESOURCE_UNAVAILABLE",
        );
      }
    });
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    w.once("close", () => {
      void server.close();
    });
    await server.connect(
      transport as import("@modelcontextprotocol/sdk/shared/transport.js").Transport,
    );
    await transport.handleRequest(r, w, body);
  }
  listen(port = 0) {
    return new Promise<number>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(port, "127.0.0.1", () => {
        const a = this.http.address();
        if (!a || typeof a === "string") reject(Error("TEAM_LISTEN_FAILED"));
        else resolve(a.port);
      });
    });
  }
  async close() {
    for (const c of this.requests) c.abort();
    this.http.closeAllConnections();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
    await Promise.allSettled([...this.handlers]);
    await this.options.service.projection.upstream.close();
  }
}
