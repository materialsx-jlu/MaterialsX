import test from 'node:test';
import assert from 'node:assert/strict';
import {unreviewedSourceRequested} from './research-source-policy.js';
test('unreviewed MOOS data requires an explicit request; review wording alone is not permission', () => {
  for (const text of ['包含待审核来源', '允许本次读取待复核记录', '使用待审核配方', 'MOOS include-unreviewed']) assert.equal(unreviewedSourceRequested(text), true, text);
  for (const text of ['从 MOOS 获取水性涂料配方', '待复核记录有多少？', '不要使用待审核数据', '不允许本次读取待复核记录', '仅使用已审核记录，排除待审核来源', 'do not include unreviewed data', 'only verified; include-unreviewed is not permitted']) assert.equal(unreviewedSourceRequested(text), false, text);
});
