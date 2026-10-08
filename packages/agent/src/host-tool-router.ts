import {directResearchTools} from "./research-tools.js";
import {discoverTools,initialToolNames} from './tool-discovery.js';
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { HostTool } from "./host-mcp.js";
import type { ExecutionControl } from "./execution-control.js";
import type { Permission } from "../../contracts/src/agent.js";
import {argumentError,failureFor,recoveryError,ToolExecutionError} from './recovery-failures.js';
import {rejectedFailure} from './recovery-policy.js';
export function hostRouter(tools: HostTool[], permissions: readonly Permission[], control?: ExecutionControl): HostTool[] {
  const authorized = tools.filter(t => t.permissions.every(p => permissions.includes(p)));
  const execute = async (tool: HostTool, args: unknown, signal: AbortSignal) => {
    signal.throwIfAborted(); await control?.verifyBackendSteps?.(); const schema = z.fromJSONSchema(tool.parameters as any);
    let checked:unknown;try{checked=schema.parse(args);}catch(error){throw rejectedFailure(argumentError(tool.name,tool.parameters,error),control);}
    const id = `mcp-${randomUUID()}`;
    let cached:unknown;try{cached=control?.beforeTool({ id, name: tool.name, args: checked, permissions: tool.permissions });}catch(error){throw rejectedFailure(error,control);}
    if (cached !== undefined) return cached as Awaited<ReturnType<HostTool["execute"]>>;
    let result:Awaited<ReturnType<HostTool['execute']>>;
    try { result = await tool.execute(checked, signal); }
    catch (error) { control?.afterTool(id, { ...(error instanceof ToolExecutionError?error.receipt:{error:error instanceof Error ? error.message : "Tool failed"}),recovery:failureFor(error) }, true); throw error; }
    control?.afterTool(id,result,(result as any).isError===true);
    await control?.verifyBackendSteps?.();return result;
  };
  const wrapped = authorized.map(t => ({ ...t, execute: (args: unknown, signal: AbortSignal) => execute(t,args,signal) }));
  if (!control) return wrapped;
  const plan=control.plan(),request=plan?.originalRequest??control.originalRequest?.();
  const initial=initialToolNames(authorized,request??'',plan?.steps.map(s=>s.method));
  const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  const routed: HostTool[] = [
    ...wrapped.filter(t => (directResearchTools.has(t.name)&&initial.has(t.name)||!!plan&&/Independent research subtask/.test(plan.originalRequest)&&["read","ls"].includes(t.name))),
    { name: "find_tools", description: "Find up to eight relevant tools using Chinese/English purposes, synonyms or exact names. Set includeSchema=true for exact runtime parameters. Hidden matches are called through invoke_material_tool, not added as direct functions. Never grants, installs or executes.", permissions: ["search"],
      parameters: { type: "object", properties: { query: { type: "string", maxLength: 160 }, includeSchema:{type:"boolean"} }, required: ["query"], additionalProperties: false },
      execute: async (args: any) => text({...discoverTools(tools,permissions,args.query,control.capabilities?.(),args.includeSchema===true),
       invocation:'For hidden matches use invoke_material_tool({name:<exact discovered name>,arguments:<object matching its parameters>}). Discovery does not add direct functions.'}) },
    { name: "invoke_material_tool", description: "Invoke one registered material tool using its exact discovered schema. Reuses the original dispatcher, step/dependency/grant checks and actual receipts. No arbitrary code.", permissions: [],
      parameters: { type: "object", properties: { name: { type: "string" }, arguments: { type: "object", additionalProperties: true } }, required: ["name","arguments"], additionalProperties: false },
      execute: async (args: any, signal: AbortSignal) => { const tool=authorized.find(t=>t.name===args.name); if(!tool)throw recoveryError('PERMISSION_DENIED',"TOOL_NOT_APPROVED",'permission');return execute(tool,args.arguments,signal); } },
  ];
  return routed.filter(t => t.permissions.every(p => permissions.includes(p)));
}
