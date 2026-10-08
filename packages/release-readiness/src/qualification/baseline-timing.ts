import type { TaskExecution, ExecutionEvent } from "../../../contracts/src/task-execution.js";
import { executionMetrics } from "./metrics.js";
import type { AgentTimingEvent } from "../../../agent/src/agent-timing.js";
type Interval = [number, number];
function union(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [a, b] of intervals.sort((x, y) => x[0] - y[0])) {
    const last = result.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(b, last[1]);
    else result.push([a, b]);
  }
  return result;
}
const sum = (intervals: Interval[]) => union(intervals).reduce((n, [a, b]) => n + b - a, 0);
/** Account measured intervals once. The residual is NOT pure host overhead or supplier latency. */
export function baselineTiming(state: TaskExecution | null, events: ExecutionEvent[], startedAt: number,
  endedAt: number, firstFeedbackAt: number | null, stages?: AgentTimingEvent[]) {
  if (endedAt < startedAt) throw Error("BASELINE_CLOCK_INVALID");
  const rows = state?.requests ?? [], attempts = state?.attempts ?? [];
  const interval = (a: number, b: number | null): Interval =>
    [Math.max(startedAt, Math.min(endedAt, a)), Math.max(startedAt, Math.min(endedAt, b ?? endedAt))];
  const requestIntervals = rows.map(r => interval(r.startedAt, r.endedAt));
  const toolIntervals = attempts.map(r => interval(r.startedAt, r.endedAt));
  const phases = (phase: string) => sum(rows.filter(r => r.phase === phase).map(r => interval(r.startedAt, r.endedAt)));
  const first = rows.flatMap(r => r.firstTokenAt === null ? [] : [r.firstTokenAt]).sort((a, b) => a - b)[0];
  const terminal = events.filter(e => e.type === "terminal").at(-1)?.at;
  const lastActivity = Math.max(startedAt, ...rows.flatMap(r => r.endedAt === null ? [] : [r.endedAt]),
    ...attempts.flatMap(r => r.endedAt === null ? [] : [r.endedAt]));
  return {
    ...executionMetrics(state, endedAt - startedAt, first === undefined ? null : Math.max(0, first - startedAt)),
    firstFeedbackMs: firstFeedbackAt === null ? null : Math.max(0, firstFeedbackAt - startedAt),
    firstProviderDeltaMs: first === undefined ? null : Math.max(0, first - startedAt),
    interpretationRequestMs: phases("interpret"), executionRequestMs: phases("execute"), compactionRequestMs: phases("compact"),
    requestUnionMs: sum(requestIntervals), toolUnionMs: sum(toolIntervals),
    unclassifiedMs: endedAt - startedAt - sum([...requestIntervals, ...toolIntervals]),
    tailAfterLastActivityMs: Math.max(0, (terminal ?? endedAt) - lastActivity),
    unresolvedRequests: rows.filter(r => r.endedAt === null || r.state === "unknown").length,
    unresolvedTools: attempts.filter(r => r.endedAt === null || r.state === "unknown").length,
    stages: stages ? ["interpretation", "recovery", "acceptance"].map(phase => {
      const measured: Interval[] = []; let start: number | null = null, incomplete = 0;
      for (const e of stages.filter(e => e.phase === phase)) {
        if (e.edge === "start") { if (start !== null) incomplete++; start = e.at; }
        else if (start !== null) { measured.push(interval(start, e.at)); start = null; }
        else incomplete++;
      }
      return { phase, measuredMs: sum(measured), spans: measured.length, incomplete: incomplete + Number(start !== null) };
    }) : null,
    intervals: {
      requests: rows.map(r => ({ id: r.id, phase: r.phase, startMs: r.startedAt - startedAt,
        endMs: r.endedAt === null ? null : r.endedAt - startedAt, state: r.state })),
      tools: attempts.map(r => ({ id: r.id, method: r.method, startMs: r.startedAt - startedAt,
        endMs: r.endedAt === null ? null : r.endedAt - startedAt, state: r.state })),
    },
    interpretation: "Provider delta includes tool arguments. Request time includes gateway/network/model, not supplier-only time. " +
      "Tail includes delivery/acceptance; residual includes setup, coordination and uninstrumented work. " +
      "Observed recovery means a host correction turn, not ordinary script repair inside the native loop; stage spans may overlap requests/tools.",
  };
}
