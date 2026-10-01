import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

async function pinnedSkills(): Promise<string[]> {
  const manifests = await Promise.all(
    [
      "vendor/kdense-scientific-agent-skills/MANIFEST.json",
      "vendor/materialsx-default-skills/MANIFEST.json",
    ].map((path) => readFile(resolve(path), "utf8").then((value) => JSON.parse(value) as { skills: string[] })),
  );
  return manifests.flatMap((manifest) => manifest.skills);
}

test("provides a Chinese introduction for every pinned Skill", async () => {
  const skills = await pinnedSkills();
  const translations = JSON.parse(
    await readFile(resolve("skills/descriptions.zh.json"), "utf8"),
  ) as Record<string, string>;

  assert.deepEqual(
    skills.filter((name) => !translations[name]?.trim()),
    [],
  );
  assert.deepEqual(
    Object.keys(translations).filter((name) => !skills.includes(name)),
    [],
  );
});

test("provides one or two bilingual examples for every pinned Skill", async () => {
  const skills = await pinnedSkills();
  const examples = JSON.parse(
    await readFile(resolve("skills/examples.json"), "utf8"),
  ) as Record<string, Array<{ zh?: string; en?: string }>>;

  assert.deepEqual(
    skills.filter((name) => ![1, 2].includes(examples[name]?.length ?? 0)),
    [],
  );
  assert.deepEqual(
    skills.filter((name) => examples[name]?.some((example) => !example.zh?.trim() || !example.en?.trim())),
    [],
  );
  assert.deepEqual(
    Object.keys(examples).filter((name) => !skills.includes(name)),
    [],
  );
});

test("enables every pinned Skill by default", async () => {
  const catalogs: Array<[string, string]> = [
    ["vendor/kdense-scientific-agent-skills/MANIFEST.json", "skills/kdense-initial.json"],
    ["vendor/materialsx-default-skills/MANIFEST.json", "skills/materialsx-default.json"],
  ];
  for (const [manifestPath, configPath] of catalogs) {
    const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as { skills: string[] };
    const config = JSON.parse(await readFile(resolve(configPath), "utf8")) as {
      skills: string[];
      enabledSkills: string[];
    };
    assert.deepEqual(config.skills, manifest.skills);
    assert.deepEqual(config.enabledSkills, manifest.skills);
  }
});
