// Replaces the obsolete hard-coded Gemma probe; only the currently loaded local model is used.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { freemem, totalmem, arch, platform } from "node:os";
import { discoverLocalModelLimits } from "../../packages/pi-adapter/src/local-session.js";

const origin = process.env.MATERIALSX_UA0_LMSTUDIO_ORIGIN ?? "http://127.0.0.1:1234";
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname));
assert(!new URL(origin).username && !new URL(origin).password);
const response = await fetch(`${origin}/api/v0/models`, { signal: AbortSignal.timeout(5000) });
assert.equal(response.status, 200);
const metadata = await response.json() as { data: Array<{ id: string; type: string; state: string; max_context_length: number; loaded_context_length: number; quantization: string; compatibility_type: string }> };
const model = metadata.data.find(item => item.type === "llm" && item.state === "loaded");
assert(model, "No loaded LLM; this probe never loads/downloads a model");
const runtimeLimits = await discoverLocalModelLimits(`${origin}/v1`, model.id);
const requests: Array<Record<string, unknown>> = [];
for (const inputCharacters of [64, 8000]) {
  const content = `This is synthetic UA.0 benchmark data, not scientific evidence.\n${"sample=0; ".repeat(Math.ceil(inputCharacters / 10))}\nReply exactly OK.`;
  const start = performance.now();
  let headersMs: number | null = null, firstDeltaMs: number | null = null;
  let textDeltaMs: number | null = null, outputCharacters = 0, reasoningCharacters = 0;
  let finishReason: string | null = null, usage: unknown = null, error: string | null = null;
  try {
    const stream: Response = await fetch(`${origin}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({ model: model.id, messages: [{ role: "user", content }], max_tokens: 128,
        temperature: 0, stream: true, stream_options: { include_usage: true } }),
    });
    headersMs = Math.round(performance.now() - start);
    assert.equal(stream.status, 200);
    assert(stream.body);
    let pending = "";
    const decoder = new TextDecoder();
    function line(value: string) {
      if (!value.startsWith("data: ") || value.slice(6).trim() === "[DONE]") return;
      const event = JSON.parse(value.slice(6));
      if (event.usage) usage = event.usage;
      for (const choice of event.choices ?? []) {
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const text = choice.delta?.content ?? "", reasoning = choice.delta?.reasoning_content ?? "";
        if (text || reasoning) firstDeltaMs ??= Math.round(performance.now() - start);
        if (text) textDeltaMs ??= Math.round(performance.now() - start);
        outputCharacters += text.length; reasoningCharacters += reasoning.length;
      }
    }
    for await (const chunk of stream.body) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n"); pending = lines.pop() ?? "";
      for (const value of lines) line(value.trim());
    }
    pending += decoder.decode(); if (pending.trim()) line(pending.trim());
  } catch (cause) { error = cause instanceof Error ? cause.name : "UNKNOWN_ERROR"; }
  requests.push({ inputCharacters: content.length, maxOutputTokens: 128, headersMs, firstDeltaMs, textDeltaMs,
    totalMs: Math.round(performance.now() - start), outputCharacters, reasoningCharacters, finishReason, usage, error });
}
const report = { stage: "UA.0", measuredAt: new Date().toISOString(), origin, model,
  runtimeLimits, platform: `${platform()}-${arch()}`, memoryBytes: { total: totalmem(), free: freemem() },
  requests, cloudCalls: 0, tokensRequestedMax: 256,
  limitations: ["Two ordered samples, not cold/warm statistical estimates", "No scientific quality or goal-understanding validation", "No model load/unload or cache clearing"] };
await mkdir(resolve("runtime/agent/ua-0"), { recursive: true });
await writeFile(resolve("runtime/agent/ua-0/lmstudio.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ model: model.id, requests }, null, 2));
