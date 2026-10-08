import { AgentError } from "../../contracts/src/agent.js";
import { responsesRequestSchema } from "../../contracts/src/platform.js";

export const composerParameters = {
  type: "object",
  properties: { input: { type: "string" } },
  required: ["input"],
  additionalProperties: false,
} as const;
const names: Record<string, string> = {
  exec: "agent_exec",
  wait: "agent_wait",
};
/** Some runtime models send base instructions separately from input messages. */
export function withNativeInstructions(raw: Record<string, any>, input: any[]) {
  if (raw.instructions === undefined || raw.instructions === "") return input;
  if (typeof raw.instructions !== "string") throw new AgentError("PROTOCOL_ERROR", "原生引擎指令格式无效");
  return [{ type: "message", role: "developer", content: raw.instructions }, ...input];
}
export function normalizeCodexRequest(
  raw: Record<string, any>,
  maxOutput: number,
  allowTools = true,
) {
  if (!Array.isArray(raw.input))
    throw new AgentError("PROTOCOL_ERROR", "Codex 请求缺少输入");
  const tools: any[] = [];
  const input = raw.input.flatMap<any>((item: any) => {
    if (item.type === "additional_tools") {
      for (const namespace of item.tools ?? [])
        if (namespace.type === "namespace" && namespace.name === "functions") {
          for (const tool of namespace.tools ?? [])
            if (names[tool.name])
              tools.push({
                type: "function",
                name: names[tool.name],
                description: tool.description.slice(0, 4096),
                parameters: composerParameters,
                strict: true,
              });
        }
      return [];
    }
    if (item.type === "custom_tool_call") {
      if (item.namespace !== "functions" || !names[item.name])
        throw new AgentError("UNKNOWN_METHOD", "Codex 请求了未开放的组合工具");
      return [
        {
          type: "function_call",
          call_id: item.call_id,
          name: names[item.name],
          arguments: JSON.stringify({ input: item.input }),
        },
      ];
    }
    if (item.type === "custom_tool_call_output")
      return [
        {
          type: "function_call_output",
          call_id: item.call_id,
          output:
            typeof item.output === "string"
              ? item.output
              : JSON.stringify(item.output),
        },
      ];
    if (item.type === "message" || (!item.type && item.role))
      return [{ type: "message", role: item.role, content: item.content }];
    if (item.type === "reasoning")
      return [
        {
          type: "reasoning",
          ...(item.id ? { id: item.id } : {}),
          encrypted_content: item.encrypted_content ?? "",
          summary: item.summary ?? [],
        },
      ];
    throw new AgentError(
      "PROTOCOL_ERROR",
      `不支持的 Codex 输入类型：${item.type}`,
    );
  });
  if (!tools.length)
    throw new AgentError("PROTOCOL_ERROR", "Codex 没有提供受支持的工具目录");
  return responsesRequestSchema.parse({
    model: "materials-research",
    input: withNativeInstructions(raw, input),
    tools,
    tool_choice: allowTools ? "auto" : "none",
    stream: true,
    store: false,
    max_output_tokens: Math.min(raw.max_output_tokens ?? maxOutput, maxOutput),
    include: ["reasoning.encrypted_content"],
  });
}
/** Adapts wire events only. Native Codex performs the composed JS calls exactly once. */
export type CustomCallMapping = Record<string, { name: string; namespace?: string; type?: "function_call" | "custom_tool_call" }>;
export function codexResponse(response: Response, allowTools = true, mapping: CustomCallMapping = {
  agent_exec: { name: "exec", namespace: "functions" }, agent_wait: { name: "wait", namespace: "functions" },
}): Response {
  if (!response.ok || !response.body) return response;
  const encoder = new TextEncoder(),
    decoder = new TextDecoder();
  let buffer = "";
  const argumentChunks = new Map<string, string>();
  const convertedIds = new Set<string>();
  const itemIds = new Map<number, string>();
  const convertItem = (item: any, added = false) => {
    if (!allowTools && item?.type === "function_call")
      throw new AgentError("PERMISSION_DENIED", "需求解释阶段不能执行工具");
    if (
      item?.type !== "function_call" ||
      !mapping[item.name]
    )
      return item;
    if (mapping[item.name]!.type === "function_call") return { ...item, name: mapping[item.name]!.name, namespace: mapping[item.name]!.namespace };
    let parsed: any = { input: "" };
    if (item.arguments) {
      try {
        parsed = JSON.parse(item.arguments);
      } catch {
        throw new AgentError("PROTOCOL_ERROR", "组合工具参数不是有效 JSON");
      }
      if (typeof parsed.input !== "string") throw new AgentError("PROTOCOL_ERROR", "原生自定义工具需要 input 字符串");
    }
    return {
      ...item,
      type: "custom_tool_call",
      name: mapping[item.name]!.name,
      ...(mapping[item.name]!.namespace ? { namespace: mapping[item.name]!.namespace } : {}),
      arguments: undefined,
      input: added ? "" : parsed.input,
    };
  };
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, "");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end).replace(/\r/g, "");
          buffer = buffer.slice(end + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data || data === "[DONE]") continue;
          const event = JSON.parse(data);
          event.item_id ??= itemIds.get(event.output_index);
          if (
            event.type === "response.output_item.added" &&
            event.item?.type === "function_call"
          ) {
            itemIds.set(event.output_index, event.item.id);
            if (mapping[event.item.name] && mapping[event.item.name]!.type !== "function_call") convertedIds.add(event.item.id);
            event.item = convertItem(event.item, true);
          } else if (event.type === "response.function_call_arguments.delta" && convertedIds.has(event.item_id)) {
            argumentChunks.set(
              event.item_id,
              (argumentChunks.get(event.item_id) ?? "") + event.delta,
            );
            continue;
          } else if (event.type === "response.function_call_arguments.done" && convertedIds.has(event.item_id)) {
            const args = JSON.parse(
              event.arguments ?? argumentChunks.get(event.item_id) ?? "{}",
            );
            if (typeof args.input !== "string") throw new AgentError("PROTOCOL_ERROR", "原生自定义工具参数无效");
            const base = {
              output_index: event.output_index,
              item_id: event.item_id,
            };
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ ...base, type: "response.custom_tool_call_input.delta", delta: args.input })}\n\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ ...base, type: "response.custom_tool_call_input.done", input: args.input })}\n\n`,
              ),
            );
            continue;
          } else if (event.type === "response.output_item.done")
            event.item = convertItem(event.item);
          if (event.response?.output)
            event.response.output = event.response.output.map((item: any) =>
              convertItem(item),
            );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
      },
      flush() {
        if (buffer.trim())
          throw new AgentError("PROTOCOL_ERROR", "平台流未完整结束");
      },
    }),
  );
  return new Response(stream, {
    status: response.status,
    headers: { "Content-Type": "text/event-stream" },
  });
}
