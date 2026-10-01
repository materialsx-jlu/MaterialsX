import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
runtime.registerProvider("lmstudio", {
  name: "LM Studio",
  baseUrl: "http://localhost:1234/v1",
  api: "openai-completions",
  apiKey: "lm-studio-local",
  authHeader: false,
  models: [{
    id: "google/gemma-4-e4b",
    name: "google/gemma-4-e4b",
    api: "openai-completions",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 1024
  }]
});
const model = runtime.getModel("lmstudio", "google/gemma-4-e4b");
if (!model) throw new Error("model not registered");
const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: resolve(process.cwd(), ".materialsx-probe"),
  settingsManager,
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  systemPrompt: "你是 MaterialsX 本地材料研究助手。简洁回答。",
});
await resourceLoader.reload();
const { session } = await createAgentSession({
  cwd: process.cwd(),
  modelRuntime: runtime,
  model,
  resourceLoader,
  settingsManager,
  sessionManager: SessionManager.inMemory(process.cwd()),
  noTools: "all",
});
try {
  await session.prompt("只回答：Pi Agent 已连接 LM Studio");
  const response = [...session.messages].reverse().find((message) => message.role === "assistant");
  console.log(JSON.stringify(response));
} finally {
  session.dispose();
}
