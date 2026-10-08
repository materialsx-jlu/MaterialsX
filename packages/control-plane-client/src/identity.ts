import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";
import { accountSchema, deviceSchema, authStartResultSchema, authTokensSchema } from "../../contracts/src/platform.js";

import type { AccountSnapshot } from "../../contracts/src/desktop.js";
export type { AccountSnapshot } from "../../contracts/src/desktop.js";
export interface CredentialVault { available(): boolean; read(): Promise<{ origin: string; refreshToken: string } | null>;
  write(value: { origin: string; refreshToken: string }): Promise<void>; clear(): Promise<void> }
const secret = () => randomBytes(32).toString("base64url");
/** Only these controlled messages may cross the desktop login IPC boundary. */
export class IdentityLoginError extends Error {}
function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export function identityOrigin(value: string, development: boolean): string {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw new Error("身份服务地址无效");
  if (u.protocol !== "https:" && !(development && u.protocol === "http:" && u.hostname === "127.0.0.1")) throw new Error("身份服务需要 HTTPS；本地开发仅允许 127.0.0.1");
  return u.origin;
}
/** Main-process client only. No method returns access/refresh tokens to the renderer. */
export class IdentityClient {
  private tokens: z.infer<typeof authTokensSchema> | null = null;
  private expiresAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private cancelPending: (() => void) | null = null;
  readonly origin: string | null;
  constructor(origin: string | null, private vault: CredentialVault,
    private openBrowser: (url: string) => Promise<unknown>, development = false, private transport: typeof fetch = fetch) {
    this.origin = origin ? identityOrigin(origin, development) : null;
  }
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn); this.queue = result.catch(() => undefined); return result;
  }
  private async request(path: string, body?: unknown, token?: string): Promise<Response> {
    if (!this.origin) throw new Error("平台账户服务尚未配置");
    return this.transport(`${this.origin}${path}`, { method: body === undefined ? "GET" : "POST", redirect: "error",
      signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  private async save(tokens: z.infer<typeof authTokensSchema>) {
    await this.vault.write({ origin: this.origin!, refreshToken: tokens.refreshToken });
    this.tokens = tokens; this.expiresAt = Date.now() + tokens.expiresIn * 1000;
  }
  private async refresh() {
    const old = await this.vault.read();
    if (!old || old.origin !== this.origin) { this.tokens = null; await this.vault.clear(); throw new Error("请重新登录平台账户"); }
    try {
      const response = await this.request("/v1/auth/refresh", { refreshToken: old.refreshToken });
      if (!response.ok) throw new Error("refresh rejected");
      await this.save(authTokensSchema.parse(await response.json()));
    } catch { this.tokens = null; await this.vault.clear(); throw new Error("登录已失效或刷新结果未确认，请重新登录"); }
  }
  private async authenticated(path: string, body?: unknown) {
    if (!this.tokens || this.expiresAt < Date.now() + 60000) await this.refresh();
    let response = await this.request(path, body, this.tokens!.accessToken);
    if (response.status === 401) { await this.refresh(); response = await this.request(path, body, this.tokens!.accessToken); }
    if (!response.ok) throw new Error(response.status === 404 ? "设备不存在或不属于当前账户" : "平台账户请求被拒绝");
    return response;
  }
  private async snapshotUnlocked(): Promise<AccountSnapshot> {
    const base = { secureStorage: this.vault.available(), user: null, devices: [], nextCursor: null };
    if (!this.origin) return { ...base, status: "unconfigured" };
    if (!this.vault.available()) return { ...base, status: "unavailable", error: "系统安全存储不可用，平台登录未启用" };
    try {
      if (!this.tokens && !(await this.vault.read())) return { ...base, status: "signed_out" };
      const user = accountSchema.parse(await (await this.authenticated("/v1/me")).json());
      const page = z.object({ items: z.array(deviceSchema), nextCursor: z.string().nullable() }).parse(await (await this.authenticated("/v1/devices")).json());
      return { ...base, status: "connected", user, devices: page.items, nextCursor: page.nextCursor };
    } catch { return { ...base, status: "unavailable", error: "平台账户不可用；可以继续使用本地功能或重新登录" }; }
  }
  snapshot() { return this.serialized(() => this.snapshotUnlocked()); }
  devices(cursor: string) { return this.serialized(async () => {
    if (cursor.length > 512) throw new Error("设备分页参数无效");
    return z.object({items:z.array(deviceSchema),nextCursor:z.string().nullable()}).parse(await (await this.authenticated(`/v1/devices?cursor=${encodeURIComponent(cursor)}`)).json());
  }); }
  /** Main-process authenticated transport. No redirects or generation replay. */
  async platformRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const legacy=/^\/v1\/(support\/(?:tickets(?:\?cursor=[A-Za-z0-9_.:-]{1,128})?|tickets\/[A-Za-z0-9_.:-]{1,128}\/(?:reply|attachments)|attachments\/[A-Za-z0-9_.:-]{1,128})|billing\/(?:activity|tasks(?:\/export)?(?:\?cursor=[A-Za-z0-9_.:-]{1,128})?|wallet|ledger(?:\?cursor=[0-9]{1,19})?|plans|subscriptions|(?:orders|export)(?:\?cursor=[A-Za-z0-9_.:-]{1,128})?|orders\/[A-Za-z0-9_.:-]{1,128}(?:\/(?:query|close|refunds))?)|workspace\/status|releases|providers|models|tasks(?:\/[A-Za-z0-9_.:-]+(?:\/(?:finish|cancel|requests))?)?|model-requests\/[A-Za-z0-9_.:-]+(?:\/cancel)?|model-gateway\/responses)$/;
    const mxRead=/^\/v1\/mx-points\/(?:products|prices|wallet|usage|orders(?:\/[A-Za-z0-9_.:-]{1,128}(?:\/refunds)?)?|refunds\/[A-Za-z0-9_.:-]{1,128})$/;
    const mxWrite=/^\/v1\/mx-points\/orders(?:\/[A-Za-z0-9_.:-]{1,128}\/(?:refunds|cancel))?$/;
    const method=init.method??'GET';
    if (!legacy.test(path)&&!((method==='GET'&&mxRead.test(path))||(method==='POST'&&mxWrite.test(path)))) throw new Error("平台请求路径无效");
    return this.serialized(async () => {
      if (!this.origin || !this.vault.available()) throw new Error("平台账户服务不可用");
      if (!this.tokens || this.expiresAt < Date.now() + 60000) await this.refresh();
      const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${this.tokens!.accessToken}`);
      headers.set("Content-Type", "application/json");
      return this.transport(`${this.origin}${path}`, { ...init, headers, redirect: "error",
        signal: init.signal ?? AbortSignal.timeout(15000) });
    });
  }
  /** Dedicated same-origin team transport. A third-party MCP URL never receives M5 credentials. */
  researchRequest(path: string, init: RequestInit = {}): Promise<Response> {
    if (!/^\/v1\/research\/(?:projects|projects\/[a-f0-9-]{36}(?:\/(?:mcp|manifest|members\/[A-Za-z0-9_.:-]{1,128}|corrections(?:\/[a-f0-9-]{36}\/(?:review|export|confirm))?))?)$/.test(path)) throw new Error("研究服务路径无效");
    if (!["GET", "POST", "DELETE"].includes(init.method ?? "GET")) throw new Error("研究请求方法无效");
    return this.serialized(async () => {
      if (!this.origin || !this.vault.available()) throw new Error("请先登录平台账户");
      if (!this.tokens || this.expiresAt < Date.now() + 60000) await this.refresh();
      const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${this.tokens!.accessToken}`);
      headers.delete("X-User-ID"); headers.delete("X-Reviewer-ID"); headers.delete("X-Research-Role");
      return this.transport(this.origin + path, { ...init, headers, redirect: "error", credentials: "omit",
        signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    });
  }
  cancelLogin() { this.cancelPending?.(); }
  login(): Promise<AccountSnapshot> { return this.serialized(async () => {
    if (!this.origin || !this.vault.available()) throw new IdentityLoginError("平台账户服务或系统安全存储不可用");
    const verifier = secret(), challenge = createHash("sha256").update(verifier).digest("base64url");
    let expected: z.infer<typeof authStartResultSchema> | null = null;
    let finish!: (value: { flowId: string; code: string }) => void;
    let reject!: (error: Error) => void;
    const callback = new Promise<{ flowId: string; code: string }>((resolve, fail) => { finish = resolve; reject = fail; });
    // Register a rejection handler before opening the browser or contacting API.
    void callback.catch(() => undefined);
    let accepted = false;
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
      const address = server.address();
      if (!address || typeof address === "string" || req.method !== "GET" || req.headers.host !== `127.0.0.1:${address.port}`) { res.writeHead(400).end("无效登录回调"); return; }
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${address.port}`);
      if (accepted || u.pathname !== "/auth/callback" || !expected ||
          u.searchParams.getAll("state").length !== 1 || !equal(u.searchParams.get("state") ?? "", expected.state) ||
          u.searchParams.getAll("flowId").length !== 1 || !equal(u.searchParams.get("flowId") ?? "", expected.flowId) ||
          u.searchParams.getAll("code").length !== 1 || !u.searchParams.get("code") || u.searchParams.get("code")!.length > 512) {
        res.writeHead(400).end("登录校验失败，请返回 MaterialsX 重试"); return;
      }
      accepted = true; res.end("登录授权已接收，请返回 MaterialsX。");
      finish({ flowId: expected.flowId, code: u.searchParams.get("code")! });
    });
    const timer = setTimeout(() => reject(new IdentityLoginError("浏览器登录已超时，请重新登录")), 5 * 60 * 1000); timer.unref();
    this.cancelPending = () => reject(new IdentityLoginError("已取消登录"));
    let failureMessage = "本机登录回调无法启动，请重试";
    try {
      await new Promise<void>((resolve, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", () => resolve()); });
      const address = server.address(); if (!address || typeof address === "string") throw new Error("登录回调无法启动");
      failureMessage = `无法连接平台账户服务（${this.origin}）。${this.origin.startsWith("http://127.0.0.1:") ? "请先配置并启动本地身份服务，再重试登录。桌面启动命令不会启动身份服务。" : "请检查网络和身份服务状态，再重试登录。"}`;
      const response = await this.request("/v1/auth/desktop/start", { deviceName: "MaterialsX Desktop",
        codeChallenge: challenge, codeChallengeMethod: "S256", redirectUri: `http://127.0.0.1:${address.port}/auth/callback` });
      if (!response.ok) throw new IdentityLoginError(`平台登录服务暂时不可用（HTTP ${response.status}），请稍后重试或联系管理员`);
      failureMessage = "平台登录服务响应格式无效，请联系管理员检查服务版本";
      expected = authStartResultSchema.parse(await response.json());
      const authorization = new URL(expected.authorizationUrl);
      if (authorization.origin !== this.origin || authorization.pathname !== `/auth/desktop/${expected.flowId}` || authorization.search || authorization.hash) throw new IdentityLoginError("平台授权页面校验失败");
      failureMessage = "系统浏览器无法打开，请检查默认浏览器后重新登录";
      await this.openBrowser(authorization.href);
      const received = await callback;
      failureMessage = "登录授权兑换未完成，请检查身份服务连接后重新登录";
      const exchanged = await this.request("/v1/auth/desktop/exchange", {
        flowId: received.flowId, authorizationCode: received.code, codeVerifier: verifier,
      });
      if (!exchanged.ok) throw new IdentityLoginError("登录授权已失效，请重试");
      failureMessage = "登录结果无法安全保存，请检查系统安全存储后重新登录";
      await this.save(authTokensSchema.parse(await exchanged.json()));
      return this.snapshotUnlocked();
    } catch (error) { throw error instanceof IdentityLoginError ? error : new IdentityLoginError(failureMessage); }
    finally { clearTimeout(timer); this.cancelPending = null; server.closeAllConnections(); server.close(); }
  }); }
  logout() { return this.serialized(async () => {
    try { if (this.tokens || await this.vault.read()) await this.authenticated("/v1/auth/logout", {}); }
    catch { throw new Error("服务端退出未确认；请恢复网络后重试或从另一设备撤销此设备"); }
    this.tokens = null; await this.vault.clear(); return this.snapshotUnlocked();
  }); }
  revoke(deviceId: string) { return this.serialized(async () => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(deviceId)) throw new Error("设备编号无效");
    await this.authenticated(`/v1/devices/${encodeURIComponent(deviceId)}/revoke`, {});
    if (this.tokens?.deviceId === deviceId) { this.tokens = null; await this.vault.clear(); }
    return this.snapshotUnlocked();
  }); }
}
