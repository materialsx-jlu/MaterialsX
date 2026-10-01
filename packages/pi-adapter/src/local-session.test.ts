import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyLocalExecutionPolicy,
  assistantText,
  binaryReadGuidance,
  discoverLocalModels,
  discoverLocalModelLimits,
  extractLocalPdfPath,
  hasFabricatedExecution,
  isPrematureRpsmeFinalization,
  normalizeSkillMention,
  pdfPreprocessSpec,
  prepareRpsmeSourceContext,
  rpsmeToolPathError,
  validateRpsmeWrite,
  verifyRpsmeDeliverables,
} from "./local-session.js";

describe("discoverLocalModels", () => {
  it("reads and sorts an OpenAI-compatible local model catalog", async () => {
    const request = async () =>
      new Response(JSON.stringify({ data: [{ id: "z-chat", owned_by: "local" }, { id: "a-chat" }] }), { status: 200 });
    const models = await discoverLocalModels("http://localhost:1234/v1", request as typeof fetch);
    assert.deepEqual(models, [
      { id: "a-chat", ownedBy: "local" },
      { id: "z-chat", ownedBy: "local" },
    ]);
  });

  it("rejects a non-loopback model catalog", async () => {
    await assert.rejects(() => discoverLocalModels("https://models.example.com/v1"), /loopback/);
  });
});

describe("discoverLocalModelLimits", () => {
  it("uses LM Studio's loaded context length for Pi instead of a fixed 32K window", async () => {
    const request = async () => new Response(JSON.stringify({ models: [{
      key: "google/gemma-4-e4b", max_context_length: 131_072,
      loaded_instances: [{ id: "google/gemma-4-e4b", config: { context_length: 131_072 } }],
    }] }), { status: 200 });
    assert.deepEqual(await discoverLocalModelLimits("http://localhost:1234/v1", "google/gemma-4-e4b", request as typeof fetch), {
      contextWindow: 131_072, maxTokens: 16_384,
    });
  });

  it("falls back when the native LM Studio endpoint is unavailable", async () => {
    const request = async () => new Response("missing", { status: 404 });
    assert.deepEqual(await discoverLocalModelLimits("http://localhost:1234/v1", "model", request as typeof fetch), {
      contextWindow: 32_768, maxTokens: 4_096,
    });
  });
});

describe("MaterialsX local session safeguards", () => {
  it("routes PDF reads through the bundled preprocessing script", () => {
    const guidance = binaryReadGuidance("/tmp/paper.pdf", "/opt/MaterialsX/resources");
    assert.match(guidance ?? "", /PDF 自动预处理/);
    assert.match(guidance ?? "", /prepare_document_set\.py/);
    const spec = pdfPreprocessSpec("/tmp/paper.pdf", "/workspace", "/opt/MaterialsX/resources");
    assert.match(spec.command, /python/);
    assert.match(spec.args[0] ?? "", /prepare_document_set\.py$/);
    assert.match(spec.outputDir, /materials-output/);
  });

  it("reports a context overflow instead of an empty-text error", () => {
    assert.throws(
      () =>
        assistantText([
          {
            role: "assistant",
            content: [],
            stopReason: "length",
          } as never,
        ]),
      /上下文长度已超限/,
    );
  });

  it("returns only text from the current assistant turn", () => {
    const text = assistantText([
      {
        role: "assistant",
        content: [{ type: "text", text: "已完成" }],
        stopReason: "stop",
      } as never,
    ]);
    assert.equal(text, "已完成");
  });

  it("rejects simulated execution claims as an integrity failure", () => {
    assert.throws(
      () =>
        assistantText([
          {
            role: "assistant",
            content: [{ type: "text", text: "系统内部操作：模拟科学事实并假设所有关键中间文件均已准备就绪。" }],
            stopReason: "stop",
          } as never,
        ]),
      /任务完整性检查未通过/,
    );
  });

  it("blocks the exact placeholder package shape produced by a failed extraction", () => {
    const fake = JSON.stringify({
      document_id: "DOC-ID-123456",
      title: "Title of the Research Paper - Placeholder",
      doi: "10.1000/exampledoi.12345",
      entities: { materials: [] },
    });
    assert.equal(hasFabricatedExecution("假设 build_asset_manifest 已成功运行"), true);
    assert.equal(hasFabricatedExecution("我将模拟并完成 RPSME 抽取的全流程模拟"), true);
    assert.throws(() => validateRpsmeWrite("materials-output/draft.rpsme.v2.json", fake), /模拟或占位/);
    assert.throws(
      () => validateRpsmeWrite("materials-output/draft.rpsme.v2.json", JSON.stringify({ entities: {} })),
      /source、document_set 或 entities/,
    );
    assert.doesNotThrow(() => validateRpsmeWrite("materials-output/draft.rpsme.v2.json", JSON.stringify({
      source: {}, document_set: { documents: [] }, entities: {},
    })));
  });

  it("stops finalization before the model has read page evidence", () => {
    assert.equal(isPrematureRpsmeFinalization("bash", { command: "python3 quality_review.py WORKDIR/draft.rpsme.v2.json" }, false), true);
    assert.equal(isPrematureRpsmeFinalization("bash", { command: "python3 quality_review.py real.json" }, true), false);
    assert.equal(isPrematureRpsmeFinalization("bash", { command: "python3 prepare_document_set.py --main paper.pdf" }, false), false);
    assert.equal(isPrematureRpsmeFinalization("bash", { command: "python3 quality_review.py missing.rpsme.v2.json" }, true, "/tmp"), true);
    assert.match(rpsmeToolPathError("bash", { command: "python3 extract_facts.py --main-doc /tmp/paper.pdf --output-dir WORKDIR" }, "/tmp") ?? "", /WORKDIR/);
    assert.match(rpsmeToolPathError("bash", { command: "python3 extract_facts.py --main-doc missing.pdf --output-dir output" }, "/tmp") ?? "", /路径不存在/);
  });

  it("loads page-indexed PDF evidence into a bounded model context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "materialsx-pages-"));
    try {
      const pdf = join(directory, "paper.pdf");
      const spec = pdfPreprocessSpec(pdf, directory, directory);
      const pageDir = join(spec.outputDir, "doc");
      await mkdir(pageDir, { recursive: true });
      await writeFile(spec.manifest, JSON.stringify({ documents: [{ manifest: join(pageDir, "manifest.json") }] }));
      await writeFile(join(pageDir, "manifest.json"), JSON.stringify({ pages: [
        { pdf_page: 1, text_file: "page-0001.txt" }, { pdf_page: 2, text_file: "page-0002.txt" },
      ] }));
      await writeFile(join(pageDir, "page-0001.txt"), "Page one evidence");
      await writeFile(join(pageDir, "page-0002.txt"), "Page two evidence");
      const result = await prepareRpsmeSourceContext(pdf, directory, directory);
      assert.equal(result.pageCount, 2);
      assert.equal(result.includedPages, 2);
      assert.match(result.context, /Page one evidence/);
      assert.match(result.context, /Page two evidence/);
      assert.equal(extractLocalPdfPath(`提取 ${pdf}，输出 JSON`), pdf);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires real files and a complete validation report before claiming RPSME delivery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "materialsx-deliverables-"));
    try {
      const started = Date.now();
      await assert.rejects(() => verifyRpsmeDeliverables(directory, started, false), /没有读取任何分页证据/);
      await assert.rejects(() => verifyRpsmeDeliverables(directory, started, true), /缺少本轮生成的/);
      await writeFile(join(directory, "paper.rpsme.v2.json"), "{}");
      await writeFile(join(directory, "paper.summary.md"), "摘要");
      await writeFile(join(directory, "paper.validation.json"), JSON.stringify({ valid: true }));
      await assert.rejects(() => verifyRpsmeDeliverables(directory, started, true), /尚未同时通过/);
      await writeFile(join(directory, "paper.validation.json"), JSON.stringify({
        valid: true, full_schema_validation: true, extraction_quality_ready: true, source_coverage_complete: true,
      }));
      await assert.doesNotReject(() => verifyRpsmeDeliverables(directory, started, true));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("turns a leading @ mention into Pi's native Skill command", () => {
    assert.equal(
      normalizeSkillMention("@materials-literature-rpsme-json 提取 /tmp/paper.pdf"),
      "/skill:materials-literature-rpsme-json 提取 /tmp/paper.pdf",
    );
    assert.equal(normalizeSkillMention("请使用 @pymoo 优化"), "请使用 @pymoo 优化");
  });

  it("adds non-destructive local execution authorization to every prompt", () => {
    const prompt = applyLocalExecutionPolicy("@pymoo 运行优化");
    assert.match(prompt, /^\/skill:pymoo/);
    assert.match(prompt, /不需要.*确认|不要让用户.*确认/);
    assert.match(prompt, /不得声称命令已经执行/);
    assert.doesNotMatch(prompt, /RPSME 文献抽取/);
    assert.match(applyLocalExecutionPolicy("@materials-literature-rpsme-json 提取论文"), /RPSME 文献抽取/);
    assert.match(applyLocalExecutionPolicy("继续刚才的文献提取", true), /RPSME 文献抽取/);
  });
});
