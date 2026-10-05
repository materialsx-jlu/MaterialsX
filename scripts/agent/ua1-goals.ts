import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { interpretLocal } from "../../packages/pi-adapter/src/local-runtime.js";
import {
  interpretationPrompt,
  bindProposal,
} from "../../packages/agent/src/research-planning.js";
import {
  permissionGrantSchema,
  taskRefSchema,
} from "../../packages/contracts/src/agent.js";
const fixture = JSON.parse(
  await readFile(resolve("fixtures/agent/research-goals.v1.json"), "utf8"),
);
const endpoint = "http://127.0.0.1:1234/v1",
  modelId = "openai/gpt-oss-20b";
const models = (await (await fetch(endpoint + "/models")).json()) as any;
if (!models.data.some((m: any) => m.id === modelId))
  throw Error("固定模型未加载");
const jobs = fixture.cases.flatMap((c: any) =>
  ["zh", "en"].map((locale) => ({ c, locale })),
);
const results: any[] = [];
const directory = resolve("runtime/agent/ua-1");
await mkdir(directory, { recursive: true });
for (const { c, locale } of jobs) {
  const projectId = randomUUID(),
    conversationId = randomUUID();
  const task = taskRefSchema.parse({
    projectId,
    conversationId,
    taskId: randomUUID(),
  });
  const grant = permissionGrantSchema.parse({
    projectId,
    conversationId,
    grantId: randomUUID(),
    approvedBy: "local-user",
    permissions: ["read", "search", "terminal", "patch", "science"],
    maxCredits: "500",
    maxSeconds: 3600,
  });
  const methods = new Map<string, readonly any[]>([
    ["engine.execute", []],
    ["read", ["read"]],
    ["search", ["search"]],
    ["terminal", ["terminal"]],
    ["patch", ["patch"]],
    ["materials_science", ["science"]],
  ]);
  const context = { task, grant, methods };
  const started = performance.now();
  let entry: any = {
    id: c.id,
    locale,
    modelId,
    originalRequest: c.prompt[locale],
    task,
    grant,
  };
  try {
    const answer = await interpretLocal(
      endpoint,
      modelId,
      interpretationPrompt(c.prompt[locale], context) +
        "\nKeep JSON compact. Usually 1-3 steps suffice. Do not repeat the input text in every field.",
      AbortSignal.timeout(90000),
      1800,
    );
    const proposal = JSON.parse(
      answer
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
    entry.proposal = proposal;
    const plan = bindProposal(proposal, c.prompt[locale], context);
    entry = {
      ...entry,
      contractPass: true,
      proposal,
      originalRequestPreserved: plan.originalRequest === c.prompt[locale],
      numericTarget: c.goal.numericTarget,
      expectedMissing: c.cognition.missing,
      actualMissing: plan.cognition.missing.map((m) => m.question),
      expertReview: "pending",
    };
  } catch (cause) {
    entry = {
      ...entry,
      contractPass: false,
      error: cause instanceof Error ? cause.message : "MODEL_ERROR",
      expertReview: "pending",
    };
  }
  entry.durationMs = Math.round(performance.now() - started);
  results.push(entry);
  const report = {
    stage: "UA.1",
    kind: "real-model-interpretation",
    modelId,
    endpoint,
    interpretationVersion: "ua1-input-refs-v2",
    temperature: 0,
    outputLimit: 1800,
    total: jobs.length,
    finished: results.length,
    contractPass: results.filter((r) => r.contractPass).length,
    scientificAccuracyValidated: false,
    semanticExpertReview: "pending",
    results,
  };
  await writeFile(
    resolve(directory, "goals-local.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    `${c.id} ${locale}: ${entry.contractPass ? "contract-valid" : "rejected"} (${entry.durationMs}ms)`,
  );
}
