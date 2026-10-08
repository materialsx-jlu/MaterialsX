import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { WorkflowInterruptedError,assembleRpsmeDraft, extractPageWithRetry, parseModelJson, runRpsmeWorkflow, restoreSourceQuote, splitSourcePage, validatePageExtraction, type AtomicFact, type SourcePage } from "./rpsme-workflow.js";

const page: SourcePage = { number: 2, documentId: "DOC-MAIN", path: "/paper/page-0002.txt", text: "We prepared FEP film. The FEP film is 250 μm thick. Silver was deposited on the film." };
const fact: AtomicFact = { sample: "FEP film", category: "property", name: "thickness", descriptionZh: "FEP 薄膜厚度", quote: "The FEP film is 250 μm thick.", value: 250, unit: "μm", conditions: "", recipe: "" };
const result = { facts: [fact], notes: "本页报告 FEP 厚度，未提供本测试条件。", gaps: [] };

describe("managed RPSME extraction", () => {
  it("rejects fabricated quotes and numbers before writing scientific facts", () => {
    assert.equal(validatePageExtraction(result, page).facts.length, 1);
    assert.throws(() => validatePageExtraction({ ...result, facts: [{ ...fact, quote: "The FEP film is 500 μm thick." }] }, page), /逐字定位/);
    assert.throws(() => validatePageExtraction({ ...result, facts: [{ ...fact, value: 500 }] }, page), /数值 500/);
    assert.throws(() => validatePageExtraction({ ...result, facts: [{ ...fact, quote: "Cooling was -5.2 °C.", value: 5.2 }] }, { ...page, text: "Cooling was -5.2 °C." }), /数值 5.2/);
    assert.throws(() => validatePageExtraction({ ...result, facts: [], notes: "本页内容与样品/条件检查说明（中文）" }, page), /占位说明/);
  });

  it("restores PDF line-wrap hyphens without changing scientific signs", () => {
    assert.equal(restoreSourceQuote("Strong FeN bonds", "Strong Fe-\nN bonds"), "Strong FeN bonds");
    const source = "The con-\nstructed film ex-\nhibits -5.2 °C and Fe-N bonds.";
    assert.equal(restoreSourceQuote("The constructed film exhibits -5.2 °C", source), "The con-\nstructed film ex-\nhibits -5.2 °C");
    assert.equal(restoreSourceQuote("exhibits 5.2 °C and Fe-N bonds.", source), "exhibits 5.2 °C and Fe-N bonds.");
    assert.equal(restoreSourceQuote("exhibits -5.2 °C and FeN bonds.", source), "exhibits -5.2 °C and FeN bonds.");
  });

  it("automatically repairs a refusal or bad quote without another user message", async () => {
    let calls = 0;
    const recovered = await extractPageWithRetry(page, ["FEP film"], async (prompt) => {
      calls++;
      if (calls === 1) return { message: "请确认是否继续" };
      assert.match(prompt, /上次结果未通过机器检查/);
      return result;
    });
    assert.equal(calls, 2);
    assert.equal(recovered.facts[0]?.value, 250);
  });

  it("retains verified facts when repair attempts still contain invalid candidates", async () => {
    let calls = 0;
    const recovered = await extractPageWithRetry(page, [], async () => {
      calls++;
      return { ...result, facts: [fact, { ...fact, value: 999 }] };
    });
    assert.equal(calls, 3);
    assert.equal(recovered.facts.length, 1);
    assert.ok(recovered.gaps.length > 0);
  });

  it("does not retry cancellation", async () => {
    let calls = 0;
    await assert.rejects(() => extractPageWithRetry(page, [], async () => {
      calls++;
      throw new DOMException("Cancelled", "AbortError");
    }), /Cancelled/);
    assert.equal(calls, 1);
  });

  it("does not retry budget exhaustion or an uncertain cloud outcome",async()=>{let calls=0;await assert.rejects(extractPageWithRetry(page,[],async()=>{calls++;throw new WorkflowInterruptedError("USAGE_PENDING");}),/USAGE_PENDING/);assert.equal(calls,1)});
  it("splits long pages without dropping text or mislabelling page numbers", () => {
    const largePage = { ...page, text: ("Continuous evidence from source.\n").repeat(100) };
    const parts = splitSourcePage(largePage, 600);
    assert.equal(parts.map((part) => part.text).join(""), largePage.text);
    assert.ok(parts.every((part) => part.text.length <= 600 && part.number === 2));
    assert.throws(() => parseModelJson("请手动继续执行"), /完整 JSON/);
    assert.deepEqual(parseModelJson('```json\n{"facts":[]}\n```'), { facts: [] });
  });

  it("preserves provenance and review status instead of granting quality approval", async () => {
    const packageValue = assembleRpsmeDraft({ primary_document_id: "DOC-MAIN", documents: [{ document_id: "DOC-MAIN", role: "main", filename: "paper.pdf", sha256: "a".repeat(64), page_count: 2 }] }, [{ page, extraction: result }], { title: "FEP film", doi: null }, "test-model", ["visual review pending"]);
    assert.equal(packageValue.evidence[0]?.evidence_text, fact.quote);
    assert.equal(packageValue.experiment_records[0]?.record_status, "needs_extraction_review");
    assert.equal(packageValue.source.profile.atomic_facts.length, 1);
    assert.equal(packageValue.entities.property_observations?.length, 1);
    assert.ok(packageValue.relations.some((relation) => relation.type === "YIELDS"));
    const python = join(process.cwd(), "python/.venv/bin/python");
    if (!existsSync(python)) return;
    const directory = await mkdtemp(join(tmpdir(), "materialsx-rpsme-schema-"));
    try {
      const file = join(directory, "paper.rpsme.v2.json"), report = join(directory, "validation.json");
      await writeFile(file, JSON.stringify(packageValue));
      try {
        await promisify(execFile)(python, [join(process.cwd(), "vendor/materialsx-default-skills/skills/materials-literature-rpsme-json/scripts/validate_package.py"), file, "--structural-only", "--report", report]);
      } catch (error) { if ((error as { code?: unknown }).code !== 1) throw error; }
      const validation = JSON.parse(await readFile(report, "utf8")) as { valid: boolean; issues: Array<{ code: string; message: string }> };
      assert.equal(validation.valid, true);
      assert.deepEqual(validation.issues.filter((issue) => ["SCHEMA", "DANGLING_EVIDENCE", "OBSERVATION_RELATION", "TEST_TARGET"].includes(issue.code)), []);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("writes real JSON, Chinese summary and final audit through the Python toolchain", async () => {
    const root = process.cwd(), python = join(root, "python/.venv/bin/python");
    if (!existsSync(python)) return;
    const directory = await mkdtemp(join(tmpdir(), "materialsx-rpsme-e2e-"));
    const scripts = join(root, "vendor/materialsx-default-skills/skills/materials-literature-rpsme-json/scripts");
    try {
      const pdf = join(directory, "sample.pdf");
      await promisify(execFile)(python, ["-c", "import pymupdf,sys; d=pymupdf.open(); p=d.new_page(); p.insert_text((50,50),'We prepared FEP film. The FEP film is 250 um thick.'); d.save(sys.argv[1])", pdf]);
      const prepared = join(directory, "prepared");
      await promisify(execFile)(python, [join(scripts, "prepare_document_set.py"), "--main", pdf, "--output-dir", prepared, "--ocr", "never"]);
      const answer = await runRpsmeWorkflow({ pdfPath: pdf, projectPath: directory, projectRoot: root, python, manifestPath: join(prepared, "document-set.manifest.json"), endpoint: "http://localhost:1234/v1", modelId: "test", contextWindow: 8192, signal: new AbortController().signal }, async (_prompt, label) => label === "论文元数据" ? { title: "Fixture", doi: null } : { ...result, facts: [{ ...fact, quote: "The FEP film is 250 um thick.", unit: "um" }] });
      assert.match(answer, /待复核草稿/);
      const jsonPath = answer.match(/\[RPSME JSON\]\(([^)]+)\)/)![1]!;
      const reportPath = answer.match(/\[校验报告\]\(([^)]+)\)/)![1]!;
      const summaryPath = answer.match(/\[中文摘要\]\(([^)]+)\)/)![1]!;
      assert.equal(JSON.parse(await readFile(decodeURI(jsonPath), "utf8")).evidence.length, 1);
      const report = JSON.parse(await readFile(decodeURI(reportPath), "utf8"));
      assert.equal(report.extraction_quality_ready, false);
      assert.match(await readFile(decodeURI(summaryPath), "utf8"), /待复核/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

});
