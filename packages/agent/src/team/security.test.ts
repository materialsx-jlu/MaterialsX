import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createServer, request } from "node:https";
import { M5TeamIdentity } from "./auth.js";
import { TeamServer } from "./server.js";
import { teamFixture } from "./test-fixture.js";
import { MaterialsMcpClient } from "../mcp-client.js";
/** Trust only the fixture CA, never disable certificate validation globally. */
function tlsFetch(ca: Buffer): typeof fetch {
  return async (input, init) =>
    new Promise((resolve, reject) => {
      const u = new URL(String(input));
      const r = request(
        u,
        {
          ca,
          servername: "localhost",
          method: init?.method ?? "GET",
          headers: Object.fromEntries(new Headers(init?.headers)),
          ...(init?.signal ? { signal: init.signal } : {}),
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (p) => chunks.push(p));
          response.once("error", reject);
          response.once("end", () =>
            resolve(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode ?? 500,
                headers: Object.fromEntries(
                  Object.entries(response.headers).filter(
                    (v): v is [string, string] => typeof v[1] === "string",
                  ),
                ),
              }),
            ),
          );
        },
      );
      r.once("error", reject);
      if (init?.body) r.write(String(init.body));
      r.end();
    });
}
test("actual TLS MCP plus original M5 verification rejects development identity, suspended account and revoked device", async () => {
  const temp = mkdtempSync(join(tmpdir(), "ua13-tls-")),
    f = teamFixture();
  let identityServer: ReturnType<typeof createServer> | null = null,
    team: TeamServer | null = null,
    client: MaterialsMcpClient | null = null;
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(temp, "key.pem"),
        "-out",
        join(temp, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
      ],
      { stdio: "ignore" },
    );
    const tls = {
        key: readFileSync(join(temp, "key.pem")),
        cert: readFileSync(join(temp, "cert.pem")),
      },
      transport = tlsFetch(tls.cert),
      accountId = "A".repeat(43),
      deviceId = "D".repeat(43);
    let production = false,
      active = true,
      revoked = false;
    identityServer = createServer(tls, (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/health") {
        res.end(JSON.stringify({ production }));
        return;
      }
      if (
        req.url === "/v1/me" &&
        req.headers.authorization === "Bearer synthetic-access-only" &&
        !revoked
      ) {
        res.end(
          JSON.stringify({
            id: accountId,
            email: "admin@example.invalid",
            displayName: "Fixture",
            role: "admin",
            status: active ? "active" : "suspended",
            version: "1",
            deviceId,
            mfaVerified: true,
          }),
        );
        return;
      }
      res.writeHead(401).end("{}");
    });
    await new Promise<void>((r) => identityServer!.listen(0, "127.0.0.1", r));
    const port = (identityServer.address() as any).port,
      identity = new M5TeamIdentity(
        "https://127.0.0.1:" + port,
        true,
        transport,
      );
    await assert.rejects(
      identity.verify(
        "Bearer synthetic-access-only",
        AbortSignal.timeout(5000),
      ),
      /IDENTITY_MODE/,
    );
    production = true;
    const actor = await identity.verify(
      "Bearer synthetic-access-only",
      AbortSignal.timeout(5000),
    );
    assert.equal(actor.id, accountId);
    assert.throws(() => f.service.overview(f.project.id, actor), /FORBIDDEN/); // Platform admin does not acquire MOOS membership.
    f.store.setMember(f.project.id, accountId, {
      accountId,
      role: "reader",
      active: true,
      revision: 1,
    });
    const service = new (f.service
      .constructor as typeof import("./service.js").TeamResearchService)(
      f.projection,
      true,
    );
    assert.throws(
      () =>
        new TeamServer({
          publicOrigin: "https://127.0.0.1:1",
          production: true,
          identity,
          service,
        }),
      /TLS_REQUIRED/,
    );
    team = new TeamServer({
      publicOrigin: "https://127.0.0.1:1",
      production: true,
      identity,
      service,
      tls,
    });
    const teamPort = await team.listen();
    team.options.publicOrigin = "https://127.0.0.1:" + teamPort;
    const origin = team.options.publicOrigin,
      path = "/v1/research/projects/" + f.project.id + "/mcp";
    client = new MaterialsMcpClient({
      url: origin + path,
      projectId: f.project.id,
      fetch: (u, i) =>
        transport(u, {
          ...i,
          headers: {
            ...Object.fromEntries(new Headers(i?.headers)),
            Authorization: "Bearer synthetic-access-only",
          },
        }),
    });
    await client.connect();
    assert.equal((await client.call("moos_status", {})).isError, undefined);
    active = false;
    await assert.rejects(client.call("moos_status", {}));
    active = true;
    revoked = true;
    await assert.rejects(client.call("moos_status", {}));
    revoked = false;
    const hostile = await transport(origin + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer synthetic-access-only",
        Host: "evil.invalid",
      },
      body: "{}",
    });
    assert.equal(hostile.status, 403);
  } finally {
    await client?.close();
    await team?.close();
    identityServer?.closeAllConnections();
    if (identityServer)
      await new Promise<void>((r) => identityServer!.close(() => r()));
    await f.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
test("asset lease invalidates on ACL revision or revocation during resource read", async () => {
  const f = teamFixture();
  try {
    const assets = await f.projection.call(
      f.project.id,
      "reader",
      "moos_search_assets",
      { ref: f.upstream.ref() },
      AbortSignal.timeout(5000),
    );
    const linked = await f.projection.call(
      f.project.id,
      "reader",
      "moos_read_asset",
      { handle: assets.data.items[0].handle, representation: "preview" },
      AbortSignal.timeout(5000),
    );
    f.upstream.onRead = async () => {
      f.store.setMember(f.project.id, "reader", {
        accountId: "reader",
        role: "reader",
        active: false,
        revision: 2,
      });
    };
    await assert.rejects(
      f.projection.resource(
        f.project.id,
        "reader",
        linked.data.resource,
        AbortSignal.timeout(5000),
      ),
      /FORBIDDEN/,
    );
    f.upstream.onRead = null;
    f.store.setMember(f.project.id, "reader", {
      accountId: "reader",
      role: "reader",
      active: true,
      revision: 3,
    });
    await assert.rejects(
      f.projection.resource(
        f.project.id,
        "reader",
        linked.data.resource,
        AbortSignal.timeout(5000),
      ),
      /GRANT_CHANGED/,
    );
  } finally {
    await f.close();
  }
});

test("team resource rejects an upstream PDF presented under a preview handle", async () => {
  const f = teamFixture();
  try {
    const assets = await f.projection.call(f.project.id, "reader", "moos_search_assets",
      { ref: f.upstream.ref() }, AbortSignal.timeout(5000));
    const linked = await f.projection.call(f.project.id, "reader", "moos_read_asset",
      { handle: assets.data.items[0].handle, representation: "preview" }, AbortSignal.timeout(5000));
    (f.upstream as any).readResource = async (uri: string) => ({
      contents: [{ uri, mimeType: "application/pdf", blob: Buffer.from("%PDF-test").toString("base64") }],
    });
    await assert.rejects(f.projection.resource(f.project.id, "reader", linked.data.resource,
      AbortSignal.timeout(5000)), /TEAM_PREVIEW_ONLY/);
  } finally { await f.close(); }
});

test("removing a source scope invalidates shared metadata, masks old proposals and expires existing leases", async () => {
  const f = teamFixture();
  try {
    const manifest = f.store.manifest(f.project.id);
    await f.service.saveManifest(
      f.project.id,
      f.actor("editor"),
      {
        ...manifest,
        revision: 2,
        materialSystem: "Private source-derived material",
        notes: "Private source-derived notes",
        refs: [f.upstream.ref()],
      },
      1,
      AbortSignal.timeout(5000),
    );
    await f.service.propose(
      f.project.id,
      f.actor("editor"),
      f.proposal(),
      AbortSignal.timeout(5000),
    );
    const grant = f.projection.grant(f.project.id, "reader");
    f.store.updateScopes(
      f.project.id,
      [],
      1,
      "Source sharing permission withdrawn",
    );
    const current = f.service.overview(f.project.id, f.actor("reader"));
    assert.equal(current.manifestAccessChanged, true);
    assert.equal(current.manifest.notes, "");
    assert.equal(current.proposals.length, 0);
    assert.equal(current.manifest.refs.length, 0);
    assert.throws(
      () => f.projection.check(f.project.id, "reader", grant),
      /GRANT_CHANGED/,
    );
    assert(
      f.store
        .events(f.project.id)
        .some((e) => e.action === "project.scope-changed"),
    );
  } finally {
    await f.close();
  }
});
