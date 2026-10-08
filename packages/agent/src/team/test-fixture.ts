import { randomUUID, createHash } from "node:crypto";
import type { MoosRef } from "../../../contracts/src/research-project.js";
import { TeamStore } from "./store.js";
import { TeamProjection } from "./projection.js";
import { TeamResearchService } from "./service.js";
import { TeamServer } from "./server.js";
/** Controlled transport fixture. It never reads production data or grants real identity. */
export const testRef: MoosRef = {
  connectionId: "moos-local",
  sourceId: 1,
  packageImportId: 1,
  experimentId: 1,
  generation: 1,
  packageSha256: "a".repeat(64),
  projectionSha256: "b".repeat(64),
  reviewScope: "verified",
  reviewStatus: "verified",
};
export class TeamTestUpstream {
  value = 12;
  generation = 1;
  large = false;
  onRead: (() => Promise<void>) | null = null;
  calls: Array<{
    name: string;
    args: any;
  }> = [];
  ref() {
    return {
      ...testRef,
      generation: this.generation,
      packageSha256: this.generation === 1 ? "a".repeat(64) : "c".repeat(64),
      projectionSha256: this.generation === 1 ? "b".repeat(64) : "d".repeat(64),
    };
  }
  async connect() {}
  async close() {}
  discover() {
    return [
      "status",
      "search",
      "get_experiment",
      "get_evidence",
      "compare_observations",
      "search_assets",
      "read_asset",
      "get_simulation",
    ].map((name) => ({
      name: "moos_" + name,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
      readOnly: true,
    }));
  }
  data() {
    return {
      observations: [{ id: "o-1", value: this.value, unit: "MPa" }],
      evidence: [{ id: "e-1", page: 1 }],
      recipes: [],
      ingredients: [],
      processes: [],
      nodes: [],
    };
  }
  envelope(data: any) {
    return {
      adapterVersion: "moos-mcp-v1",
      projectionVersion: "rpsme-experiment-sections-v1.1",
      authorizationScope: "local-research",
      cloudExportAuthorized: false,
      externalModelCalls: 0,
      retrievedAt: new Date().toISOString(),
      receipts: [{ privatePath: "/private/global/database" }],
      privateGlobal: "DO_NOT_LEAK",
      data,
    };
  }
  async call(name: string, args: any, _options?: unknown) {
    this.calls.push({ name, args });
    if (this.onRead) await this.onRead();
    let data: any;
    if (args.ref && JSON.stringify(args.ref) !== JSON.stringify(this.ref()))
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: { code: "stale_version" } }),
          },
        ],
      };
    if (name === "moos_search")
      data = {
        items: [
          { ref: this.ref(), label: "Allowed PVDF" },
          {
            ref: { ...this.ref(), sourceId: 2 },
            label: "Private recipe secret",
          },
        ],
        nextCursor: args.cursor ? null : "private-cursor",
        totalMatches: 192,
      };
    else if (name === "moos_get_experiment")
      data = this.large
        ? { ref: this.ref(), resource: "moos://record" }
        : {
            ref: this.ref(),
            data: this.data(),
            nextCursor: null,
            identity: { label: "PVDF fixture" },
          };
    else if (name === "moos_get_evidence")
      data = {
        evidence: { id: "e-1", page: 1 },
        evidenceSha256: "e".repeat(64),
      };
    else if (name === "moos_search_assets")
      data = {
        items: [
          { ref: this.ref(), handle: "moos://private-image", mediaId: "img-1" },
        ],
        nextCursor: null,
      };
    else if (name === "moos_read_asset")
      data = {
        resource: "moos://image",
        rightsBasis: "licensed preview",
        cloudExportAuthorized: false,
      };
    else data = { status: "ready" };
    return {
      content: [{ type: "text", text: JSON.stringify(this.envelope(data)) }],
    };
  }
  async readResource(uri: string, _options?: unknown) {
    if (this.onRead) await this.onRead();
    if (uri === "moos://record")
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              ref: this.ref(),
              data: this.data(),
              nextCursor: null,
            }),
          },
        ],
      };
    const bytes = Buffer.from("fixture-jpeg"),
      contentSha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      contents: [
        { uri, mimeType: "image/jpeg", blob: bytes.toString("base64") },
        {
          uri: uri + "#provenance",
          mimeType: "application/json",
          text: JSON.stringify(
            this.envelope({
              rightsBasis: "licensed preview",
              contentSha256,
              cloudExportAuthorized: false,
            }),
          ),
        },
      ],
    };
  }
}
export function teamFixture(database = ":memory:") {
  const store = new TeamStore(database),
    upstream = new TeamTestUpstream(),
    projection = new TeamProjection(store, upstream as any),
    service = new TeamResearchService(projection, false);
  const project = store.create({
    name: "Shared PVDF research",
    ownerId: "editor",
    description: "Controlled fixture, not scientific validation",
    scopes: [{ sourceId: 1, experimentId: 1 }],
  });
  for (const [id, role] of [
    ["reader", "reader"],
    ["reviewer", "reviewer"],
  ] as const)
    store.setMember(project.id, id, {
      accountId: id,
      role,
      active: true,
      revision: 1,
    });
  const revoked = new Set<string>(),
    identity = {
      verify: async (header: string) => {
        const id = header.slice(7);
        if (
          !["editor", "reader", "reviewer", "platform-admin"].includes(id) ||
          revoked.has(id)
        )
          throw Error("TEAM_UNAUTHORIZED");
        return { id, deviceId: "test-device", mfaVerified: false };
      },
    };
  const server = new TeamServer({
    publicOrigin: "http://127.0.0.1:1",
    production: false,
    identity,
    service,
  });
  const start = async () => {
    const port = await server.listen();
    server.options.publicOrigin = "http://127.0.0.1:" + port;
    return server.options.publicOrigin;
  };
  const actor = (id: string) => ({
    id,
    deviceId: "test-device",
    mfaVerified: false,
  });
  const proposal = () => ({
    requestId: randomUUID(),
    ref: upstream.ref(),
    pointer: "/observations/0/value",
    before: 12,
    after: 15,
    reason: "Checked against the original paper page",
    evidenceId: "e-1",
    humanConfirmed: true as const,
  });
  return {
    store,
    upstream,
    projection,
    service,
    project,
    server,
    revoked,
    start,
    actor,
    proposal,
    close: async () => {
      await server.close();
      store.close();
    },
  };
}
