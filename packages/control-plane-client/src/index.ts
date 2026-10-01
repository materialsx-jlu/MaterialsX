import type {
  CreditLedgerEntry,
  SubscriptionOverview,
  SubscriptionPlan,
  SubscriptionSnapshot,
} from "../../contracts/src/desktop.js";

const CONTROL_PLANE = "http://127.0.0.1:8787";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CONTROL_PLANE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(3_000),
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `控制面返回 HTTP ${response.status}`);
  return body;
}

export class ControlPlaneClient {
  async health(): Promise<boolean> {
    try {
      await request<{ status: string }>("/health");
      return true;
    } catch {
      return false;
    }
  }

  async snapshot(accountId: string): Promise<SubscriptionSnapshot> {
    try {
      const [plans, overview, ledger] = await Promise.all([
        request<SubscriptionPlan[]>("/v1/plans"),
        request<SubscriptionOverview>(`/v1/entitlements/${encodeURIComponent(accountId)}`),
        request<CreditLedgerEntry[]>(`/v1/ledger/${encodeURIComponent(accountId)}`),
      ]);
      return { serviceStatus: "online", accountId, plans, overview, ledger };
    } catch (cause) {
      return {
        serviceStatus: "offline",
        accountId,
        plans: [],
        overview: null,
        ledger: [],
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  async activateDevelopmentPlan(accountId: string, planId: "pro" | "research", eventId: string): Promise<SubscriptionSnapshot> {
    await request<SubscriptionOverview>("/v1/dev/subscriptions", {
      method: "POST",
      body: JSON.stringify({ accountId, planId, eventId }),
    });
    return this.snapshot(accountId);
  }
}
