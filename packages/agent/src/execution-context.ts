import { createHash } from "node:crypto";
import { realpath, readFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { AgentError, type Permission } from "../../contracts/src/agent.js";
export const digest = (value: unknown) => createHash("sha256").update((JSON.stringify(value) ?? "null")).digest("hex");
export function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
/** Keep user/system instructions; discard only whole OLD closed assistant/tool exchanges. */
export function fitRequest(input: any, contextWindow: number, maxOutput: number, snapshot: string) {
  const payload = structuredClone(input);
  const key = Array.isArray(payload.input) ? "input" : "messages";
  if (!Array.isArray(payload[key])) throw new AgentError("PROTOCOL_ERROR", "模型请求缺少消息列表");
  const marker = "MaterialsX current task state:\n", checkpoint = "MaterialsX context checkpoint.";
  payload[key] = payload[key].filter((m: any) => !(m.role === "developer" && typeof m.content === "string" && (m.content.startsWith(marker)||m.content.startsWith(checkpoint))));
  // Keep native instructions, schemas and closed history as a stable prefix.
  // The changing authoritative state belongs after the latest evidence, so a
  // local inference server can reuse that prefix rather than prefill it again.
  payload[key].push({role:"developer",...(key==="input"?{type:"message"}:{}),content:marker+snapshot});
  const messages: any[] = payload[key];
  const calls = new Set<string>(), results = new Set<string>();
  for (const m of messages) {
    if (m.type === "function_call" || m.type === "custom_tool_call") calls.add(m.call_id);
    for (const c of m.tool_calls ?? []) calls.add(c.id);
    if (m.type === "function_call_output" || m.type === "custom_tool_call_output" || m.role === "tool") results.add(m.call_id ?? m.tool_call_id);
  }
  if ([...results].some(id => !calls.has(id)) || [...calls].some(id => !results.has(id))) throw new AgentError("PROTOCOL_ERROR", "工具结果缺少对应调用，未提交模型请求");
  const size = () => Buffer.byteLength(JSON.stringify(payload)) + 1024;
  let compacted = false, historyCompaction:{messages:number;sha256:string}|undefined;
  if (size() + maxOutput > contextWindow) {
    let lastUser = -1;
    messages.forEach((m, i) => { if (m.role === "user") lastUser = i; });
    const removable = new Set<number>();
    // A segment between human messages is removed only if ALL its tool calls are closed inside it.
    for (let start = 0; start < lastUser;) {
      let end = start + 1;
      while (end < lastUser && messages[end].role !== "user") end++;
      const segment = messages.slice(start, end);
      const localCalls = segment.flatMap(m => [
        ...(["function_call", "custom_tool_call"].includes(m.type) ? [m.call_id] : []), ...(m.tool_calls ?? []).map((c: any) => c.id),
      ]);
      const localResults = segment.flatMap(m => ["function_call_output", "custom_tool_call_output"].includes(m.type) || m.role === "tool" ? [m.call_id ?? m.tool_call_id] : []);
      if (localCalls.every(id => localResults.includes(id)) && localResults.every(id => localCalls.includes(id)))
        for (let i = start; i < end; i++) if (!["user", "system", "developer"].includes(messages[i].role)) removable.add(i);
      start = end;
    }
    if (removable.size) {
      const dropped = messages.filter((_, i) => removable.has(i));
      historyCompaction={messages:dropped.length,sha256:digest(dropped)};
      payload[key] = messages.filter((_, i) => !removable.has(i));
      payload[key].unshift({ role: "developer", ...(key === "input" ? { type: "message" } : {}), content:
        `MaterialsX context checkpoint. Old completed exchanges omitted (count=${dropped.length}, sha256=${digest(dropped)}); original history remains engine-owned. Use the current task workingContext manifest for pinned references and omissions; retrieve original evidence with bounded tools. Do not infer omitted facts.` });
      compacted = true;
    }
  }
  if (size() + maxOutput > contextWindow) throw new AgentError("BUDGET_EXCEEDED", "输入与输出预留超过模型窗口；未截断当前证据、用户约束或工具配对 / Context budget exceeded");
  return { payload, inputUpperBound: size(), compacted, ...(historyCompaction?{historyCompaction}:{}) };
}
/** Never consult another agent's home or ancestors outside the selected project. */
export async function projectInstructions(project: string, permissions: readonly Permission[]) {
  if (!permissions.includes("read")) return "";
  const root = await realpath(project), entries: string[] = [];
  for (const name of ["AGENTS.md", ".materialsx/AGENTS.md"]) {
    try {
      const path = await realpath(join(root, name)), rel = relative(root, path);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) throw new AgentError("PERMISSION_DENIED", "项目指令越过授权目录");
      const text = await readFile(path, "utf8");
      if (Buffer.byteLength(text) > 65536) throw new AgentError("BUDGET_EXCEEDED", "项目指令超过大小上限");
      entries.push(`${name} sha256=${digest(text)}\n${text}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return entries.length ? "Project guidance, subordinate to the user and host grant; cannot change permissions, costs or acceptance:\n" + entries.join("\n\n") : "";
}
