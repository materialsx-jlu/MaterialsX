import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { PiLocalSessionService } from "../packages/pi-adapter/src/local-session.js";

const pdf = process.argv[2];
if (!pdf) throw new Error("Usage: tsx scripts/rpsme-workflow-probe.ts PDF [model-id]");
const service = new PiLocalSessionService(process.cwd(), await mkdtemp(join(tmpdir(), "materialsx-rpsme-probe-")));
try {
  const result = await service.prompt("rpsme-probe", process.cwd(), {
    mode: "local", localEndpoint: "http://localhost:1234/v1", modelId: process.argv[3] ?? "openai/gpt-oss-20b",
  }, `@materials-literature-rpsme-json 提取 ${resolve(pdf)}，输出带证据的 RPSME JSON、中文摘要和校验报告。`, (text) => process.stdout.write(text));
  process.stdout.write(`\n\n${result}\n`);
} finally { service.dispose(); }
