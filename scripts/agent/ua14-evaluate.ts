// Uses the existing desktop and App Server execution loops, never a new agent loop.
import {
  mkdir,
  readFile,
  writeFile,
  mkdtemp,
  rm,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir, cpus, totalmem, release } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkspaceStore } from "../../apps/desktop/main/store.js";
import { ResearchService } from "../../apps/desktop/main/research-service.js";
import { DesktopAgentRuntime } from "../../apps/desktop/main/agent-runtime.js";
import { supervisionStore } from "../../apps/desktop/main/agent-supervision-store.js";
import { PiLocalSessionService } from "../../packages/pi-adapter/src/local-session.js";
import { CodexEngine } from "../../packages/agent/src/codex-engine.js";
import { HostMcp } from "../../packages/agent/src/host-mcp.js";
import { TaskSupervisor } from "../../packages/agent/src/task-supervisor.js";
import { directPlan } from "../../packages/agent/src/research-planning.js";
import {
  localModelConnection,
  localResponsesInvoker,
} from "../../packages/agent/src/local-model-transport.js";
import {
  taskRefSchema,
  permissionGrantSchema,
} from "../../packages/contracts/src/agent.js";
import {
  benchmarkReport,
  benchmarkResult,
  type BenchmarkResult,
} from "../../packages/contracts/src/qualification.js";
import { qualificationCases } from "../../fixtures/agent/ua14-cases.js";
import { scientificFixture } from "../../tests/fixtures/agent/ua7-source.js";
import { sourceHash } from "../../packages/agent/src/data-source-router.js";
import { hash, canonical } from "../../packages/atomistic/src/discovery-io.js";
import { hashOwnedFile } from "../../packages/atomistic/src/artifact-io.js";
import { fingerprint } from "../../packages/release-readiness/src/qualification/fingerprint.js";
import {
  executionMetrics,
  summarizeResults,
} from "../../packages/release-readiness/src/qualification/metrics.js";
const args = process.argv.slice(2),
  option = (key: string, fallback: string) =>
    args.includes(key) ? (args[args.indexOf(key) + 1] ?? fallback) : fallback;
if (!args.includes("--live"))
  throw Error(
    "Pass --live to authorize local generation; no paid providers or user data are used.",
  );
const root = process.cwd(),
  out = resolve(option("--output", "runtime/agent/ua-14/benchmark"));
await mkdir(out, { recursive: true, mode: 0o700 });
const fp = await fingerprint(root),
  endpoint = option("--endpoint", "http://127.0.0.1:1234/v1"),
  modelId = option("--model", "openai/gpt-oss-20b");
const protocol = option("--protocol", "chat-completions");
if (protocol !== "chat-completions" && protocol !== "responses")
  throw Error("Explicit protocol required; no fallback.");
const connection = await localModelConnection(
  endpoint,
  modelId,
  fetch,
  protocol,
  { maxOutputTokens: 3200 },
);
const weightsFile = option("--weights-manifest", ""),
  weightsSha256 = weightsFile
    ? await import("./ua14-weights.js").then((m) =>
        m.verifyWeights(weightsFile, modelId),
      )
    : null;
const machineSha256 = hash(
  canonical({
    os: release(),
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    ram: totalmem(),
  }),
);
const requested = option("--cases", "all").split(","),
  selected = qualificationCases.filter(
    (c) => requested[0] === "all" || requested.includes(c.id),
  );
if (
  !selected.length ||
  (requested[0] !== "all" &&
    requested.some((id) => !selected.some((c) => c.id === id)))
)
  throw Error("Unknown case ID.");
const subjects = option("--subjects", "pi,codex,reference-codex").split(",");
if (
  new Set(subjects).size !== subjects.length ||
  subjects.some((s) => !["pi", "codex", "reference-codex"].includes(s))
)
  throw Error("Invalid subjects.");
const locales = option("--locales", "zh,en").split(",");
if (
  locales.some((l) => !["zh", "en"].includes(l)) ||
  new Set(locales).size !== locales.length
)
  throw Error("Invalid languages.");
const results: BenchmarkResult[] = [];
const storeReport = async () => {
  const report = benchmarkReport.parse({
    schemaVersion: "ua14-benchmark-v1",
    fingerprint: fp,
    createdAt: new Date().toISOString(),
    expectedCases: 60,
    results,
    reference: "unmodified-bundled-codex-app-server-with-same-host-tools",
    scientificQualification: false,
    externalModelCalls: 0,
  });
  await writeFile(
    join(out, "benchmark.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    join(out, "technical-summary.json"),
    JSON.stringify(summarizeResults(results), null, 2) + "\n",
    { mode: 0o600 },
  );
};
async function artifactFiles(
  path: string,
  dir = "materials-output",
): Promise<BenchmarkResult["artifacts"]> {
  const found: BenchmarkResult["artifacts"] = [];
  for (const e of await readdir(join(path, dir), { withFileTypes: true }).catch(
    () => [],
  )) {
    const name = join(dir, e.name),
      full = join(path, name);
    if (e.isSymbolicLink()) throw Error("ARTIFACT_SYMLINK");
    if (e.isDirectory()) found.push(...(await artifactFiles(path, name)));
    else if (e.isFile()) {
      const bytes = await readFile(full);
      if (bytes.length > 16 * 1024 * 1024) throw Error("ARTIFACT_SIZE");
      found.push({
        relativePath: name,
        sha256: (await hashOwnedFile(path, full, hash(bytes), 16 * 1024 * 1024))
          .sha256,
        bytes: bytes.length,
      });
    }
  }
  return found;
}
for (const c of selected)
  for (const locale of locales as ("zh" | "en")[])
    for (const subject of subjects as BenchmarkResult["subject"][]) {
      const temp = await mkdtemp(join(tmpdir(), "mx-ua14-")),
        path = join(temp, "project");
      await mkdir(path);
      const original = `batch=S${c.seed}\nbefore\n`,
        expected = original.replace("before", "after");
      await writeFile(join(path, "probe.txt"), original);
      const store = new WorkspaceStore(join(temp, "workspace.sqlite")),
        project = store.createProject(path),
        conversation = store.createConversation(project.id),
        run = store.addRun(project.id, "UA14 " + c.id, "running");
      const research = new ResearchService(store, {
        client: null,
        assetRoot: root,
        jobStateRoot: join(temp, "jobs"),
      });
      const sources =
        c.family === "file-edit" || c.family === "missing"
          ? []
          : Array.from({ length: 3 }, (_, i) => {
              const s = scientificFixture(project.id, i),
                observations = (s.data as any).observations;
              observations[0].value =
                c.expected.intercept + c.expected.slope * i;
              if (c.family === "incompatible" && i === 2)
                observations[0].unit = "%";
              (s.data as any).readEvidence[0].evidence_text =
                `Synthetic S${c.seed}: loading=${i} wt%, strength=${observations[0].value} ${observations[0].unit}.`;
              s.sha256 = sourceHash(s.data);
              s.evidence[0]!.sha256 = sourceHash(
                (s.data as any).readEvidence[0],
              );
              s.title = "Synthetic S" + c.seed + " sample " + i;
              return store.research.saveSnapshot(s);
            });
      const projectInputs = store.research.project(project.id);
      research.save(
        {
          ...projectInputs,
          revision: projectInputs.revision + 1,
          selected: sources.map((s) => s.id),
        },
        projectInputs.revision,
      );
      const inputSha256 = hash(
        canonical({ file: original, sources: sources.map((s) => s.data) }),
      );
      const conditionSha256 = hash(
        canonical({
          fingerprint: fp,
          connection,
          weightsSha256,
          machineSha256,
          inputSha256,
          prompt: c.prompt[locale],
          budget: { maxSeconds: 90, maxOutputTokens: 3200 },
          permissions: ["read", "search", "terminal", "patch", "science"],
          initialState: "fresh-workspace-and-engine-home",
          cachePolicy: "warm-shared-provider-no-cache-reset",
        }),
      );
      const pi = new PiLocalSessionService(root, join(temp, "pi"), (_p, id) =>
        research.tools(project.id, id),
      );
      const runtime = new DesktopAgentRuntime(
        store,
        pi,
        { cancel: () => false } as any,
        temp,
        { projectRoot: root },
        undefined,
        research,
      );
      let reference: CodexEngine | null = null,
        mcp: HostMcp | null = null,
        text = "",
        error: string | null = null,
        firstOutputMs: number | null = null;
      const start = Date.now(),
        startedAt = new Date(start).toISOString();
      try {
        const current = await localModelConnection(
          endpoint,
          modelId,
          fetch,
          protocol,
          { maxOutputTokens: 3200 },
        );
        if (canonical(current) !== canonical(connection))
          throw Error("MODEL_CHANGED_NO_MIXED_REPORT");
        if (subject !== "reference-codex")
          text = await runtime.run(
            run.id,
            project.id,
            conversation.id,
            path,
            {
              mode: "local",
              modelId,
              localEndpoint: endpoint,
              agentEngine: subject,
              localProtocol: protocol,
              localMaxOutputTokens: 3200,
            },
            c.prompt[locale],
            () => {
              if (firstOutputMs === null) firstOutputMs = Date.now() - start;
            },
          );
        else {
          research.begin(run.id, project.id, c.prompt[locale]);
          const task = taskRefSchema.parse({
              taskId: run.id,
              projectId: project.id,
              conversationId: conversation.id,
            }),
            grant = permissionGrantSchema.parse({
              grantId: randomUUID(),
              projectId: project.id,
              conversationId: conversation.id,
              permissions: ["read", "search", "terminal", "patch", "science"],
              approvedBy: "local-user",
              maxCredits: null,
              maxSeconds: 90,
            });
          const ctx = research.context(run.id),
            context = {
              task,
              grant,
              methods: pi.toolCapabilities(path, conversation.id),
              methodDescriptions: pi.toolDescriptions(path, conversation.id),
              inputVersions: ctx?.inputVersions ?? [],
              evidence: ctx?.evidence ?? [],
            };
          const control = new TaskSupervisor({
            context,
            engine: "codex",
            connectionId: connection.id,
            accountRef: "local",
            projectPath: path,
            researchContext: () => research.context(run.id),
            deliveryIssue: () => research.deliveryIssue(run.id),
            ...supervisionStore(store, run.id),
          });
          control.acceptPlan(directPlan(c.prompt[locale], context));
          const signal = AbortSignal.timeout(90000),
            tools = research.tools(project.id, conversation.id).map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters as Record<string, unknown>,
              permissions:
                pi.toolCapabilities(path, conversation.id).get(t.name) ?? [],
              execute: async (a: unknown, s: AbortSignal) =>
                t
                  .execute(randomUUID(), a as any, s, undefined, {} as any)
                  .then((r) => ({
                    content: r.content.filter(
                      (c): c is { type: "text"; text: string } =>
                        c.type === "text",
                    ),
                  })),
            }));
          mcp = new HostMcp(
            { files: [], skills: [] },
            undefined,
            { tools, permissions: grant.permissions, signal },
            control,
          );
          await mcp.start();
          reference = new CodexEngine({
            home: join(temp, "reference"),
            modelId,
            contextWindow: connection.contextWindow!,
            maxOutput: 3200,
            mcp: { url: mcp.url, token: mcp.token, tools: mcp.toolNames },
            mcpPermissions: mcp.permissionMap,
            invoke: localResponsesInvoker(connection),
          });
          const result = await reference.run({
            task,
            grant,
            projectPath: path,
            content: c.prompt[locale],
            control,
            onEvent: (e) => {
              if (e.type === "text" && firstOutputMs === null)
                firstOutputMs = Date.now() - start;
            },
          });
          text = result.text;
          control.finish("completed_with_limitations");
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      try {
        const afterConnection = await localModelConnection(
          endpoint,
          modelId,
          fetch,
          protocol,
          { maxOutputTokens: 3200 },
        );
        if (canonical(afterConnection) !== canonical(connection))
          error = "MODEL_CHANGED_DURING_CASE";
      } catch (e) {
        error ??= "MODEL_IDENTITY_UNAVAILABLE: " + String(e);
      }
      const state = store.agentJournal.read(run.id);
      let artifacts: BenchmarkResult["artifacts"] = [],
        checks: Record<string, boolean> = {};
      try {
        artifacts = await artifactFiles(path);
        const analyses = research.scientific.overview(project.id).analyses,
          audits = research.scientific.overview(project.id).audits;
        checks = {
          "real-receipts": !!state?.attempts.some(
            (a) => a.state === "completed",
          ),
          "not-scientifically-certified": analyses.every(
            (a) => a.scientificStatus === "needs_review",
          ),
        };
        if (c.family !== "file-edit")
          checks["unrelated-input-preserved"] =
            (await readFile(join(path, "probe.txt"), "utf8")) === original;
        if (c.family === "file-edit") {
          const bytes = await readFile(join(path, "probe.txt"));
          artifacts.push({
            relativePath: "probe.txt",
            sha256: hash(bytes),
            bytes: bytes.length,
          });
          checks["exact-preserving-edit"] = bytes.toString() === expected;
        } else if (c.family === "summary" || c.family === "fit") {
          const analysis = analyses.find(
            (a) =>
              a.taskId === run.id &&
              a.methodId ===
                (c.family === "summary" ? "descriptive-summary" : "linear-fit"),
          );
          checks["method-match"] = !!analysis;
          checks["json-and-report"] =
            artifacts.some((a) => a.relativePath.endsWith(".json")) &&
            artifacts.some((a) => a.relativePath.endsWith(".md"));
          checks["unit"] = analysis?.result.unit === c.expected.unit;
          const numeric =
            c.family === "summary"
              ? { mean: c.expected.mean }
              : { slope: c.expected.slope, intercept: c.expected.intercept };
          checks["numeric-tolerance"] =
            !!analysis &&
            Object.entries(numeric).every(
              ([k, v]) =>
                typeof analysis.result[k] === "number" &&
                Math.abs((analysis.result[k] as number) - v) <=
                  c.absoluteTolerance,
            );
          checks["three-source-evidence"] =
            !!analysis &&
            research.scientific
              .overview(project.id)
              .assessments.find((a) => a.id === analysis.assessmentId)
              ?.inputHashes.length === 3 &&
            audits.some((a) => a.taskId === run.id && a.inputs.length === 3);
        } else if (c.family === "comparison") {
          checks["accepted-source-delivery"] = research
            .deliveries(project.id)
            .some(
              (d) =>
                d.taskId === run.id && d.status === "accepted-with-limitations",
            );
          checks["csv-svg-report"] =
            artifacts.some((a) => a.relativePath.endsWith(".csv")) &&
            artifacts.some((a) => a.relativePath.endsWith(".svg")) &&
            artifacts.some((a) => a.relativePath.endsWith(".md"));
        } else if (c.family === "incompatible") {
          checks["no-invalid-statistics"] = analyses.length === 0;
          checks["incompatibility-evidence"] = audits.some(
            (a) =>
              a.inputs.length === 3 && a.decision !== "usable-with-limitations",
          );
          checks["quality-report"] = artifacts.some((a) =>
            a.relativePath.endsWith(".md"),
          );
        } else {
          checks["no-fabricated-analysis"] =
            analyses.length === 0 && artifacts.length === 0;
          checks["missing-acknowledged"] =
            /缺|补充|未提供|missing|not supplied|provide|insufficient/i.test(
              text,
            );
          delete checks["real-receipts"];
        }
      } catch (e) {
        error ??= String(e);
        checks["artifact-verification"] = false;
      }
      const result = benchmarkResult.parse({
        caseId: c.id,
        locale,
        subject,
        conditionSha256,
        inputSha256,
        model: connection,
        weightsSha256,
        platform: process.platform + "-" + process.arch,
        machineSha256,
        startedAt,
        passed: error === null && Object.values(checks).every(Boolean),
        checks,
        grant: state?.grant ?? null,
        taskState: state?.state ?? null,
        metrics: executionMetrics(state, Date.now() - start, firstOutputMs),
        artifacts,
        finalTextSha256: hash(text),
        error,
        journalSha256: state ? hash(canonical(state)) : null,
      });
      await mkdir(join(out, "receipts"), { recursive: true });
      await writeFile(
        join(out, "receipts", `${c.id}-${locale}-${subject}.json`),
        JSON.stringify({ result, text, state }, null, 2) + "\n",
        { mode: 0o600 },
      );
      results.push(result);
      await storeReport();
      console.log(
        JSON.stringify({
          id: c.id,
          locale,
          subject,
          passed: result.passed,
          elapsedMs: result.metrics.totalMs,
          error,
        }),
      );
      await reference?.dispose();
      await mcp?.close();
      await runtime.dispose();
      pi.dispose();
      await research.close();
      store.close();
      await rm(temp, { recursive: true, force: true });
    }
if (canonical(await fingerprint(root)) !== canonical(fp))
  throw Error("SOURCE_CHANGED_DURING_QUALIFICATION");
if (results.some((r) => !r.passed)) process.exitCode = 1;
