import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { AgentError } from "../../contracts/src/agent.js";

type Pending = {
  resolve(value: any): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};
export interface RpcNotification {
  method: string;
  params: any;
}
/** Public Codex app-server v2. stdout is protocol; stderr is never exposed as a public log. */
export class CodexRpc {
  private child: ChildProcessWithoutNullStreams;
  private lines: Interface;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private listeners = new Set<(event: RpcNotification) => void>();
  private stopped = false;
  constructor(
    binary: string,
    home: string,
    cwd: string,
    sandbox?: { command: string; args: string[]; temporary: string },
    diagnostic?: (event: unknown) => void,
    runtimePath = "/usr/bin:/bin:/usr/sbin:/sbin",
    languageEnv: Record<string,string> = {},
  ) {
    this.child = spawn(
      sandbox?.command ?? binary,
      sandbox?.args ?? ["app-server", "--stdio"],
      {
        cwd,
        env: {
          ...Object.fromEntries(Object.entries(languageEnv).filter(([key])=>["MATERIALSX_PYTHON","PYTHONNOUSERSITE","PYTHONDONTWRITEBYTECODE"].includes(key))),
          PATH: runtimePath,
          CODEX_HOME: home,
          LANG: "en_US.UTF-8",
          NO_PROXY: "127.0.0.1,localhost,::1",
          no_proxy: "127.0.0.1,localhost,::1",
          ...(sandbox ? { TMPDIR: sandbox.temporary, TMPPREFIX: sandbox.temporary+"/zsh" } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.stderr.on("data", (chunk: Buffer) =>
      diagnostic?.({
        method: "runtime/stderr",
        params: { message: chunk.toString().slice(0, 1500) },
      }),
    );
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        this.fail(new AgentError("PROTOCOL_ERROR", "Codex 返回了非协议内容"));
        return;
      }
      if (message.method && message.id !== undefined) {
        // Model/child cannot extend the host grant through an approval request.
        this.child.stdin.write(
          JSON.stringify({
            id: message.id,
            error: { code: -32601, message: "HOST_PERMISSION_REQUIRED" },
          }) + "\n",
        );
      } else if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            new AgentError(
              "PROTOCOL_ERROR",
              String(message.error.message ?? "Codex 请求失败"),
            ),
          );
        else pending.resolve(message.result);
      } else if (message.method)
        for (const listener of this.listeners) listener(message);
    });
    this.child.on("error", () =>
      this.fail(new AgentError("UNAVAILABLE", "Codex 运行程序不可用")),
    );
    this.child.on("exit", (code, signal) => {
      diagnostic?.({ method: "runtime/exit", params: { code, signal } });
      this.stopped = true;
      this.fail(new AgentError("UNAVAILABLE", "Codex 进程已退出"));
    });
  }
  private fail(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    for (const listener of this.listeners)
      listener({ method: "runtime/failure", params: { code: error instanceof AgentError ? error.code : "UNAVAILABLE", message: error.message } });
  }
  subscribe(listener: (event: RpcNotification) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  request(method: string, params: unknown, timeoutMs = 30000): Promise<any> {
    if (this.stopped)
      return Promise.reject(new AgentError("UNAVAILABLE", "Codex 进程已关闭"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AgentError("PROTOCOL_ERROR", `Codex 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async initialize() {
    const result = await this.request("initialize", {
      clientInfo: { name: "materialsx", title: "MaterialsX", version: "0.0.1" },
      capabilities: { experimentalApi: true },
    });
    this.child.stdin.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
    return result;
  }
  async close() {
    if (this.stopped) return;
    this.lines.close();
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        done();
      }, 2000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
    this.listeners.clear();
  }
}
