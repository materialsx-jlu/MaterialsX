import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { AgentError } from "../../contracts/src/agent.js";

export const MCP_PROTOCOL = "2025-11-25";
export type McpTransportConfiguration = StdioServerParameters | { url: string; fetch: typeof fetch; projectId: string };
export class MaterialsMcpClient {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private controllers = new Set<AbortController>();
  private connecting: Promise<void> | null = null;
  private tools = new Map<
    string,
    {
      name: string;
      description?: string;
      inputSchema: unknown;
      readOnly: boolean;
    }
  >();
  constructor(private config: McpTransportConfiguration) {}
  get remoteProjectId() { return "url" in this.config ? this.config.projectId : null; }
  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  private async open() {
    if (LATEST_PROTOCOL_VERSION !== MCP_PROTOCOL)
      throw new AgentError("PROTOCOL_ERROR", "MCP SDK 协议版本与固定版本不同");
    let negotiated: unknown;
    const transport: Transport = "url" in this.config
      ? new StreamableHTTPClientTransport(new URL(this.config.url), {fetch:this.config.fetch}) as Transport
      : new StdioClientTransport(this.config);
    const receive = transport.start.bind(transport);
    transport.start = async () => {
      await receive();
      const handler = transport.onmessage;
      transport.onmessage = (message) => {
        if (
          "result" in message &&
          message.result &&
          typeof message.result === "object" &&
          "protocolVersion" in message.result
        )
          negotiated = message.result.protocolVersion;
        handler?.(message);
      };
    };
    const client = new Client(
      { name: "materialsx", version: "0.0.1" },
      { capabilities: {} },
    );
    try {
      await client.connect(transport);
      if (negotiated !== MCP_PROTOCOL)
        throw new AgentError(
          "PROTOCOL_ERROR",
          "MCP 服务协商了不支持的协议版本",
        );
      if (!client.getServerCapabilities()?.tools)
        throw new AgentError("UNAVAILABLE", "MCP 服务未提供工具能力");
      const page = await client.listTools();
      if (page.nextCursor)
        throw new AgentError("PROTOCOL_ERROR", "工具目录分页尚未完整加载");
      this.tools.clear();
      for (const tool of page.tools)
        this.tools.set(tool.name, {
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: tool.inputSchema,
          readOnly: tool.annotations?.readOnlyHint === true,
        });
      this.client = client;
      this.transport = transport;
      client.onclose = () => {
        this.client = null;
        this.tools.clear();
      };
    } catch (cause) {
      await client.close();
      throw cause;
    }
  }
  discover() {
    return [...this.tools.values()];
  }
  async call(
    name: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal; allowWrite?: boolean } = {},
  ) {
    await this.connect();
    const tool = this.tools.get(name);
    if (!tool)
      throw new AgentError("UNKNOWN_METHOD", `MCP 工具不存在：${name}`);
    if (!tool.readOnly && !options.allowWrite)
      throw new AgentError("PERMISSION_DENIED", "该 MCP 工具需要写入授权");
    return this.withSignal((signal) => this.client!.callTool({ name, arguments: args }, undefined, { signal, timeout: 30000 }), options.signal);
  }
  /** Resource reads stay on the negotiated MCP transport; never interpret URIs as local files or HTTP URLs. */
  async readResource(uri: string, options: { signal?: AbortSignal } = {}) {
    await this.connect();
    if (!this.client!.getServerCapabilities()?.resources)
      throw new AgentError("UNAVAILABLE", "MCP 服务未提供资源读取能力");
    return this.withSignal((signal) => this.client!.readResource({ uri }, { signal, timeout: 30000 }), options.signal);
  }
  private async withSignal<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      return await operation(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal);
    } finally {
      this.controllers.delete(controller);
    }
  }
  async reconnect() {
    await this.close();
    await this.connect();
  }
  async close() {
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
    await this.client?.close();
    await this.transport?.close();
    this.client = null;
    this.transport = null;
    this.tools.clear();
  }
}
