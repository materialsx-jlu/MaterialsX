/** Optional observation only. It cannot alter task execution or replace journal state. */
export interface AgentTimingEvent {
  phase: "interpretation" | "recovery" | "acceptance";
  edge: "start" | "end"; at: number;
}
export type TimingObserver = (event: AgentTimingEvent) => void;
export function startStage(phase: AgentTimingEvent["phase"], observe?: TimingObserver) {
  const emit = (edge: AgentTimingEvent["edge"]) => {
    try { observe?.({ phase, edge, at: Date.now() }); }
    catch { /* A diagnostic consumer cannot fail or repeat an operation. */ }
  };
  emit("start");
  let ended = false;
  return () => { if (!ended) { ended = true; emit("end"); } };
}
export async function timedStage<T>(phase: AgentTimingEvent["phase"], work: () => Promise<T>, observe?: TimingObserver) {
  if (!observe) return work();
  const stop = startStage(phase, observe);
  try { return await work(); } finally { stop(); }
}
