import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "materialsx-m0", version: "0.0.1" });

server.registerTool(
  "materials_ping",
  {
    title: "MaterialsX M0 ping",
    description: "Returns a deterministic material formula for the M0 MCP integration test.",
    inputSchema: { formula: z.string().min(1) },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ formula }) => ({
    content: [{ type: "text", text: `M0:${formula}` }],
    structuredContent: { formula, status: "ok" },
  }),
);

await server.connect(new StdioServerTransport());
