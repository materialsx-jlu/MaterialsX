/** Observe a cloned SSE response; never call a provider or modify the original stream. */
export async function observeRootflowWire(response: Response, startedAt: number, headersAt: number) {
  const reader = response.body?.getReader();
  if (!reader) return { startedAt, headersAt, streamEndedAt: Date.now(), events: [], terminal: [], firstTextAt: null, firstDeltaAt: null };
  const decoder = new TextDecoder();
  const events: any[] = [];
  let pending = "", size = 0, firstDeltaAt: number | null = null, firstTextAt: number | null = null;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 8 * 1024 * 1024) {
        void reader.cancel().catch(() => {});
        throw Error("WIRE_OBSERVATION_LIMIT");
      }
      pending += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).trimEnd(); pending = pending.slice(end + 1);
        if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") continue;
        let e: any;
        try { e = JSON.parse(line.slice(5)); } catch { continue; }
        if (e.type?.endsWith(".delta") && firstDeltaAt === null) firstDeltaAt = Date.now();
        if (e.type === "response.output_text.delta" && e.delta?.trim() && firstTextAt === null) firstTextAt = Date.now();
        // Keep only event names and terminal receipts, not all token fragments.
        events.push(["response.completed", "response.incomplete", "response.failed", "error"].includes(e.type) ? e : { type: e.type });
      }
    }
    return { startedAt, headersAt, streamEndedAt: Date.now(), firstDeltaAt, firstTextAt,
      events: events.map(e => e.type).filter(Boolean),
      terminal: events.filter(e => ["response.completed", "response.incomplete", "response.failed", "error"].includes(e.type))
        .map(e => ({ type: e.type, status: e.response?.status, model: e.response?.model,
          incomplete: e.response?.incomplete_details, error: e.response?.error?.code ?? e.error?.code ?? e.code,
          usage: e.response?.usage ?? null, output: e.response?.output?.map((i: any) => ({
            type: i.type, name: i.name, id: i.id, callId: i.call_id,
            text: i.content?.filter((p: any) => p.type === "output_text").map((p: any) => p.text).join(""),
            arguments: i.type === "function_call" ? i.arguments : undefined,
          })) })) };
  } finally { reader.releaseLock(); }
}
