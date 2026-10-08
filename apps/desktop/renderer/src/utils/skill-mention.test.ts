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
test('typed picker mentions support spaces; quoted/code examples and emails stay inert',()=>{
 assert.equal(findSkillMention('读取 @file:"硅 sample',18)?.query,'file:"硅 sample');
 for(const value of ['`@pym','"@pym','```text\n@pym','user@pym'])assert.equal(findSkillMention(value,value.length),null);
 const value='读取 @paper:arxiv',mention=findSkillMention(value,value.length)!;
 assert.equal(applySkillMention(value,mention,'paper:"arxiv:2601.12345v2"').value,'读取 @paper:"arxiv:2601.12345v2" ');
});
