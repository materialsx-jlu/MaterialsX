import {selectedAssetTools} from './selected-assets.js';
import {toolFailureResult,failureFor} from './recovery-failures.js';
import {rejectedFailure} from './recovery-policy.js';
import { hostRouter } from "./host-tool-router.js";
import { controlParameters, controlDescription, type ExecutionControl } from "./execution-control.js";
import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { ScienceBridge } from "../../pi-adapter/src/science-bridge.js";
import type { CloudSelection } from "../../pi-adapter/src/platform-session.js";
import type { Permission } from "../../contracts/src/agent.js";

export interface HostTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  permissions: readonly Permission[];
  execute(args: unknown, signal: AbortSignal): Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

/** The bridge delegates to existing M6 business functions. No second scientific dispatcher. */
export class HostMcp {
  private http: Server | null = null;
  private sessions = new Set<{
    mcp: McpServer;
    transport: StreamableHTTPServerTransport;
  }>();
  token = randomBytes(32).toString("hex");
  url = "";
  constructor(
    private selection: CloudSelection,
    private science?: ScienceBridge,
    private local?: { tools: HostTool[]; permissions: readonly Permission[]; signal: AbortSignal },
    private control?: ExecutionControl,
  ) {this.selection=structuredClone(selection);}
  private localTools() { const selected=selectedAssetTools(this.selection); return hostRouter([...selected,...(this.local?.tools??[]).filter(t=>!selected.some(s=>s.name===t.name))], this.local?.permissions ?? ["read","search","science"], this.control); }
  get toolNames() {
    return [
      ...(this.science ? ["materials_science"] : []),
      ...this.localTools().map((t) => t.name),
      ...(this.control ? ["task_control"] : []),
    ];
  }
  get permissionMap() {
    return new Map([...this.localTools().map((t) => [t.name, t.permissions] as const), ["task_control", []] as const]);
  }
  get toolDefinitions():Array<Pick<HostTool,'name'|'description'|'parameters'>>{
    return [
      ...(this.science?[{name:'materials_science',description:this.science.tool.description,parameters:this.science.tool.parameters as unknown as Record<string,unknown>}]:[]),
      ...this.localTools(),...(this.control?[{name:'task_control',description:controlDescription,parameters:controlParameters}]:[]),
    ];
  }
  async start() {
    this.http = createServer(async (req, res) => {
      const a = Buffer.from(req.headers.authorization ?? ""),
        b = Buffer.from(`Bearer ${this.token}`);
      if (
        req.url !== "/mcp" ||
        a.length !== b.length ||
        !timingSafeEqual(a, b)
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      const mcp = new McpServer({ name: "materialsx", version: "1.0.0" });
      const result = (value: unknown) => ({
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
      });
      if (this.control) mcp.registerTool("task_control", { description: controlDescription, inputSchema: z.fromJSONSchema(controlParameters as any) as z.ZodObject, annotations: { readOnlyHint: false } },
        async args => {try{return result(await this.control!.command(args));}catch(error){return toolFailureResult(rejectedFailure(error,this.control),'task_control');}});
      if (this.science) {
        const schema = z.fromJSONSchema(
          this.science.tool.parameters as any,
        ) as z.ZodObject;
        mcp.registerTool(
          "materials_science",
          { description: this.science.tool.description, inputSchema: schema },
          async (args, extra) => {
            const id = `science-${randomBytes(16).toString("hex")}`;
            let recorded=false,admitted=false;
            try {await this.control?.verifyBackendSteps?.();
              const cached = this.control?.beforeTool({ id, name: "materials_science", args, permissions: ["science"] });
              admitted=true;
              if (cached !== undefined) return cached as any;
              const value = result(await this.science!.execute(args, extra.signal)); this.control?.afterTool(id, value, false);recorded=true; await this.control?.verifyBackendSteps?.();return value; }
            catch (error) { if(!recorded)this.control?.afterTool(id, { error: error instanceof Error ? error.message : "Science failed",recovery:failureFor(error) }, true); return toolFailureResult(admitted?error:rejectedFailure(error,this.control),'materials_science'); }
          },
        );
      }
      for (const tool of this.localTools()) {
        const schema = z.fromJSONSchema(tool.parameters as any) as z.ZodObject;
        mcp.registerTool(tool.name, {
          description: tool.description, inputSchema: schema,
          annotations: { readOnlyHint: tool.permissions.every((p) => p === "read" || p === "search") },
        }, async (args, extra) => {
          const signal = this.local ? AbortSignal.any([this.local.signal, extra.signal]) : extra.signal;
          signal.throwIfAborted();
          if (this.local && tool.permissions.some((p) => !this.local!.permissions.includes(p))) throw Error("TOOL_NOT_APPROVED");
          try{return await tool.execute(args, signal);}catch(error){return toolFailureResult(error,tool.name);}
        });
      }
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      const session = { mcp, transport };
      this.sessions.add(session);
      res.on("close", () => {
        this.sessions.delete(session);
        void transport.close();
        void mcp.close();
      });
      try {
        await mcp.connect(transport as Parameters<McpServer["connect"]>[0]);
        await transport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.http!.once("error", reject);
      this.http!.listen(0, "127.0.0.1", resolve);
    });
    const address = this.http.address();
    if (!address || typeof address === "string")
      throw Error("MCP_LISTEN_FAILED");
    this.url = `http://127.0.0.1:${address.port}/mcp`;
  }
  async close() {
    for (const s of this.sessions) {
      await s.transport.close();
      await s.mcp.close();
    }
    this.sessions.clear();
    this.http?.closeAllConnections();
    await new Promise<void>((resolve) =>
      this.http ? this.http.close(() => resolve()) : resolve(),
    );
    this.http = null;
  }
}
