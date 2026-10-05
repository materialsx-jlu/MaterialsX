import {directResearchTools,initialResearchTools} from "./research-tools.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { HostTool } from "./host-mcp.js";
import type { ExecutionControl } from "./execution-control.js";
import type { Permission } from "../../contracts/src/agent.js";
export function hostRouter(tools: HostTool[], permissions: readonly Permission[], control?: ExecutionControl): HostTool[] {
  const authorized = tools.filter(t => t.permissions.every(p => permissions.includes(p)));
  const execute = async (tool: HostTool, args: unknown, signal: AbortSignal) => {
    signal.throwIfAborted(); const schema = z.fromJSONSchema(tool.parameters as any);
    const checked = schema.parse(args), id = `mcp-${randomUUID()}`;
    const cached = control?.beforeTool({ id, name: tool.name, args: checked, permissions: tool.permissions });
    if (cached !== undefined) return cached as Awaited<ReturnType<HostTool["execute"]>>;
    let result:Awaited<ReturnType<HostTool['execute']>>;
    try { result = await tool.execute(checked, signal); }
    catch (error) { control?.afterTool(id, { error: error instanceof Error ? error.message : "Tool failed" }, true); throw error; }
    control?.afterTool(id,result,false);
    await control?.verifyBackendSteps?.();return result;
  };
  const wrapped = authorized.map(t => ({ ...t, execute: (args: unknown, signal: AbortSignal) => execute(t,args,signal) }));
  if (!control) return wrapped;
  const plan=control.plan(),request=plan?.originalRequest??control.originalRequest?.();
  const initial=request?initialResearchTools(request,plan?.steps.map(s=>s.method)??[]):directResearchTools;
  const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  const routed: HostTool[] = [
    ...wrapped.filter(t => (directResearchTools.has(t.name)&&initial.has(t.name)||!!plan&&/Independent research subtask/.test(plan.originalRequest)&&["read","ls"].includes(t.name))),
    { name: "find_tools", description: "Find at most eight approved material tools by name/description. Returns exact schemas; no installation or extra permissions.", permissions: ["search"],
      parameters: { type: "object", properties: { query: { type: "string", maxLength: 160 } }, required: ["query"], additionalProperties: false },
      execute: async (args: any) => text(authorized.filter(t => (t.name+" "+t.description).toLowerCase().includes(args.query.toLowerCase())).slice(0,8).map(t=>({ name:t.name,description:t.description,parameters:t.parameters }))) },
    { name: "invoke_material_tool", description: "Invoke one registered material tool using its exact discovered schema. Reuses the original dispatcher, step/dependency/grant checks and actual receipts. No arbitrary code.", permissions: [],
      parameters: { type: "object", properties: { name: { type: "string" }, arguments: { type: "object", additionalProperties: true } }, required: ["name","arguments"], additionalProperties: false },
      execute: async (args: any, signal: AbortSignal) => { const tool=authorized.find(t=>t.name===args.name); if(!tool)throw Error("TOOL_NOT_APPROVED");return execute(tool,args.arguments,signal); } },
  ];
  return routed.filter(t => t.permissions.every(p => permissions.includes(p)));
}
