import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MaterialsMcpClient } from "../mcp-client.js";
import { teamFixture } from "./test-fixture.js";
import { TeamStore } from "./store.js";
const signal = () => AbortSignal.timeout(10000);
test("project scopes, role isolation and independently reviewed corrections with genuine generation receipts", async () => {
  const f = teamFixture();
  try {
    assert.throws(
      () => f.service.overview(f.project.id, f.actor("platform-admin")),
      /FORBIDDEN/,
    );
    await assert.rejects(
      f.service.propose(
        f.project.id,
        f.actor("reader"),
        f.proposal(),
        signal(),
      ),
      /FORBIDDEN/,
    );
    const input = f.proposal(),
      c = await f.service.propose(
        f.project.id,
        f.actor("editor"),
        input,
        signal(),
      );
    assert.equal(
      (
        await f.service.propose(
          f.project.id,
          f.actor("editor"),
          input,
          signal(),
        )
      ).id,
      c.id,
    );
    await assert.rejects(
      f.service.propose(
        f.project.id,
        f.actor("editor"),
        { ...input, after: 18 },
        signal(),
      ),
      /IDEMPOTENCY/,
    );
    await assert.rejects(
      f.service.propose(
        f.project.id,
        f.actor("editor"),
        { ...f.proposal(), before: 0 },
        signal(),
      ),
      /EVIDENCE_MISMATCH/,
    );
    f.store.setMember(f.project.id, "editor", {
      accountId: "editor",
      role: "reviewer",
      active: true,
      revision: 2,
    });
    await assert.rejects(
      f.service.review(
        f.project.id,
        f.actor("editor"),
        c.id,
        {
          expectedRevision: 1,
          decision: "approve",
          reason: "Independent evidence checked",
          humanConfirmed: true,
        },
        signal(),
      ),
      /INDEPENDENT/,
    );
    const approved = await f.service.review(
      f.project.id,
      f.actor("reviewer"),
      c.id,
      {
        expectedRevision: 1,
        decision: "approve",
        reason: "Independent evidence checked",
        humanConfirmed: true,
      },
      signal(),
    );
    assert.equal(approved.status, "approved-awaiting-upstream");
    const packet = f.service.packet(f.project.id, f.actor("reviewer"), c.id);
    assert.equal(packet.canonicalWritePerformed, false);
    await assert.rejects(
      f.service.confirm(
        f.project.id,
        f.actor("reviewer"),
        c.id,
        { expectedRevision: 2, newRef: f.upstream.ref(), humanConfirmed: true },
        signal(),
      ),
      /NEW_REVIEWED/,
    );
    f.upstream.generation = 2;
    await assert.rejects(
      f.service.confirm(
        f.project.id,
        f.actor("reviewer"),
        c.id,
        { expectedRevision: 2, newRef: f.upstream.ref(), humanConfirmed: true },
        signal(),
      ),
      /UPSTREAM_CORRECTION/,
    );
    f.upstream.value = 15;
    const applied = await f.service.confirm(
      f.project.id,
      f.actor("reviewer"),
      c.id,
      { expectedRevision: 2, newRef: f.upstream.ref(), humanConfirmed: true },
      signal(),
    );
    assert.equal(applied.status, "applied");
    assert.match(applied.upstreamReceiptSha256!, /^[a-f0-9]{64}$/);
    assert(
      f.store
        .events(f.project.id)
        .some((e) => e.action === "correction.upstream-confirmed"),
    );
  } finally {
    await f.close();
  }
});
test("revocation during source read or identity revalidation prevents proposal commit", async () => {
  const f = teamFixture();
  try {
    f.upstream.onRead = async () => {
      f.store.setMember(f.project.id, "editor", {
        accountId: "editor",
        role: "editor",
        active: false,
        revision: 2,
      });
    };
    await assert.rejects(
      f.service.propose(
        f.project.id,
        f.actor("editor"),
        f.proposal(),
        signal(),
      ),
      /FORBIDDEN/,
    );
    assert.equal(f.store.corrections(f.project.id).length, 0);
    f.upstream.onRead = null;
    f.store.setMember(f.project.id, "editor", {
      accountId: "editor",
      role: "editor",
      active: true,
      revision: 3,
    });
    await assert.rejects(
      f.service.propose(
        f.project.id,
        f.actor("editor"),
        f.proposal(),
        signal(),
        async () => {
          throw Error("TEAM_UNAUTHORIZED");
        },
      ),
      /UNAUTHORIZED/,
    );
    assert.equal(f.store.corrections(f.project.id).length, 0);
  } finally {
    await f.close();
  }
});
test("actual stateless HTTP MCP uses existing client, scopes search, binds assets and rechecks live revocation", async () => {
  const f = teamFixture(),
    clients: MaterialsMcpClient[] = [];
  try {
    const origin = await f.start(),
      path = "/v1/research/projects/" + f.project.id + "/mcp";
    const client = (id: string) => {
      const c = new MaterialsMcpClient({
        url: origin + path,
        projectId: f.project.id,
        fetch: async (u, i) =>
          fetch(u, {
            ...i,
            headers: {
              ...Object.fromEntries(new Headers(i?.headers)),
              Authorization: "Bearer " + id,
            },
          }),
      });
      clients.push(c);
      return c;
    };
    const reader = client("reader");
    await reader.connect();
    assert.equal(reader.discover().length, 8);
    const parse = (v: any) =>
      JSON.parse(v.content.find((p: any) => p.type === "text").text);
    const search = parse(
      await reader.call("moos_search", {
        query: "PVDF",
        reviewScope: "verified",
      }),
    );
    assert.equal(search.authorizationScope, "project-research");
    assert.equal(search.data.items.length, 1);
    assert.equal(search.data.totalMatches, null);
    assert(!JSON.stringify(search).includes("DO_NOT_LEAK"));
    assert(!JSON.stringify(search).includes("private-cursor"));
    const page = parse(
      await reader.call("moos_search", {
        query: "PVDF",
        reviewScope: "verified",
        cursor: search.data.nextCursor,
      }),
    );
    assert.equal(page.data.nextCursor, null);
    const denied = await reader.call("moos_get_experiment", {
      ref: { ...f.upstream.ref(), sourceId: 2 },
    });
    assert.equal(denied.isError, true);
    assert(
      f.store
        .events(f.project.id)
        .some((e) => e.actorId === "reader" && e.action === "moos.denied"),
    );
    const assets = parse(
      await reader.call("moos_search_assets", { ref: f.upstream.ref() }),
    );
    const handle = assets.data.items[0].handle;
    assert.match(handle, /^moos-team:/);
    assert.equal(
      (
        await reader.call("moos_read_asset", {
          handle,
          representation: "original",
        })
      ).isError,
      true,
    );
    const image = parse(
        await reader.call("moos_read_asset", {
          handle,
          representation: "preview",
        }),
      ),
      resource = await reader.readResource(image.data.resource);
    assert.equal(resource.contents[0]!.uri, image.data.resource);
    const other = client("reviewer");
    assert.equal(
      (
        await other.call("moos_read_asset", {
          handle,
          representation: "preview",
        })
      ).isError,
      true,
    );
    await assert.rejects(other.readResource(image.data.resource));
    f.upstream.large = true;
    const record = parse(
      await reader.call("moos_get_experiment", { ref: f.upstream.ref() }),
    );
    const decoded = await reader.readResource(record.data.resource);
    assert((decoded.contents[0] as any).text.includes("observations"));
    f.revoked.add("reader");
    await assert.rejects(reader.call("moos_status", {}));
    await assert.rejects(reader.readResource(image.data.resource));
    const unauth = await fetch(origin + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(unauth.status, 401);
    const impostor = await fetch(origin + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer reviewer",
        "X-Reviewer-ID": "editor",
      },
      body: "{}",
    });
    assert.equal(impostor.status, 403);
    const badOrigin = await fetch(origin + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer reviewer",
        Origin: "https://evil.invalid",
      },
      body: "{}",
    });
    assert.equal(badOrigin.status, 403);
    const admin = await fetch(
      origin + "/v1/research/projects/" + f.project.id,
      { headers: { Authorization: "Bearer platform-admin" } },
    );
    assert.equal(admin.status, 403);
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await f.close();
  }
});
test("role/manifest compare-and-swap and proposal/audit metadata survive restart", async () => {
  const temp = mkdtempSync(join(tmpdir(), "ua13-team-")),
    file = join(temp, "team.sqlite"),
    f = teamFixture(file);
  let second: TeamStore | null = null;
  try {
    assert.throws(
      () =>
        f.service.changeMember(f.project.id, f.actor("reader"), "another", {
          expectedRevision: 0,
          role: "reader",
          active: true,
          reason: "Add team member",
        }),
      /OWNER/,
    );
    const added = f.service.changeMember(
      f.project.id,
      f.actor("editor"),
      "another",
      {
        expectedRevision: 0,
        role: "reader",
        active: true,
        reason: "Add team member",
      },
    );
    assert.equal(added.revision, 1);
    assert.throws(
      () =>
        f.service.changeMember(f.project.id, f.actor("editor"), "another", {
          expectedRevision: 0,
          role: "reader",
          active: false,
          reason: "Revoke membership",
        }),
      /CONFLICT/,
    );
    const m = f.store.manifest(f.project.id);
    await f.service.saveManifest(
      f.project.id,
      f.actor("editor"),
      { ...m, revision: 2, materialSystem: "PVDF", refs: [f.upstream.ref()] },
      1,
      signal(),
    );
    await assert.rejects(
      f.service.saveManifest(
        f.project.id,
        f.actor("reader"),
        { ...m, revision: 2 },
        1,
        signal(),
      ),
      /FORBIDDEN/,
    );
    await f.service.propose(
      f.project.id,
      f.actor("editor"),
      f.proposal(),
      signal(),
    );
    second = new TeamStore(file);
    assert.equal(second.manifest(f.project.id).materialSystem, "PVDF");
    assert.equal(second.corrections(f.project.id).length, 1);
    assert.equal(second.member(f.project.id, "another")?.role, "reader");
    assert(second.events(f.project.id).length >= 4);
  } finally {
    second?.close();
    await f.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
