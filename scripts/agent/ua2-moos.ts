// Read-only MCP acceptance; never starts MOOS, mutates source data, or invokes an LLM.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MaterialsMcpClient } from "../../packages/agent/src/mcp-client.js";
const endpoint = new URL(process.env.MATERIALSX_MOOS_ORIGIN ?? "http://127.0.0.1:8080");
assert(["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash);
const directory = resolve(process.env.MATERIALSX_MOOS_MCP_DIRECTORY ?? "../MOOS/services/materials-mcp");
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const client = new MaterialsMcpClient({ command: process.execPath, args: [resolve(directory, "dist/src/server.js")], cwd: directory,
  env: { PATH: process.env.PATH ?? "", MOOS_API_ORIGIN: endpoint.origin, MOOS_CONNECTION_ID: "moos-acceptance", NO_PROXY: "127.0.0.1,localhost,::1" } });
const calls: Array<{ tool: string; elapsedMs: number }> = [];
async function tool(name: string, args: Record<string, unknown> = {}) {
  const started = Date.now(), response = await client.call(name, args);
  calls.push({ tool: name, elapsedMs: Date.now() - started });
  const value = JSON.parse((response.content as Array<{ type: string; text: string }>).find((c) => c.type === "text")!.text);
  assert(!response.isError, JSON.stringify(value));
  assert.equal(value.connectionId, "moos-acceptance"); assert.equal(value.externalModelCalls, 0); assert.equal(value.cloudExportAuthorized, false);
  return value.data;
}
async function raw(path: string, body?: unknown) {
  const response = await fetch(new URL(path, endpoint.origin), { redirect: "error", signal: AbortSignal.timeout(15000),
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  assert(response.ok, "Original API HTTP " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { value: response.headers.get("content-type")?.includes("json") ? JSON.parse(bytes.toString()) : null, hash: sha(bytes) };
}
const pinnedRecords = new Map<string, string>();
const recordPath = (ref: any) => "/api/knowledge/records/" + ref.experimentId + "?generation=" + ref.generation;
async function detail(ref: any) {
  let d = await tool("moos_get_experiment", { ref, limit: 50 });
  const resolvePage = async (page: any) => page.resource
    ? JSON.parse((await client.readResource(page.resource)).contents.find((c) => "text" in c)!.text as string) : page;
  d = await resolvePage(d);
  let cursor = d.nextCursor;
  for (let i = 0; cursor && i < 10; i++) {
    const page = await resolvePage(await tool("moos_get_experiment", { ref, limit: 50, cursor }));
    for (const key of Object.keys(page.data)) d.data[key].push(...page.data[key]);
    cursor = page.nextCursor;
  }
  assert(!cursor, "Fixture detail remains truncated");
  const r = await raw(recordPath(ref));
  pinnedRecords.set(recordPath(ref), r.hash);
  assert.equal(r.value.package_sha256, ref.packageSha256); assert.equal(r.value.projection_hash, ref.projectionSha256);
  for (const key of ["recipes", "ingredients", "processes", "observations"]) assert.deepEqual(d.data[key], r.value.projection[key] ?? [], key + " must match original HTTP");
  return { d, raw: r.value, rawHash: r.hash };
}
const measuredAt = new Date().toISOString();
const report: Record<string, any> = { stage: "UA.2", measuredAt, transport: "real stdio + existing loopback API", sourceMutations: 0,
  externalModelCalls: 0, payments: 0, cloudExport: false, privateContentExported: false, intelligenceValidated: false };
try {
  const before = await raw("/api/knowledge/phase-zero"), indexBefore = await raw("/api/knowledge/indexes/status");
  await client.connect(); assert.equal(client.discover().length, 8); assert(client.discover().every((t) => t.readOnly));
  const status = await tool("moos_status"); report.status = { scope: status.scope, snapshot: status.snapshot, reviewStatuses: status.reviewStatuses, coverage: status.coverage };
  const verified = await tool("moos_search", {}); report.verifiedFirstPage = { count: verified.items.length, outcome: verified.outcome };
  const found: any[] = []; let cursor: string | null = null;
  for (let page = 0; page < 12; page++) {
    const r = await tool("moos_search", { query: process.env.MATERIALSX_MOOS_FIXTURE_QUERY ?? "WO2025161063A1", entityKinds: ["recipe", "process", "performance"], reviewScope: "include-unreviewed", limit: 50, ...(cursor ? { cursor } : {}) });
    found.push(...r.items.filter((i: any) => i.sections.recipes && i.sections.processes && i.sections.observations && i.sections.evidence));
    cursor = r.nextCursor; if (found.length >= 2 || !cursor) break;
  }
  assert(found.length >= 2, "Insufficient bounded recipe/process/performance fixtures");
  const chosen = found.slice(0, 2), records: any[] = [];
  for (const item of chosen) {
    const r = await detail(item.ref); records.push(r);
    const first = r.raw.projection.evidence[0], e = await tool("moos_get_evidence", { ref: item.ref, evidenceId: first.id });
    assert.equal(e.evidence.evidence_text, first.evidence_text); assert.equal(e.evidence.field_path, first.field_path);
    report.records ??= []; report.records.push({ ref: item.ref, rawResponseSha256: r.rawHash, recipes: r.d.data.recipes.length,
      processes: r.d.data.processes.length, observations: r.d.data.observations.length, evidenceId: first.id, evidenceSha256: e.evidenceSha256 });
  }
  const selections = chosen.map((item, i) => ({ ref: item.ref, observationId: records[i].d.data.observations[0].id }));
  const compared = await tool("moos_compare_observations", { selections });
  const rawCompare = await raw("/api/knowledge/compare", { selections: selections.map((s) => ({ experiment_id: s.ref.experimentId, generation: s.ref.generation, observation_id: s.observationId })) });
  assert.deepEqual(compared.observations, rawCompare.value.observations); assert.deepEqual(compared.assessments, rawCompare.value.assessments);
  report.performance = { passed: true, ruleVersion: compared.ruleVersion, observationCount: compared.observations.length, states: compared.assessments.map((a: any) => a.state), rawResponseSha256: rawCompare.hash };
  report.queries = [];
  for (const query of ["辐射", "radiative"]) {
    const mcp = await tool("moos_search", { query, reviewScope: "include-unreviewed", limit: 10 });
    const api = await raw("/api/knowledge/search", { q: query, mode: "precise", offset: 0, limit: 10, filter: { property: "", unit: "", min: null, max: null, value_status: "", conditions: {} } });
    assert.deepEqual(mcp.items.map((d: any) => d.ref.experimentId), api.value.items.map((d: any) => d.experiment_id));
    report.queries.push({ query, matched: mcp.items.length, rawResponseSha256: api.hash });
  }
  let asset: any, assetCursor: string | null = null;
  for (let page = 0; page < 5 && !asset; page++) {
    const r = await tool("moos_search_assets", { modality: "photo", reviewScope: "include-unreviewed", limit: 20, ...(assetCursor ? { cursor: assetCursor } : {}) });
    asset = r.items.find((a: any) => a.contentAvailable && a.originalSha256 && a.rightsBasis); assetCursor = r.nextCursor; if (!assetCursor) break;
  }
  assert(asset, "No authorized photo fixture; do not simulate it");
  const linked = await tool("moos_read_asset", { handle: asset.handle, representation: "preview" });
  const image = await client.readResource(linked.resource);
  const blob = image.contents.find((c) => "blob" in c)! as { blob: string };
  const provenance = JSON.parse((image.contents.find((c) => "text" in c) as { text: string }).text).data;
  assert.equal(sha(Buffer.from(blob.blob, "base64")), provenance.contentSha256); assert.equal(provenance.derivedPreview, true);
  const rawPreview = await raw("/api/knowledge/media/" + asset.ref.experimentId + "/" + encodeURIComponent(asset.mediaId) + "/preview?generation=" + asset.ref.generation);
  assert.equal(rawPreview.hash, provenance.contentSha256);
  const recipeData = await detail(asset.ref);
  report.recipeImage = { passed: true, recipes: recipeData.d.data.recipes.length, processes: recipeData.d.data.processes.length, ref: asset.ref,
    mediaId: asset.mediaId, originalSha256: asset.originalSha256, previewSha256: provenance.contentSha256, previewBytes: provenance.bytes, redistributionAllowed: asset.redistributionAllowed };
  let simulation: any, simulationCursor: string | null = null;
  for (let page = 0; page < 12 && !simulation; page++) {
    const r = await tool("moos_search", { entityKinds: ["simulation"], reviewScope: "include-unreviewed", limit: 50, ...(simulationCursor ? { cursor: simulationCursor } : {}) });
    simulation = r.items.find((d: any) => d.simulationIds.length); simulationCursor = r.nextCursor; if (!simulationCursor) break;
  }
  assert(simulation, "No MCP simulation fixture");
  const simulationRecord = await raw(recordPath(simulation.ref));
  assert.equal(simulationRecord.value.projection_hash, simulation.ref.projectionSha256);
  assert.equal(simulationRecord.value.package_sha256, simulation.ref.packageSha256);
  pinnedRecords.set(recordPath(simulation.ref), simulationRecord.hash);
  const studyId = simulation.simulationIds[0], s = await tool("moos_get_simulation", { ref: simulation.ref, studyId });
  const original = await raw("/api/knowledge/simulations/" + simulation.ref.experimentId + "/" + encodeURIComponent(studyId) + "?generation=" + simulation.ref.generation);
  assert.deepEqual(s.declaration.study, original.value.study); assert.deepEqual(s.declaration.missing_fields, original.value.missing_fields);
  assert.equal(s.executionPerformed, false); assert.equal(s.declaration.execution_enabled, false);
  report.simulation = { passed: true, ref: simulation.ref, studyId, missingFields: s.declaration.missing_fields, executionPerformed: false, rawResponseSha256: original.hash };
  const wrong = await client.call("moos_get_experiment", { ref: { ...chosen[0].ref, generation: 999999 } }); assert.equal(wrong.isError, true);
  const after = await raw("/api/knowledge/phase-zero");
  assert.equal(after.value.snapshot_id, before.value.snapshot_id); assert.equal(after.value.manifest_hash, before.value.manifest_hash);
  const indexAfter = await raw("/api/knowledge/indexes/status");
  assert.deepEqual(indexAfter.value.source_versions, indexBefore.value.source_versions);
  for (const key of ["external_model_calls", "external_model_cost"]) assert.equal(indexAfter.value[key], indexBefore.value[key]);
  for (const [path, expected] of pinnedRecords) assert.equal((await raw(path)).hash, expected, "Selected source changed during acceptance");
  report.sourceVerification = { selectedRecordCount: pinnedRecords.size, selectedResponseHashesUnchanged: true,
    sourceVersionsUnchanged: true, externalModelCountersUnchanged: true, wholeDatabaseAudit: false };
  report.sourceSnapshotUnchanged = true; report.historicalVersionFallback = false; report.passed = true;
} catch (error) { report.passed = false; report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  await client.close(); report.calls = calls;
  const target = resolve("runtime/agent/ua-2"); await mkdir(target, { recursive: true });
  const body = JSON.stringify(report, null, 2) + "\n";
  await writeFile(resolve(target, "moos-" + measuredAt.replace(/[:.]/g, "-") + ".json"), body, { mode: 0o600 });
  await writeFile(resolve(target, "moos.json"), body, { mode: 0o600 });
  console.log(JSON.stringify({ stage: report.stage, passed: report.passed, error: report.error, tools: 8, calls: calls.length,
    snapshotReady: report.status?.snapshot.searchReady, performance: !!report.performance?.passed, recipeImage: !!report.recipeImage?.passed,
    simulation: !!report.simulation?.passed, sourceSnapshotUnchanged: report.sourceSnapshotUnchanged, externalModelCalls: 0 }));
}
