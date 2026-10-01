import assert from "node:assert/strict";
import test from "node:test";
import { applySkillMention, findSkillMention } from "./skill-mention.js";

test("detects an empty skill mention immediately after @", () => {
  assert.deepEqual(findSkillMention("请使用@", 4), { start: 3, end: 4, query: "" });
});

test("keeps the current mention query for filtering", () => {
  assert.deepEqual(findSkillMention("分析数据 @pyma", 10), { start: 5, end: 10, query: "pyma" });
});

test("does not treat email addresses or completed mentions as active", () => {
  assert.equal(findSkillMention("user@example", 12), null);
  assert.equal(findSkillMention("@pymatgen 计算结构", 14), null);
});

test("replaces only the active mention and preserves following text", () => {
  const mention = findSkillMention("使用 @pym 分析", 7);
  assert.ok(mention);
  assert.deepEqual(applySkillMention("使用 @pym 分析", mention, "pymatgen"), {
    value: "使用 @pymatgen 分析",
    caret: 12,
  });
});
