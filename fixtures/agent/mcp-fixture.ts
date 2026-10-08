import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "ua1-readonly-fixture", version: "1" });
server.registerTool(
  "read",
  { inputSchema: { value: z.string() }, annotations: { readOnlyHint: true } },
  ({ value }) => ({ content: [{ type: "text", text: value }] }),
);
server.registerTool(
  "write",
  { inputSchema: {}, annotations: { readOnlyHint: false } },
  () => ({ content: [{ type: "text", text: "write requested" }] }),
);
server.registerTool(
  "slow",
  { inputSchema: {}, annotations: { readOnlyHint: true } },
  async (_args, extra) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 10000);
      extra.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(Error("ABORTED"));
        },
        { once: true },
      );
    });
    return { content: [{ type: "text", text: "finished" }] };
  },
);
server.registerResource("verified", "fixture://verified", { mimeType: "application/json" }, async (uri) => ({
  contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify({ actual: "owned resource" }) }],
}));
await server.connect(new StdioServerTransport());
