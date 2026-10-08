// UA.0 read-only audit. It does not enqueue jobs, import, review, rebuild or fetch externally.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = process.env.MATERIALSX_UA0_MOOS_ORIGIN ?? "http://127.0.0.1:8080";
const url = new URL(origin);
assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "UA.0 allows only an existing loopback service");
assert(!url.username && !url.password && !url.search && !url.hash);
const receipts: Array<{ path: string; status: number; elapsedMs: number; hash: string }> = [];
async function get(path: string, headers?: Record<string, string>) {
  const started = performance.now();
  const response = await fetch(new URL(path, origin), { redirect: "error", signal: AbortSignal.timeout(15_000), ...(headers ? { headers } : {}) });
  const body = Buffer.from(await response.arrayBuffer());
  receipts.push({ path, status: response.status, elapsedMs: Math.round(performance.now() - started), hash: createHash("sha256").update(body).digest("hex") });
  const data = response.headers.get("content-type")?.includes("json") ? JSON.parse(body.toString()) : null;
  return { response, data, bytes: body.length };
}
const before = (await get("/api/knowledge/phase-zero")).data;
assert(before?.search_ready, "MOOS snapshot is unavailable or stale; do not rebuild it implicitly");
const status = (await get("/api/knowledge/indexes/status")).data;
const media = (await get("/api/knowledge/media?offset=0")).data;
const photos = (await get("/api/knowledge/media?modality=photo&offset=0")).data;
const simulations = (await get("/api/knowledge/simulations?offset=0")).data;
assert(Array.isArray(media.items) && Array.isArray(simulations.items));
const refs = [...media.items.slice(0, 3), ...simulations.items.slice(0, 3)];
const records: Array<Record<string, unknown>> = [];
const seen = new Set<string>();
for (const ref of refs) {
  const key = `${ref.experiment_id}:${ref.generation}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const { data: record, response } = await get(`/api/knowledge/records/${ref.experiment_id}?generation=${ref.generation}`);
  assert.equal(response.status, 200);
  assert.equal(record.experiment_id, ref.experiment_id);
  assert.equal(record.generation, ref.generation);
  records.push({ experimentId: record.experiment_id, sourceId: record.source_id,
    packageImportId: record.package_import_id, generation: record.generation,
    packageHash: record.package_sha256, projectionHash: record.projection_hash,
    review: record.review_status, sections: Object.fromEntries(Object.entries(record.projection)
      .filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).length])) });
}
const ref = refs[0]!;
const historical = await get(`/api/knowledge/records/${ref.experiment_id}?generation=${Math.max(1, ref.generation - 1)}`);
// A missing generation is a measured limitation, never a fallback to current data.
const missingVersion = await get(`/api/knowledge/records/${ref.experiment_id}?generation=999999`);
assert([404, 409].includes(missingVersion.response.status));
const forwarded = await get("/api/knowledge/phase-zero", { "X-Forwarded-For": "198.51.100.8" });
assert.equal(forwarded.response.status, 403);
const crossOrigin = await get("/api/knowledge/phase-zero", { Origin: "https://untrusted.example" });
assert.equal(crossOrigin.response.status, 403);
const asset = photos.items.find((item: any) => item.content_available && item.asset_id > 0);
let readableAsset = null;
if (asset) {
  // Reads a source-authorized local asset; never export image bytes into the report.
  const metadata = await get(`/api/assets/${asset.asset_id}/metadata`);
  const preview = await get(`/api/knowledge/media/${asset.experiment_id}/${encodeURIComponent(asset.id)}/preview?generation=${asset.generation}`);
  assert.equal(preview.response.status, 200);
  readableAsset = { assetId: asset.asset_id, experimentId: asset.experiment_id, generation: asset.generation,
    declaredHash: asset.sha256, access: asset.access_level, redistributable: asset.redistribution_allowed,
    metadataStatus: metadata.response.status, previewBytes: preview.bytes, previewHash: receipts.at(-1)!.hash };
}
const after = (await get("/api/knowledge/phase-zero")).data;
assert.equal(after.snapshot_id, before.snapshot_id);
assert.equal(after.manifest_hash, before.manifest_hash, "Source snapshot changed during read-only probe");
const counts = before.report.counts;
const entities = before.report.entity_types;
const report = {
  stage: "UA.0", origin: url.origin, measuredAt: new Date().toISOString(), sourceMutations: 0,
  snapshotId: before.snapshot_id, manifestHash: before.manifest_hash, unchanged: true,
  coverage: { experiments: counts.experiments, recipes: entities.recipe, processes: entities.process_step,
    simulations: entities.simulation_run, images: entities.media_artifact, performance: entities.property_observation },
  reviewStatuses: before.report.review_statuses,
  missingData: { withoutEvidence: counts.entities_without_evidence, missingConditions: counts.observations_without_conditions,
    missingUnits: counts.observations_without_original_unit },
  scope: before.scope_rule, projectionVersion: status.projection_version, namespace: status.model_namespace,
  automaticIndexing: status.automatic_indexing, productionAuthorization: status.production_authorization,
  externalModelCalls: status.external_model_calls, externalModelCost: status.external_model_cost,
  mediaVersion: media.version, simulationVersion: simulations.version, simulationExecutionEnabled: simulations.execution_enabled,
  oldGeneration: { requested: Math.max(1, ref.generation - 1), status: historical.response.status,
    available: historical.response.status === 200 },
  wrongGenerationStatus: missingVersion.response.status, forwardedStatus: forwarded.response.status,
  crossOriginStatus: crossOrigin.response.status, readableAsset, records, receipts,
};
const directory = resolve("runtime/agent/ua-0");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "moos.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ stage: report.stage, coverage: report.coverage, unchanged: report.unchanged, oldGeneration: report.oldGeneration, readableAsset: !!readableAsset }, null, 2));
