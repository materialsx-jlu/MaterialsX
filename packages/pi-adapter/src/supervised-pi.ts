import { reportedPiUsage } from "../../agent/src/execution-receipts.js";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExecutionControl } from "../../agent/src/execution-control.js";
import { controlParameters, controlDescription } from "../../agent/src/execution-control.js";
import type { Permission } from "../../contracts/src/agent.js";
export function taskControlTool(get: () => ExecutionControl | undefined) {
  return defineTool({ name: "task_control", label: "研究步骤", description: controlDescription, parameters: controlParameters as any,
    execute: async (_id, args) => ({ content: [{ type: "text" as const, text: JSON.stringify(await get()?.command(args)) }], details: {} }) });
}
/** Uses Pi admission/provider events; does not run or retry Pi's tools. */
export function supervisePi(api: ExtensionAPI, get: () => ExecutionControl | undefined,
  required: (name: string) => readonly Permission[] | undefined, limits: { contextWindow: number; maxTokens: number },
  fail: (error: unknown) => void, wire?:{begin():void;usage():unknown|null}) {
  let requestId: string | null = null;
  api.on("before_provider_request", event => {
    wire?.begin();const control = get(); if (!control) return;
    try {
      const r = control.beforeRequest(event.payload, "execute", limits.contextWindow, limits.maxTokens);
      requestId = r.id; return r.payload;
    } catch (error) { fail(error); return event.payload; }
  });
  api.on("message_update",event=>{if(requestId && event.assistantMessageEvent.type.endsWith("_delta"))get()?.firstToken?.(requestId);});
  api.on("message_end", event => {
    if (event.message.role !== "assistant" || !requestId) return;
    get()?.endRequest(requestId, ["stop", "toolUse"].includes(event.message.stopReason) ? "completed" : "unknown", wire?wire.usage():reportedPiUsage(event.message.usage));
    requestId = null;
  });
  api.on("tool_call", event => {
    const control = get(); if (!control || event.toolName === "task_control" || event.toolName === "find_tools") return;
    try {
      const permissions = required(event.toolName);
      if (!permissions) return { block: true, reason: "未注册的工具" };
      const cached = control.beforeTool({ id: event.toolCallId, name: event.toolName, args: event.input, permissions });
      // Pi's event contract cannot replace execution; block a known completed mutation and direct it to the journal.
      if (cached !== undefined) return { block: true, reason: "该操作已有真实回执；使用 task_control status 查看并继续，不重复执行" };
    } catch (error) { return { block: true, reason: error instanceof Error ? error.message : "步骤检查拒绝执行" }; }
  });
  api.on("tool_result", async event => {
    if (["task_control", "find_tools"].includes(event.toolName)) return;
    get()?.afterTool(event.toolCallId, { content: event.content, isError: event.isError }, event.isError);
    if(!event.isError)await get()?.verifyBackendSteps?.();
  });
}
