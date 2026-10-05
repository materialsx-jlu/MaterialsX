import { composerAdmission } from "./composer-admission.js";
import { AgentError, type Permission } from "../../contracts/src/agent.js";
import type { ExecutionControl } from "./execution-control.js";
/** Model-call observation only; native tools are still executed by Codex. */
export function supervisedStream(response: Response, control: ExecutionControl, requestId: string,
  tools: ReadonlyMap<string, readonly Permission[]>, phase: "interpret" | "execute", mappings: Record<string, { name: string }> = {},hostTools?:ReadonlySet<string>) {
  if (!response.body) { control.endRequest(requestId, "unknown"); throw new AgentError("PROTOCOL_ERROR", "模型未返回数据流"); }
  const decoder = new TextDecoder(), encoder = new TextEncoder(); let buffer = "", terminal = false;
  const checked = new Set<string>();
  const checkCall = (item: any, finalized: boolean) => {
    if (item?.type !== "function_call" || checked.has(item.call_id)) return;
    if (phase !== "execute") throw new AgentError("PERMISSION_DENIED", "需求解释阶段禁止工具调用");
    const name = mappings[item.name]?.name ?? item.name;
    const required = tools.get(name) ?? (name === "agent_exec" || name === "exec" ? ["read", "search", "terminal", "patch"] as const : name === "agent_wait" || name === "wait" ? [] : undefined);
    // Added items arrive before the wire guard releases a verified terminal.
    // Reject a bad streaming name as a format error, so the SAME local engine can
    // correct it within the existing budget. A finalized undeclared native tool
    // remains unsupported; neither path invokes or authorizes the tool.
    if (!required) throw new AgentError(finalized ? "UNKNOWN_METHOD" : "PROTOCOL_ERROR",
      (finalized ? "未支持的原生工具 / Undeclared native tool: " : "模型调用未开放工具 / Unapproved tool: ")+JSON.stringify(name));
    if (["exec","agent_exec"].includes(name)) {
      if (!finalized) return;
      const args=JSON.parse(item.arguments || "{}");
      const admitted=composerAdmission(args.input,control,tools,hostTools);
      if(!admitted.host){const cached=control.beforeTool({id:item.call_id,name:admitted.name,args:admitted.args,permissions:admitted.permissions});if(cached!==undefined)throw new AgentError("CONFLICT","该原生操作已有真实回执，未重复执行");}
      checked.add(item.call_id);return;
    }
    if(!hostTools?.has(name))control.authorize(name === "wait" || name === "agent_wait" ? "engine.execute" : name, required);
    if (!finalized) return;
    if (["agent_wait", "wait", "exec_command", "apply_patch"].includes(name)) {
      const args = JSON.parse(item.arguments || "{}");
      const cached = control.beforeTool({ id: item.call_id, name: name === "wait" || name === "agent_wait" ? "engine.execute" : name, args, permissions: required });
      if (cached !== undefined) throw new AgentError("CONFLICT", "该原生操作已有真实回执；未重复执行");
    }
    checked.add(item.call_id);
  };
  const stream = response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
    transform(chunk, out) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, "");
      if (buffer.length > 1024 * 1024) throw new AgentError("BUDGET_EXCEEDED", "流事件超过大小上限");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0,end); buffer = buffer.slice(end+2);
        const data = block.split("\n").filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trimStart()).join("\n");
        if (data && data !== "[DONE]") {
          const event = JSON.parse(data);
          if(event.type?.endsWith(".delta"))control.firstToken?.(requestId);
          if (event.type === "response.output_item.added" || event.type === "response.output_item.done") checkCall(event.item, event.type === "response.output_item.done");
          if (event.response?.output) for (const item of event.response.output) checkCall(item, true);
          if (["response.completed", "response.failed", "response.incomplete"].includes(event.type)) {
            terminal = true; control.endRequest(requestId, event.type === "response.completed" ? "completed" : "failed", event.response?.usage ?? null);
          }
        }
        out.enqueue(encoder.encode(block+"\n\n"));
      }
    },
    flush() { if (!terminal || buffer.trim()) { control.endRequest(requestId,"unknown"); throw new AgentError("PROTOCOL_ERROR", "模型流缺少可靠终态"); } },
  } as Transformer<Uint8Array,Uint8Array>));
  // An upstream/parser failure does not invoke TransformStream.flush. Close the request
  // receipt on either read failure or consumer cancellation, retaining unknown usage.
  const reader=stream.getReader();
  const observed=new ReadableStream<Uint8Array>({
    async pull(out){
      try{const next=await reader.read();if(next.done)out.close();else out.enqueue(next.value);}
      catch(error){control.endRequest(requestId,'unknown');out.error(error);}
    },
    async cancel(reason){control.endRequest(requestId,'unknown');await reader.cancel(reason);},
  });
  return new Response(observed, { status: response.status, headers: response.headers });
}
