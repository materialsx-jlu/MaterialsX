import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { materialsDatasetSchema } from "./index.js";

const hash = "a".repeat(64);
const evidence = { sourceUri: "paper.pdf", sourceHash: hash, page: 4, extractionMethod: "native_text" as const };

function fixture() {
  return {
    schemaVersion: "1.0",
    datasetId: "dataset-1",
    title: "CFRP tensile series",
    source: { uri: "paper.pdf", sha256: hash, importedAt: "2026-09-30T00:00:00.000Z" },
    samples: [
      {
        id: "sample-a",
        label: "CFRP-A",
        aliases: [],
        composition: [
          { component: "carbon fiber", value: 60, basis: "mass_percent", evidence: [evidence] },
          { component: "epoxy", value: 40, basis: "mass_percent", evidence: [evidence] },
        ],
        process: [{ order: 0, name: "hot press", parameters: { temperature_c: 120 }, evidence: [evidence] }],
        measurements: [
          { property: "tensile_strength", value: 812, unit: "MPa", conditions: { temperature_c: 23 }, evidence: [evidence] },
        ],
        missing: [{ field: "strain_rate", reason: "not_reported" }],
      },
    ],
    revisions: [{ revision: 1, timestamp: "2026-09-30T00:00:00.000Z", actor: "extractor", note: "initial" }],
  };
}

describe("MaterialsDataset schema", () => {
  it("accepts evidence-linked sample, process, and measurement data", () => {
    const parsed = materialsDatasetSchema.parse(fixture());
    assert.equal(parsed.samples[0]?.measurements[0]?.unit, "MPa");
    assert.equal(parsed.samples[0]?.missing[0]?.reason, "not_reported");
  });

  it("rejects percentage compositions above 100", () => {
    const value = fixture();
    value.samples[0]!.composition[1]!.value = 50;
    assert.throws(() => materialsDatasetSchema.parse(value), /合计不能超过 100/);
  });

  it("rejects measurements without source evidence", () => {
    const value = fixture();
    value.samples[0]!.measurements[0]!.evidence = [];
    assert.throws(() => materialsDatasetSchema.parse(value));
  });
});
