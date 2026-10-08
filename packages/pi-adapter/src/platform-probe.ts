import { responseFixtureEvents } from "./platform-probe-fixtures.js";
export { responseFixtureEvents } from "./platform-probe-fixtures.js";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { responsesRequestSchema } from "../../contracts/src/platform.js";
import { z } from "zod";

export const ROOTFLOW_TEST_MODEL = "gpt-5.6-sol";

const nativeUsage = z.object({
  input_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  output_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  input_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative() }).nullish(),
  output_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative() }).nullish(),
});

export class PiDiagnosticFailure extends Error {
  constructor(code: string, readonly diagnostic: {
    requests: number; httpStatuses: number[]; stopReason: string;
    rawUsage: z.infer<typeof nativeUsage>[]; toolDeltas: number;
    transportChecks: { code: string; paths?: string[] }[];
    toolCalls?: number; textDeltas?: number; textLength?: number; functionOutputSent?: boolean;
  }) { super(code); }
}

/** Explicit server-side diagnostic only. No user files, stored keys or SDK cost claims. */
export async function verifyPiResponsesLive(apiKey: string, fetchImpl: typeof fetch = fetch) {
  if (!apiKey.trim() || /[\r\n]/.test(apiKey)) throw new Error("invalid_diagnostic_credential");
  const credentials: NonNullable<NonNullable<Parameters<typeof ModelRuntime.create>[0]>["credentials"]> = {
    read: async () => undefined, list: async () => [],
    modify: async (_id, fn) => fn(undefined), delete: async () => {},
  };
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider("materialsx-diagnostic", {
    name: "RootFlowAI diagnostic", baseUrl: "https://api.rootflowai.com/v1",
    api: "openai-responses", apiKey: "diagnostic-runtime-override", authHeader: true,
    models: [{ id: ROOTFLOW_TEST_MODEL, name: ROOTFLOW_TEST_MODEL, api: "openai-responses", reasoning: false,
      input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      // Diagnostic settings only; no claim about supplier context capacity or price.
      contextWindow: 32768, maxTokens: 256 }],
  });
  const model = runtime.getModel("materialsx-diagnostic", ROOTFLOW_TEST_MODEL);
  if (!model) throw new Error("diagnostic_model_registration_failed");
  let requests = 0;
  const payloads: Record<string, unknown>[] = [];
  const httpStatuses: number[] = [];
  const usage: z.infer<typeof nativeUsage>[] = [];
  const transportChecks: { code: string; paths?: string[] }[] = [];
  const guardedFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://api.rootflowai.com/v1/responses" || requests >= 2) {
      transportChecks.push({ code: "unexpected_url_or_request_limit" });
      throw new Error("diagnostic_transport_guard");
    }
    let wireBody: unknown;
    try { wireBody = JSON.parse(String(init?.body)); } catch {
      transportChecks.push({ code: "non_json_wire_body", paths: [typeof init?.body,
        new Headers(init?.headers).get("content-encoding") ?? "identity"] });
      throw new Error("diagnostic_payload_guard");
    }
    const parsed = responsesRequestSchema.safeParse(wireBody);
    if (!parsed.success) {
      transportChecks.push({ code: "wire_schema_rejected", paths: parsed.error.issues.map((i) =>
        i.code === "unrecognized_keys" ? i.keys.join(",") : i.path.join(".")) });
      throw new Error("diagnostic_payload_guard");
    }
    const payload = parsed.data;
    if (payload.model !== ROOTFLOW_TEST_MODEL || payload.max_output_tokens > 256) {
      transportChecks.push({ code: "model_or_output_limit_mismatch", paths: [
        `model_match=${payload.model === ROOTFLOW_TEST_MODEL}`, `max_output_tokens=${payload.max_output_tokens}`,
      ] });
      throw new Error("diagnostic_payload_guard");
    }
    payloads.push(payload);
    requests++;
    const response = await fetchImpl(input, { ...init, redirect: "error" });
    httpStatuses.push(response.status);
    return response;
  };
  const options = { apiKey, fetch: guardedFetch, maxTokens: 256, maxRetries: 0,
    cacheRetention: "none" as const, timeoutMs: 60000,
    onProviderStreamEvent: (event: unknown) => {
      const e = z.object({ type: z.string(), response: z.object({ usage: nativeUsage }).optional() }).safeParse(event);
      if (e.success && e.data.type === "response.completed" && e.data.response) usage.push(e.data.response.usage);
    },
  };
  const tools = [{ name: "read_probe_material", description: "Read fixed synthetic silicon; no files or network.",
    parameters: { type: "object", properties: { symbol: { type: "string", enum: ["Si"] } },
      required: ["symbol"], additionalProperties: false } }];
  const user = { role: "user" as const, content: "Call read_probe_material with symbol Si. State the atomic number only after reading its result.", timestamp: 0 };
  const first = runtime.streamSimple(model, { messages: [user], tools }, { ...options,
    onPayload: (payload: unknown) => {
      // Pi includes optional properties with undefined values before JSON
      // serialization. Validate the wire body in guardedFetch after omission.
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("diagnostic_payload_guard");
      return { ...payload, tool_choice: { type: "function", name: "read_probe_material" } };
    },
  });
  let toolDeltas = 0;
  for await (const event of first) if (event.type === "toolcall_delta") toolDeltas++;
  const assistant = await first.result();
  const toolCalls = assistant.content.filter((c) => c.type === "toolCall");
  const tool = toolCalls[0];
  if (assistant.stopReason !== "toolUse" || toolCalls.length !== 1 || !tool ||
      tool.name !== "read_probe_material" || Object.keys(tool.arguments).length !== 1 || tool.arguments.symbol !== "Si") {
    throw new PiDiagnosticFailure("diagnostic_tool_call_failed", {
      requests, httpStatuses, stopReason: assistant.stopReason, toolCalls: toolCalls.length,
      rawUsage: usage, toolDeltas, transportChecks,
    });
  }
  const second = runtime.streamSimple(model, { tools, messages: [user, assistant, {
    role: "toolResult", toolCallId: tool.id, toolName: tool.name, isError: false,
    content: [{ type: "text", text: '{"symbol":"Si","atomicNumber":14,"source":"synthetic-probe-fixture"}' }], timestamp: 1,
  }] }, options);
  let textDeltas = 0;
  for await (const event of second) if (event.type === "text_delta") textDeltas++;
  const answer = await second.result();
  const text = answer.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  const followInput = payloads[1]?.input as Record<string, unknown>[] | undefined;
  if (answer.stopReason !== "stop" || !text.includes("14") || !followInput?.some((i) => i.type === "function_call_output")) {
    throw new PiDiagnosticFailure("diagnostic_tool_result_failed", {
      requests, httpStatuses, stopReason: answer.stopReason, textDeltas,
      textLength: text.length, functionOutputSent: followInput?.some((i) => i.type === "function_call_output") ?? false,
      rawUsage: usage, toolDeltas, transportChecks,
    });
  }
  if (usage.length !== 2 || httpStatuses.some((s) => s !== 200) || usage.some((u) =>
    u.output_tokens > 256 || (u.input_tokens_details?.cached_tokens ?? 0) > u.input_tokens ||
    (u.output_tokens_details?.reasoning_tokens ?? 0) > u.output_tokens)) throw new Error("diagnostic_usage_unverified");
  return { schemaVersion: "m5.0-live-pi-v1", generatedAt: new Date().toISOString(),
    environment: fetchImpl === fetch ? "real-provider" : "synthetic-fixture",
    provider: "rootflowai", model: ROOTFLOW_TEST_MODEL, sdkVersion: "0.99.1", protocol: "openai-responses",
    status: "pi_model_runtime_verified", requests, httpStatuses, toolDeltas, textDeltas,
    toolResultRoundtrip: true, rawUsage: usage, budgetPolicy: "waived-for-diagnostic-test",
    unverified: ["procurement_price", "provider_log_reconciliation", "context_window", "model_origin",
      "upstream_cancellation", "commercial_data_terms", "production_gateway", "full_scientific_workflow"] };
}

/** Offline compatibility evidence. The injected fetch cannot contact a provider. */
export async function verifyPiResponsesFixture() {
  const credentials: NonNullable<NonNullable<Parameters<typeof ModelRuntime.create>[0]>["credentials"]> = {
    read: async () => undefined, list: async () => [],
    modify: async (_id, fn) => fn(undefined), delete: async () => {},
  };
  const runtime = await ModelRuntime.create({ credentials,
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider("materialsx-fixture", {
    name: "MaterialsX synthetic fixture", baseUrl: "https://api.rootflowai.com/v1",
    api: "openai-responses", apiKey: "fixture-only-not-a-secret", authHeader: true,
    models: [{ id: "gpt-5.6", name: "gpt-5.6", api: "openai-responses", reasoning: false,
      input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192, maxTokens: 256 }],
  });
  const model = runtime.getModel("materialsx-fixture", "gpt-5.6");
  if (!model) throw new Error("fixture model registration failed");
  const payloads: Record<string, unknown>[] = [];
  let calls = 0;
  const fetchFixture: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://api.rootflowai.com/v1/responses") throw new Error("unexpected fixture URL");
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    responsesRequestSchema.parse(payloads.at(-1));
    calls++;
    if (calls > 2) throw new Error("unexpected retry in fixture");
    const events = responseFixtureEvents(calls === 1 ? "tool" : "text");
    const bytes = new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));
    // Deliberately split every UTF-8 character and JSON/tool argument boundary.
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  const options = { fetch: fetchFixture, maxTokens: 256, maxRetries: 0,
    cacheRetention: "none" as const, timeoutMs: 2000 };
  const user = { role: "user" as const, content: "Read synthetic silicon then state atomic number.", timestamp: 0 };
  const first = runtime.streamSimple(model, { messages: [user] }, options);
  let toolDeltas = 0;
  for await (const e of first) if (e.type === "toolcall_delta") toolDeltas++;
  const assistant = await first.result();
  const tool = assistant.content.find((c) => c.type === "toolCall");
  if (assistant.stopReason !== "toolUse" || !tool || tool.name !== "read_probe_material" ||
      JSON.stringify(tool.arguments) !== '{"symbol":"Si"}') throw new Error("fixture tool parsing failed");
  const second = runtime.streamSimple(model, { messages: [user, assistant, {
    role: "toolResult", toolCallId: tool.id, toolName: tool.name, isError: false,
    content: [{ type: "text", text: '{"symbol":"Si","atomicNumber":14}' }], timestamp: 1,
  }] }, options);
  let textDeltas = 0;
  for await (const e of second) if (e.type === "text_delta") textDeltas++;
  const answer = await second.result();
  const text = answer.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  if (answer.stopReason !== "stop" || text !== "硅的原子序数是 14。") throw new Error("fixture text parsing failed");
  const followInput = payloads[1]?.input as Record<string, unknown>[] | undefined;
  if (!followInput?.some((i) => i.type === "function_call_output")) throw new Error("fixture tool output missing");
  return { environment: "synthetic-fixture", sdkVersion: "0.99.1", protocol: "openai-responses",
    actualSupplierVerified: false, requests: calls, toolDeltas, textDeltas,
    toolResultRoundtrip: true, inputTokens: answer.usage.input, cacheReadTokens: answer.usage.cacheRead,
    outputTokens: answer.usage.output, unverified: ["real_supplier", "real_model", "context_window", "price", "live_pi_agent"] };
}

