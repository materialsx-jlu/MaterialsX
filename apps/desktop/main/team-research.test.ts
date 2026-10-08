import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { TeamResearchWorkspace } from "./team-research.js";
import { WorkspaceStore } from "./store.js";
import { ResearchService } from "./research-service.js";
import { teamFixture } from "../../../packages/agent/src/team/test-fixture.js";
import { IdentityClient } from "../../../packages/control-plane-client/src/identity.js";
test("desktop reuses M5 vault, routes team sources, verifies import and denies fallback/cloud on disconnect or revocation", async () => {
  const temp = mkdtempSync(join(tmpdir(), "ua13-desktop-")),
    f = teamFixture();
  mkdirSync(join(temp, "project"));
  const store = new WorkspaceStore(join(temp, "workspace.sqlite")),
    p = store.createProject(join(temp, "project")),
    research = new ResearchService(store, { client: null }),
    origin = await f.start();
  const vault = {
    available: () => true,
    read: async () => ({ origin, refreshToken: "fixture-refresh" }),
    write: async () => {},
    clear: async () => {},
  };
  let refreshes = 0;
  const identity = new IdentityClient(
    origin,
    vault,
    async () => {},
    true,
    async (u, i) => {
      if (String(u).endsWith("/v1/auth/refresh")) {
        refreshes++;
        return new Response(
          JSON.stringify({
            tokenType: "Bearer",
            accessToken: "editor",
            refreshToken: "fixture-refresh",
            expiresIn: 900,
            deviceId: "test-device",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return fetch(u, i);
    },
  );
  const team = new TeamResearchWorkspace(store, research, identity);
  try {
    assert.equal((await team.getTeamResearch(p.id)).remote, null);
    assert.equal((await team.listTeamProjects())[0]?.id, f.project.id);
    await team.saveTeamLink(
      p.id,
      { enabled: true, remoteProjectId: f.project.id, revision: 2 },
      1,
    );
    const result = await research.router.search(p.id, null, {
      query: "PVDF",
      reviewScope: "verified",
    });
    assert.equal(result.items.length, 1);
    const s = await research.select(p.id, result.items[0].ref);
    assert.equal((s.data.observations as any[])[0].value, 12);
    const m = f.store.manifest(f.project.id);
    await team.saveTeamManifest(
      p.id,
      {
        ...m,
        revision: 2,
        materialSystem: "PVDF",
        conditions: ["298 K"],
        refs: [f.upstream.ref()],
      },
      1,
    );
    await team.importTeamManifest(p.id);
    assert.equal(research.overview(p.id).project.materialSystem, "PVDF");
    assert.equal(research.overview(p.id).project.conditions[0], "298 K");
    await research.authorizeProject(p.id, false);
    await assert.rejects(research.authorizeProject(p.id, true), /LOCAL_MODEL/);
    const proposal = await team.proposeResearchCorrection(p.id, f.proposal());
    assert.equal(proposal.status, "proposed");
    await f.service.review(
      f.project.id,
      f.actor("reviewer"),
      proposal.id,
      {
        decision: "approve",
        expectedRevision: 1,
        reason: "Independent review against original page",
        humanConfirmed: true,
      },
      AbortSignal.timeout(5000),
    );
    const saved = await team.exportResearchCorrection(p.id, proposal.id);
    assert.equal(
      JSON.parse(readFileSync(join(p.path, saved.path), "utf8"))
        .canonicalWritePerformed,
      false,
    );
    const original = store.addRun(p.id, "Frozen team task", "running");
    const binding = research.begin(
      original.id,
      p.id,
      "Check selected source evidence",
    );
    assert(binding.approvedInputs.some((v) => v.id === "team-access:" + p.id));
    f.store.setMember(f.project.id, "editor", {
      accountId: "editor",
      role: "editor",
      active: true,
      revision: 2,
    });
    await research.authorizeProject(p.id, false);
    assert.throws(
      () =>
        research.begin(original.id, p.id, "Resume under changed authorization"),
      /TASK_AUTHORIZATION_CHANGED/,
    );
    f.revoked.add("editor");
    assert.equal((await team.getTeamResearch(p.id)).remote, null);
    assert.deepEqual(research.overview(p.id).snapshots[0]!.evidence, []);
    assert(
      !JSON.stringify(research.overview(p.id).snapshots[0]!.data).includes(
        "12",
      ),
    );
    assert.equal(
      store.research.sourceState(p.id, store.research.snapshots(p.id)[0]!.id),
      "denied",
    );
    await assert.rejects(
      research.router.search(p.id, null, {
        query: "PVDF",
        reviewScope: "verified",
      }),
    );
    store.research.receipt({
      id: randomUUID(),
      projectId: p.id,
      taskId: null,
      tool: "moos_get_experiment",
      args: { ref: s.ref },
      origin: "moos",
      outcome: "unavailable",
      at: new Date().toISOString(),
      sha256: null,
      detail: "Offline retry",
    });
    assert.equal(store.research.sourceState(p.id, s.id), "denied");
    f.revoked.delete("editor");
    await team.saveTeamLink(
      p.id,
      { enabled: false, remoteProjectId: f.project.id, revision: 3 },
      2,
    );
    await assert.rejects(
      research.router.moos(p.id, null, "moos_status", {}),
      /disconnected/,
    );
    await assert.rejects(
      team.saveTeamLink(
        p.id,
        { enabled: false, remoteProjectId: null, revision: 4 },
        3,
      ),
      /KEEP_DISABLED_BINDING/,
    );
    assert.equal(refreshes, 1);
  } finally {
    await team.close();
    await research.close();
    store.close();
    await f.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
test("team credential transport rejects off-origin/path requests and never replays mutating 401", async () => {
  const origin = "https://identity.example.invalid",
    project = randomUUID();
  let calls = 0,
    posts = 0;
  const client = new IdentityClient(
    origin,
    {
      available: () => true,
      read: async () => ({ origin, refreshToken: "fixture-refresh" }),
      write: async () => {},
      clear: async () => {},
    },
    async () => {},
    false,
    async (u, i) => {
      calls++;
      assert.equal(new URL(String(u)).origin, origin);
      if (String(u).endsWith("/v1/auth/refresh"))
        return new Response(
          JSON.stringify({
            tokenType: "Bearer",
            accessToken: "synthetic-access-only",
            refreshToken: "fixture-refresh",
            expiresIn: 900,
            deviceId: "D".repeat(43),
          }),
        );
      posts++;
      assert.equal(
        new Headers(i?.headers).get("Authorization"),
        "Bearer synthetic-access-only",
      );
      assert.equal(i?.redirect, "error");
      return new Response("{}", { status: 401 });
    },
  );
  assert.throws(() =>
    client.researchRequest("https://evil.invalid/v1/research/projects"),
  );
  assert.throws(() =>
    client.researchRequest("/v1/research/projects/" + project + "/../mcp"),
  );
  assert.throws(() =>
    client.researchRequest("/v1/research/projects?token=private"),
  );
  assert.equal(
    (
      await client.researchRequest(
        "/v1/research/projects/" + project + "/corrections",
        { method: "POST", body: "{}" },
      )
    ).status,
    401,
  );
  assert.equal(calls, 2);
  assert.equal(posts, 1);
});
