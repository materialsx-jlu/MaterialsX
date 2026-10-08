import { AgentError } from "../../contracts/src/agent.js";
import { composerParameters, normalizeCodexRequest, withNativeInstructions } from "./codex-protocol.js";
import type { CustomCallMapping } from "./codex-protocol.js";

function localToolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => ["input_text", "text"].includes(part?.type) && typeof part.text === "string"))
    return value.map((part) => part.text).join("\n");
  throw new AgentError("PROTOCOL_ERROR", "本地工具回执包含未支持的内容类型 / Unsupported local tool output content");
}

/** Preserve the fixed runtime's native function tools; custom grammar tools travel as JSON strings. */
export function localCodexRequest(raw: Record<string, any>, maxOutput: number, allowTools: boolean, supported?:ReadonlySet<string>) {
  if (raw.input?.some((i: any) => i.type === "additional_tools"))
    return { payload: normalizeCodexRequest(raw, maxOutput, allowTools) };
  if (!Array.isArray(raw.input) || !Array.isArray(raw.tools))
    throw new AgentError("PROTOCOL_ERROR", "Codex 未提供原生工具或输入");
  const customCalls: CustomCallMapping = {};
  const entries = raw.tools.flatMap((entry: any) => entry.type === "namespace"
    ? entry.tools.map((tool: any) => ({ ...tool, namespace: entry.name })) : [entry]);
  const counts = new Map<string, number>();
  for (const tool of entries) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  // Do not advertise native tools without a MaterialsX admission/receipt adapter.
  // Count names before filtering so existing namespace aliases remain unchanged.
  const tools = entries.filter((tool:any)=>!supported||supported.has(tool.name)).map((tool: any) => {
      if (tool.namespace) {
        // Match the names in Skills when unique; qualify only actual collisions.
        const name = counts.get(tool.name) === 1 ? tool.name : `${tool.namespace}__${tool.name}`;
        customCalls[name] = { name: tool.name, namespace: tool.namespace, type: "function_call" };
        tool = { ...tool, name, namespace: undefined };
      }
      if (tool.type === "function") return {type:'function',name:tool.name,description:String(tool.description??'').slice(0,4096),parameters:tool.parameters,...(typeof tool.strict==='boolean'?{strict:tool.strict}:{})};
      if (tool.type === "custom") {
        customCalls[tool.name] = { name: tool.name };
        return { type: "function", name: tool.name, description: tool.description, parameters: composerParameters, strict: true };
      }
      throw new AgentError("PROTOCOL_ERROR", `本地 Codex 暂不支持工具格式：${tool.type}`);
  });
  const input = raw.input.map((item: any) => {
    if (item.type === "function_call" && item.namespace) {
      const wire = Object.entries(customCalls).find(([, original]) => original.name === item.name && original.namespace === item.namespace)?.[0];
      if (!wire && !raw.input.some((r:any)=>r.type==='function_call_output'&&r.call_id===item.call_id))
        throw new AgentError("PROTOCOL_ERROR", "历史工具没有配对回执 / Historical tool has no paired receipt");
      // Historical evidence is not a current tool declaration. Never add this alias to tools/customCalls.
      return { ...item, name: wire ?? `${item.namespace}__${item.name}`, namespace: undefined };
    }
    if (item.type === "custom_tool_call") {
      if (!customCalls[item.name] && !raw.input.some((r:any)=>r.type==='custom_tool_call_output'&&r.call_id===item.call_id))
        throw new AgentError("PROTOCOL_ERROR", "历史工具没有配对回执 / Historical tool has no paired receipt");
      return { type: "function_call", call_id: item.call_id, name: item.name, arguments: JSON.stringify({ input: item.input }) };
    }
    if (item.type === "custom_tool_call_output") return { type: "function_call_output", call_id: item.call_id, output: localToolOutput(item.output) };
    if (item.type === "function_call_output") return { ...item, output: localToolOutput(item.output) };
    if (["message", "reasoning", "function_call"].includes(item.type) || (!item.type && item.role)) return item;
    throw new AgentError("PROTOCOL_ERROR", `本地 Codex 暂不支持输入格式：${item.type}`);
  });
  return { payload: { input: withNativeInstructions(raw, input), tools, tool_choice: allowTools ? "auto" : "none", stream: true, store: false, max_output_tokens: Math.min(raw.max_output_tokens ?? maxOutput, maxOutput) }, customCalls };
}
