import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { AgentError } from "../../contracts/src/agent.js";
import {recoveryError} from './recovery-failures.js';
export class LoopbackProxy {
  private server: Server | null = null;
  readonly token = randomBytes(32).toString("hex");
  url = "";
  lastError: AgentError | null = null;
  constructor(
    private invoke: (
      body: Record<string, any>,
      signal: AbortSignal,
    ) => Promise<Response>,
  ) {}
  async start() {
    const server = createServer(async (req, res) => {
      const auth = Buffer.from(req.headers.authorization ?? "");
      const wanted = Buffer.from(`Bearer ${this.token}`);
      if (
        req.url !== "/v1/responses" ||
        req.method !== "POST" ||
        auth.length !== wanted.length ||
        !timingSafeEqual(auth, wanted)
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 512 * 1024)
            throw new AgentError("PROTOCOL_ERROR", "Codex 请求超过输入上限");
          chunks.push(Buffer.from(chunk));
        }
        const response = await this.invoke(
          JSON.parse(Buffer.concat(chunks).toString()),
          controller.signal,
        );
        res.writeHead(response.status, { "Content-Type": "text/event-stream" });
        if (response.body)
          Readable.fromWeb(response.body as any)
            .on("error", (error) => {
              this.lastError = error instanceof AgentError ? error : recoveryError('PROTOCOL_ERROR','模型服务或网关响应中断；请核对原请求 / Model service or gateway stream interrupted; inspect the original request','transport','unknown');
              res.destroy();
            })
            .pipe(res);
        else res.end();
      } catch (error) {
        this.lastError = error instanceof AgentError ? error : recoveryError('PROTOCOL_ERROR','模型服务或网关传输失败；请核对原请求 / Model service or gateway transport failed; inspect the original request','transport','unknown');
        if (!res.headersSent) res.writeHead(502);
        res.end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("LOOPBACK_UNAVAILABLE");
    this.server = server;
    this.url = `http://127.0.0.1:${address.port}/v1`;
  }
  async close() {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = null;
  }
}
