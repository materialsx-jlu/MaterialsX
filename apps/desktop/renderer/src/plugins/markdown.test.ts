import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "./markdown.js";

test("renders materials answers as structured Markdown", () => {
  const html = renderMarkdown(`**关键参数：** 熔融温度 ($T_{melt}$)

* 模具压力：5–10 bar
* 加热速率：保持平稳`);

  assert.match(html, /<strong>关键参数：<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /5–10 bar/);
});

test("renders tables and escapes model-supplied HTML", () => {
  const html = renderMarkdown(`| 参数 | 范围 |
| --- | --- |
| 压力 | 5–10 bar |

<script>alert(1)</script>`);

  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("does not turn unsafe protocols into links", () => {
  const html = renderMarkdown("[打开](javascript:alert(1))");

  assert.doesNotMatch(html, /href=/);
});
