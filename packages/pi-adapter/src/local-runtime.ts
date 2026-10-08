import {createHash} from "node:crypto";
import {localWireFetch} from "../../agent/src/local-wire.js";
import type {ModelConnection} from "../../contracts/src/engine-selection.js";
import type { ExecutionControl } from "../../agent/src/execution-control.js";
import {localResponseFormatError} from '../../agent/src/model-recovery.js';
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  discoverLocalModelLimits,
  endpointBase,
  LOCAL_PROVIDER,
} from "./local-session-tools.js";
/** One local provider definition shared by session execution and tool-free interpretation. */
export async function localRuntime(endpoint: string, modelId: string, frozen?:ModelConnection) {
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async (_id, fn) => fn(undefined),
      delete: async () => {},
    },
  });
  const limits = frozen?{contextWindow:frozen.contextWindow!,maxTokens:frozen.maxOutputTokens}:await discoverLocalModelLimits(endpoint, modelId);
  const protocol=frozen?.protocol??'chat-completions',api=protocol==='responses'?'openai-responses':'openai-completions';
  const connection:ModelConnection=frozen??{id:('model-'+createHash('sha256').update(endpoint+modelId).digest('hex').slice(0,32)),source:'local',modelId,endpoint:endpointBase(endpoint),protocol,contextWindow:limits.contextWindow,maxOutputTokens:limits.maxTokens,revision:'unverified-metadata'};
  runtime.registerProvider(LOCAL_PROVIDER, {
    name: "LM Studio",
    baseUrl: endpointBase(endpoint),
    api,
    apiKey: "materialsx-local",
    authHeader: false,
    models: [
      {
        id: modelId,
        name: modelId,
        api,
        reasoning: false,
        input: connection.vision?["text","image"]:["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: limits.contextWindow,
        maxTokens: limits.maxTokens,
      },
    ],
  });
  const model = runtime.getModel(LOCAL_PROVIDER, modelId);
  if (!model) throw Error("无法注册本地模型");
  return { runtime, model, limits, connection };
}
export async function interpretLocal(
  endpoint: string,
  modelId: string,
  prompt: string,
  signal: AbortSignal,
  maxTokens?: number,
  control?: ExecutionControl,
  connection?:ModelConnection,
  purpose:'interpret'|'extract'='interpret',
): Promise<string> {
  // A response-only proposal has no executable side effects. Repair one local formatting failure
  // under the same frozen connection, signal and supervisor; never retry extraction or transport.
  for(let attempt=0;;attempt++){
    signal.throwIfAborted();
    try{return await interpretLocalOnce(endpoint,modelId,prompt,signal,maxTokens,control,connection,purpose);}
    catch(error){
      if(attempt>=1||purpose!=='interpret'||!localResponseFormatError(error)||
        (control&&control.canRecoverModelResponse?.()!==true))throw error;
    }
  }
}
async function interpretLocalOnce(
  endpoint:string,modelId:string,prompt:string,signal:AbortSignal,maxTokens?:number,
  control?:ExecutionControl,connection?:ModelConnection,purpose:'interpret'|'extract'='interpret',
):Promise<string>{
  const { runtime, model, limits,connection:frozen } = await localRuntime(endpoint, modelId,connection);
  let requestId: string | null = null,usage:unknown|null=null,wireError:unknown;
  const transport=localWireFetch(frozen,fetch,v=>{usage=v;});
  const stream = runtime.streamSimple(
    model,
    {
      systemPrompt:
        purpose==='extract'?"Extract facts from the provided source. Output JSON only; no tools, invented quotes or unsupported data.":"Interpret the research goal. Return a compact JSON data object, never a schema. No tool calls, protocol markers, fabricated quantities or evidence.",
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    },
    {
      signal,
      maxTokens: Math.min(maxTokens ?? limits.maxTokens, limits.maxTokens),
      maxRetries: 0,
      fetch: (async (input, init) => {
        const payload=JSON.parse(String(init?.body));
        payload.tool_choice='none';
        const r = control?.beforeRequest(payload, purpose==='extract'?'execute':'interpret', limits.contextWindow, Math.min(maxTokens ?? limits.maxTokens, limits.maxTokens));
        if(r)requestId=r.id;
        try{return await transport(input, { ...init, body:JSON.stringify(r?.payload??payload), signal });}catch(error){wireError=error;throw error;}
      }) as typeof fetch,
      temperature: 0,
    },
  );
  let text = "";
  for await (const e of stream) if (e.type === "text_delta") { if(requestId)control?.firstToken?.(requestId);text += e.delta; }
  const result = await stream.result();
  if (requestId) control?.endRequest(requestId, result.stopReason === "stop" ? "completed" : "unknown", usage);
  if(wireError instanceof Error)throw wireError;
  if (result.stopReason !== "stop") throw Error(`研究计划响应未完成（${result.stopReason}）：${result.errorMessage??'未取得完整 JSON；保留原预算'}`);
  return text;
}
