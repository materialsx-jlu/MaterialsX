import { accountSchema } from "../../../contracts/src/platform.js";
export type TeamActor = {
  id: string;
  deviceId: string;
  mfaVerified: boolean;
};
export type TeamIdentity = {
  verify(header: string, signal: AbortSignal): Promise<TeamActor>;
};
/** Validate each request with the original M5 identity service; no passwords, issuer, sessions or account database here. */
export class M5TeamIdentity implements TeamIdentity {
  constructor(
    private origin: string,
    private production: boolean,
    private request: typeof fetch = fetch,
  ) {
    const u = new URL(origin);
    if (
      u.href !== u.origin + "/" ||
      u.username ||
      u.password ||
      (u.protocol !== "https:" &&
        !(
          production === false &&
          u.protocol === "http:" &&
          u.hostname === "127.0.0.1"
        ))
    )
      throw Error("TEAM_IDENTITY_ORIGIN_INVALID");
  }
  async verify(header: string, signal: AbortSignal) {
    if (!/^Bearer [A-Za-z0-9_.~-]{16,4096}$/.test(header))
      throw Error("TEAM_UNAUTHORIZED");
    const health = await this.request(this.origin + "/health", {
      redirect: "error",
      signal,
    });
    if (!health.ok || (await health.json()).production !== this.production)
      throw Error("TEAM_IDENTITY_MODE_MISMATCH");
    const r = await this.request(this.origin + "/v1/me", {
      headers: { Authorization: header },
      redirect: "error",
      signal,
    });
    if (!r.ok) throw Error("TEAM_UNAUTHORIZED");
    const a = accountSchema.parse(await r.json());
    if (a.status !== "active") throw Error("TEAM_UNAUTHORIZED");
    return { id: a.id, deviceId: a.deviceId, mfaVerified: a.mfaVerified };
  }
}
