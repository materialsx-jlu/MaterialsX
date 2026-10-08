// Read-only real MOOS acceptance through a loopback team gateway with controlled synthetic identity.
// Never changes upstream facts, claims a production login, or invokes a model.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MaterialsMcpClient } from "../../packages/agent/src/mcp-client.js";
import { TeamStore, digest } from "../../packages/agent/src/team/store.js";
import { TeamProjection } from "../../packages/agent/src/team/projection.js";
import { TeamResearchService } from "../../packages/agent/src/team/service.js";
import { TeamServer } from "../../packages/agent/src/team/server.js";
const directory = resolve(
    process.env.MATERIALSX_MOOS_MCP_DIRECTORY ??
      "../MOOS/services/materials-mcp",
  ),
  origin = process.env.MATERIALSX_MOOS_ORIGIN ?? "http://127.0.0.1:8080";
const temp = await mkdtemp(join(tmpdir(), "ua13-moos-live-")),
  store = new TeamStore(join(temp, "team.sqlite"));
const upstream = new MaterialsMcpClient({
  command: process.execPath,
  args: [join(directory, "dist/src/server.js")],
  cwd: directory,
  env: {
    PATH: process.env.PATH ?? "",
    MOOS_API_ORIGIN: origin,
    MOOS_CONNECTION_ID: "moos-local",
    NO_PROXY: "127.0.0.1,localhost,::1",
  },
});
let server: TeamServer | null = null,
  client: MaterialsMcpClient | null = null;
const decode = (raw: any) => {
  const e = JSON.parse(raw.content.find((c: any) => c.type === "text").text);
  assert(!raw.isError, e.error?.code ?? "MOOS failure");
  return e;
};
try {
  const search = decode(
      await upstream.call("moos_search", {
        query: "PVDF",
        reviewScope: "include-unreviewed",
        limit: 5,
      }),
    ),
    ref = search.data.items[0]?.ref;
  assert(ref, "Real MOOS sample unavailable");
  const project = store.create({
      name: "Read-only technical acceptance",
      ownerId: "technical-fixture",
      description:
        "Synthetic identity; genuine MOOS source; no canonical writes",
      scopes: [{ sourceId: ref.sourceId, experimentId: ref.experimentId }],
    }),
    projection = new TeamProjection(store, upstream),
    service = new TeamResearchService(projection, false);
  server = new TeamServer({
    publicOrigin: "http://127.0.0.1:1",
    production: false,
    service,
    identity: {
      verify: async (header) => {
        if (header !== "Bearer synthetic-read-only")
          throw Error("TEAM_UNAUTHORIZED");
        return {
          id: "technical-fixture",
          deviceId: "technical-fixture",
          mfaVerified: false,
        };
      },
    },
  });
  const port = await server.listen();
  server.options.publicOrigin = "http://127.0.0.1:" + port;
  client = new MaterialsMcpClient({
    url:
      server.options.publicOrigin +
      "/v1/research/projects/" +
      project.id +
      "/mcp",
    projectId: project.id,
    fetch: (u, i) =>
      fetch(u, {
        ...i,
        headers: {
          ...Object.fromEntries(new Headers(i?.headers)),
          Authorization: "Bearer synthetic-read-only",
        },
      }),
  });
  const scoped = decode(
    await client.call("moos_search", {
      query: "PVDF",
      reviewScope: "include-unreviewed",
      limit: 5,
    }),
  );
  assert(scoped.data.items.length >= 1);
  assert(
    scoped.data.items.every(
      (i: any) =>
        i.ref.sourceId === ref.sourceId &&
        i.ref.experimentId === ref.experimentId,
    ),
  );
  const args = { ref, section: "observations", limit: 1 },
    direct = decode(await upstream.call("moos_get_experiment", args)),
    remote = decode(await client.call("moos_get_experiment", args));
  const read = async (c: MaterialsMcpClient, e: any) =>
    e.data.resource
      ? JSON.parse(
          String(
            (await c.readResource(e.data.resource)).contents.find(
              (x) => "text" in x,
            )?.text,
          ),
        )
      : e.data;
  const expected = await read(upstream, direct),
    actual = await read(client, remote);
  assert.equal(digest(expected.data), digest(actual.data));
  const refused = await client.call("moos_get_experiment", {
    ...args,
    ref: { ...ref, sourceId: ref.sourceId + 999999 },
  });
  assert.equal(refused.isError, true);
  const result = {
    passed: true,
    liveMoos: true,
    transport: "loopback Streamable HTTP",
    identity: "controlled synthetic; not production qualification",
    canonicalWrites: 0,
    externalModelCalls: 0,
    tools: client.discover().length,
    sourceRefSha256: digest(ref),
    observationsSha256: digest(actual.data),
    reviewStatus: ref.reviewStatus,
    scopedCandidates: scoped.data.items.length,
    crossScopeDenied: true,
    at: new Date().toISOString(),
  };
  await mkdir(resolve("runtime/agent/ua-13"), { recursive: true });
  await writeFile(
    resolve("runtime/agent/ua-13/moos-live.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await client?.close();
  if (server) await server.close();
  else await upstream.close();
  store.close();
  await rm(temp, { recursive: true, force: true });
}
