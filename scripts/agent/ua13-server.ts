import { z } from "zod";
import { readFile, mkdir, chmod } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { TeamStore } from "../../packages/agent/src/team/store.js";
import { TeamProjection } from "../../packages/agent/src/team/projection.js";
import { TeamResearchService } from "../../packages/agent/src/team/service.js";
import { M5TeamIdentity } from "../../packages/agent/src/team/auth.js";
import { TeamServer } from "../../packages/agent/src/team/server.js";
import { MaterialsMcpClient } from "../../packages/agent/src/mcp-client.js";
import { teamProject } from "../../packages/contracts/src/team-research.js";
const path = resolve(
  process.env.MATERIALSX_TEAM_DATA ?? "runtime/team/team.sqlite",
);
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
const store = new TeamStore(path);
await chmod(path, 0o600);
if (process.argv[2] === "init") {
  const input = JSON.parse(await readFile(process.argv[3] ?? "", "utf8"));
  const q = teamProject
    .omit({ id: true, revision: true, updatedAt: true })
    .parse(input);
  const p = store.create(q);
  console.log(
    JSON.stringify({
      projectId: p.id,
      ownerId: p.ownerId,
      scopeCount: p.scopes.length,
    }),
  );
  store.close();
} else if (process.argv[2] === "scopes") {
  const q = z
    .strictObject({
      projectId: z.uuid(),
      expectedRevision: z.number().int().positive(),
      scopes: teamProject.shape.scopes,
      reason: z.string().min(5).max(500),
    })
    .parse(JSON.parse(await readFile(process.argv[3] ?? "", "utf8")));
  const p = store.updateScopes(
    q.projectId,
    q.scopes,
    q.expectedRevision,
    q.reason,
  );
  console.log(
    JSON.stringify({
      projectId: p.id,
      revision: p.revision,
      scopeCount: p.scopes.length,
    }),
  );
  store.close();
} else {
  const production = process.env.MATERIALSX_TEAM_DEVELOPMENT !== "1",
    origin = process.env.MATERIALSX_TEAM_PUBLIC_ORIGIN,
    identity = process.env.MATERIALSX_IDENTITY_URL,
    directory = process.env.MATERIALSX_MOOS_MCP_DIRECTORY;
  if (!origin || !identity || !directory)
    throw Error("TEAM_CONFIGURATION_REQUIRED");
  if (new URL(origin).origin !== new URL(identity).origin)
    throw Error("TEAM_SAME_M5_ORIGIN_REQUIRED");
  const upstream = new MaterialsMcpClient({
    command: process.execPath,
    args: [resolve(directory, "dist/src/server.js")],
    cwd: resolve(directory),
    env: {
      PATH: process.env.PATH ?? "",
      MOOS_API_ORIGIN:
        process.env.MATERIALSX_MOOS_ORIGIN ?? "http://127.0.0.1:8080",
      MOOS_CONNECTION_ID: "moos-local",
      NO_PROXY: "127.0.0.1,localhost,::1",
    },
  });
  const tls =
    process.env.MATERIALSX_TEAM_TLS_KEY && process.env.MATERIALSX_TEAM_TLS_CERT
      ? {
          key: await readFile(process.env.MATERIALSX_TEAM_TLS_KEY),
          cert: await readFile(process.env.MATERIALSX_TEAM_TLS_CERT),
        }
      : undefined;
  const service = new TeamResearchService(
      new TeamProjection(store, upstream),
      production,
    ),
    server = new TeamServer({
      publicOrigin: origin,
      production,
      identity: new M5TeamIdentity(identity, production),
      service,
      ...(tls ? { tls } : {}),
      trustedLoopbackProxy:
        process.env.MATERIALSX_TEAM_TRUSTED_LOOPBACK_PROXY === "1",
    });
  const port = await server.listen(
    Number(process.env.MATERIALSX_TEAM_PORT ?? 8793),
  );
  console.log(
    JSON.stringify({
      service: "materialsx-team-moos",
      listen: "127.0.0.1:" + port,
      production,
    }),
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    store.close();
  };
  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
}
