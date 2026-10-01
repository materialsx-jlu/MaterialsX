import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import type { ResearchModelSummary } from "../../../packages/contracts/src/desktop.js";

test("bundled model directory has 100 distinct, sourced, bilingual entries", async () => {
  const catalog = JSON.parse(await readFile(resolve("models/catalog.json"), "utf8")) as {
    schemaVersion: number;
    methodologyZh: string;
    methodologyEn: string;
    models: ResearchModelSummary[];
  };
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.models.length, 100);
  assert.equal(new Set(catalog.models.map((item) => item.id)).size, 100);
  assert.match(catalog.methodologyEn, /not a worldwide usage ranking/i);
  assert.ok(catalog.methodologyZh.includes("不代表全网使用量排名"));

  const categories = new Set(["atomistic", "materials-property", "materials-chat", "materials-cif-generation", "materials-language-base", "materials-text"]);
  for (const model of catalog.models) {
    assert.ok(categories.has(model.category), model.id);
    assert.ok(model.name.trim(), model.id);
    assert.ok(model.descriptionZh.trim() && model.descriptionEn.trim(), model.id);
    assert.equal(model.examples.length, 2, model.id);
    assert.ok(model.examples.every((example) => example.zh.trim() && example.en.trim()), model.id);
    assert.ok(model.sourceUrl.startsWith("https://"), model.id);
  }
});

test("every bundled Skill belongs to exactly one category", async () => {
  const categories = JSON.parse(await readFile(resolve("skills/categories.json"), "utf8")) as Array<{
    id: string;
    labelZh: string;
    labelEn: string;
    skills: string[];
  }>;
  const manifests = await Promise.all([
    "vendor/kdense-scientific-agent-skills/MANIFEST.json",
    "vendor/materialsx-default-skills/MANIFEST.json",
  ].map(async (path) => JSON.parse(await readFile(resolve(path), "utf8")) as { skills: string[] }));
  const bundled = manifests.flatMap((manifest) => manifest.skills).sort();
  const categorized = categories.flatMap((category) => {
    assert.ok(category.id && category.labelZh && category.labelEn);
    return category.skills;
  }).sort();
  assert.deepEqual(categorized, bundled);
});
