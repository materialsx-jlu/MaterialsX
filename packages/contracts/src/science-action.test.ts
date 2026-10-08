import { test } from "node:test";
import assert from "node:assert/strict";
import { scienceActionSchema } from "./science-action.js";

const args = { action: "select", targetId: "structure-id", secondaryId: "singlepoint", potentialId: null, domain: "inorganic-crystals", mode: "exploratory", evidenceIds: [] };
test("optional interaction null has the same unspecified meaning as omission, without inventing science fields", () => {
  assert.equal(JSON.stringify(scienceActionSchema.parse({ ...args, interaction: null })), JSON.stringify(scienceActionSchema.parse(args)));
  assert.equal(scienceActionSchema.parse({ ...args, interaction: "long-range-required" }).interaction, "long-range-required");
  assert.equal(scienceActionSchema.safeParse({ ...args, interaction: "unknown" }).success, false);
  assert.equal(scienceActionSchema.safeParse({ action: "get", targetId: "job-id" }).success, false);
});
