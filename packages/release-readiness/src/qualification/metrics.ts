import type { BenchmarkResult } from "../../../contracts/src/qualification.js";
import type { TaskExecution } from "../../../contracts/src/task-execution.js";
export function executionMetrics(
  state: TaskExecution | null,
  totalMs: number,
  firstOutputMs: number | null,
): BenchmarkResult["metrics"] {
  const requests = state?.requests ?? [];
  const count = (keys: string[]) => {
    if (!requests.length) return null;
    const values = requests.map((r) => {
      const usage = r.usage as Record<string, any> | null;
      if (!usage || typeof usage !== "object") return null;
      for (const key of keys) {
        const value = key.split(".").reduce((v, k) => v?.[k], usage as any);
        if (typeof value === "number" && Number.isFinite(value) && value >= 0)
          return value;
      }
      return null;
    });
    return values.every((v) => v !== null)
      ? values.reduce<number>((n, v) => n + v!, 0)
      : null;
  };
  return {
    totalMs,
    firstOutputMs,
    inputTokens: count(["input_tokens", "prompt_tokens", "input"]),
    cachedInputTokens: count([
      "input_tokens_details.cached_tokens",
      "prompt_tokens_details.cached_tokens",
      "cacheRead",
    ]),
    outputTokens: count(["output_tokens", "completion_tokens", "output"]),
    requests: requests.length,
    tools: state?.attempts.length ?? 0,
    recoveries: Math.max(
      0,
      requests.filter((r) => r.state === "failed" || r.state === "unknown")
        .length,
    ),
  };
}
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!;
}
export function summarizeResults(rows: BenchmarkResult[]) {
  return ["pi", "codex", "reference-codex"].map((subject) => {
    const selected = rows.filter((r) => r.subject === subject);
    const tokens = selected.map((r) =>
      r.metrics.inputTokens === null || r.metrics.outputTokens === null
        ? null
        : r.metrics.inputTokens + r.metrics.outputTokens,
    );
    return {
      subject,
      cases: selected.length,
      passed: selected.filter((r) => r.passed).length,
      completionRate: selected.length
        ? selected.filter((r) => r.passed).length / selected.length
        : null,
      p50TotalMs: percentile(
        selected.map((r) => r.metrics.totalMs),
        0.5,
      ),
      p95TotalMs: percentile(
        selected.map((r) => r.metrics.totalMs),
        0.95,
      ),
      p50FirstOutputMs: percentile(
        selected.flatMap((r) =>
          r.metrics.firstOutputMs === null ? [] : [r.metrics.firstOutputMs],
        ),
        0.5,
      ),
      totalTokens:
        tokens.length && tokens.every((v) => v !== null)
          ? tokens.reduce<number>((n, v) => n + v!, 0)
          : null,
      recoveryCount: selected.reduce((n, r) => n + r.metrics.recoveries, 0),
    };
  });
}
