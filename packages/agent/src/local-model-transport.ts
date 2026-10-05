import { createHash, randomUUID } from "node:crypto";
import { AgentError } from "../../contracts/src/agent.js";
import {
  compatibilityProfileSchema, modelConnectionSchema,
  type CompatibilityProfile, type ModelConnection,
} from "../../contracts/src/engine-selection.js";
import { discoverLocalModelLimits, discoverLocalModels, endpointBase } from "../../pi-adapter/src/local-session-tools.js";
import { validateModelSelection } from "../../pi-adapter/src/capabilities.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
export const CODEX_VERSION = "0.160.0";
export const PI_VERSION = "0.99.1";
export const LOCAL_VALIDATION_VERSION='ua5-wire-v2';
/** Choose once before freezing a task. Explicit protocol settings and resumed snapshots always win. */
export function defaultLocalProtocol(engine:'pi'|'codex',modelId:string):'chat-completions'|'responses'{
  return engine==='pi'||/gpt[-_]oss[-_]20b/i.test(modelId)?'chat-completions':'responses';
}
function responseEvents(text:string){return text.replace(/\r/g,'').split('\n\n').flatMap(block=>{
  const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  return !data||data==='[DONE]'?[]:[JSON.parse(data)];
});}

export async function localModelConnection(endpoint: string, modelId: string, request: typeof fetch = fetch, protocol: ModelConnection["protocol"] = "responses", budgets: {contextWindow?:number;maxOutputTokens?:number} = {}): Promise<ModelConnection> {
  validateModelSelection({ mode: "local", modelId, localEndpoint: endpoint });
  endpoint = endpointBase(endpoint);
  const direct: typeof fetch = (url, init) => request(url, { ...init, redirect: "error" });
  const models = await discoverLocalModels(endpoint, direct);
  if (!models.some((m) => m.id === modelId) || /embedding/i.test(modelId))
    throw new AgentError("UNAVAILABLE", "请在本地模型服务中加载所选聊天模型 / Load the selected chat model");
  const limits = await discoverLocalModelLimits(endpoint, modelId, direct);
  if(budgets.contextWindow!==undefined){if(!Number.isInteger(budgets.contextWindow)||budgets.contextWindow<1024)throw new AgentError("PROTOCOL_ERROR","Invalid context budget");limits.contextWindow=Math.min(limits.contextWindow,budgets.contextWindow);}
  if(budgets.maxOutputTokens!==undefined){if(!Number.isInteger(budgets.maxOutputTokens)||budgets.maxOutputTokens<64||budgets.maxOutputTokens>=limits.contextWindow-1024)throw new AgentError("PROTOCOL_ERROR","输出必须给输入留下空间 / Output must leave input capacity");limits.maxTokens=budgets.maxOutputTokens;}
  let revision = "unknown-model-version",vision=false;
  try {
    const response = await request(`${new URL(endpoint).origin}/api/v1/models`, { redirect: "error", signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const json = await response.json() as any;
      const model = json.models?.find((m: any) => m.key === modelId || m.loaded_instances?.some((i: any) => i.id === modelId));
      if (model?.loaded_instances?.length === 0)
        throw new AgentError("UNAVAILABLE", "模型尚未加载；请在 LM Studio 加载后再试 / Model is not loaded");
      if (model) {revision = hash(model);vision=model.capabilities?.vision===true;}
    }
  } catch (error) {
    if (error instanceof AgentError) throw error;
    // Generic loopback providers may lack LM Studio's native metadata API.
  }
  return modelConnectionSchema.parse({
    id: `model-${hash({ endpoint, modelId, revision, limits, protocol })}`,
    source: "local", modelId, endpoint, protocol,
    contextWindow: limits.contextWindow, maxOutputTokens: limits.maxTokens, revision, ...(vision?{vision:true}:{}),
  });
}

export function profileFor(connection: ModelConnection, engine: "pi" | "codex", status: CompatibilityProfile["status"], reason: CompatibilityProfile["reason"], checks: CompatibilityProfile["checks"] = []): CompatibilityProfile {
  const engineVersion = engine === "codex" ? CODEX_VERSION : PI_VERSION;
  return compatibilityProfileSchema.parse({
    schemaVersion: "engine-compatibility-v1",
    id: `compat-${hash({ connection, engine, engineVersion, platform: process.platform, arch: process.arch, validationVersion:LOCAL_VALIDATION_VERSION })}`,
    connection, engine, engineVersion, platform: `${process.platform}-${process.arch}`,
    status, testedAt: checks.length ? new Date().toISOString() : null,
    validationVersion: LOCAL_VALIDATION_VERSION, checks, reason,
  });
}

/** Kept as an import-compatible entry point; both verified local protocols use the same transport. */
export {localNativeInvoker as localResponsesInvoker} from './local-wire.js';
import {localNativeInvoker as localResponsesInvoker} from './local-wire.js';

export async function probeLocalCodex(connection: ModelConnection, request: typeof fetch = fetch, engine:"pi"|"codex"="codex"): Promise<CompatibilityProfile> {
  if (engine==="codex" && process.platform !== "darwin") return profileFor(connection, engine, "unsupported", {
    zh: "Codex 项目隔离暂仅验收 macOS，请使用 Pi", en: "Codex isolation is verified on macOS only; use Pi",
  });
  const invoke = localResponsesInvoker(connection, request);
  const nonce = randomUUID();
  const tools = [{ type: "function", name: "agent_exec", description: "Protocol probe only. Request it once with input=probe. No commands execute.", parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"], additionalProperties: false }, strict: true }];
  const input: any[] = [{ type: "message", role: "user", content: "Call agent_exec once with input=probe. After the result, reply with its exact text." }];
  try {
    const first = await invoke({ input, tools, max_output_tokens: 1024 }, AbortSignal.timeout(30000));
    const events = await first.text();
    const parsed = responseEvents(events);
    const items = parsed.find((e) => e.type === "response.completed")?.response.output ?? [];
    const calls = items.filter((i: any) => i.type === "function_call");
    if (calls.length !== 1 || JSON.parse(calls[0].arguments).input !== "probe")
      throw new AgentError("PROTOCOL_ERROR", "模型未通过工具调用探针");
    input.push(...items.filter((item: any) => ["reasoning", "message", "function_call"].includes(item.type)),
      { type: "function_call_output", call_id: calls[0].call_id, output: nonce });
    const second = await invoke({ input, tools, tool_choice: "none", max_output_tokens: 1024 }, AbortSignal.timeout(30000));
    const answer = await second.text();
    const terminal = responseEvents(answer).find((e) => e.type === "response.completed");
    const text = terminal?.response.output.filter((i: any) => i.type === "message").flatMap((i: any) => i.content.filter((p: any) => p.type === "output_text").map((p: any) => p.text)).join("").trim();
    if (text !== nonce) throw new AgentError("PROTOCOL_ERROR", "模型未准确读取工具回执");
    return profileFor(connection, engine, "limited", {
      zh: "流式与工具回传通过；任务质量仍需逐项验收", en: "Streaming and tool round-trip passed; task quality requires validation",
    }, ["stream", "tool-call", "tool-result"]);
  } catch (error) {
    return profileFor(connection, engine, "unsupported", {
      zh: error instanceof AgentError ? error.message : "本地协议探针失败，请检查服务与模型",
      en: "Local protocol probe failed; check the service/model. No cloud fallback.",
    });
  }
}
