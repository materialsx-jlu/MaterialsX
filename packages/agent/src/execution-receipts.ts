/** Only called on actual engine/host tool output, never on a model's completion claim. */
export function observedJobs(result: unknown): Array<{ id: string; state: string }> {
  const jobs = new Map<string,string>();
  const walk = (value: any, depth = 0) => {
    if (!value || depth > 8) return;
    if (typeof value === "string") { try { walk(JSON.parse(value),depth+1); } catch { /* Plain tool text has no typed job proof. */ } return; }
    if (Array.isArray(value)) { value.slice(0,128).forEach(v=>walk(v,depth+1));return; }
    if (typeof value !== "object") return;
    if (typeof value.runId === "string" && typeof (value.status ?? value.state) === "string") jobs.set(value.runId,value.status??value.state);
    if (value.job && typeof value.job.id === "string" && typeof value.job.status === "string") jobs.set(value.job.id,value.job.status);
    if (typeof value.workflowId === "string" && typeof value.state === "string") jobs.set(value.workflowId,value.state);
    for (const v of Object.values(value)) walk(v,depth+1);
  };
  walk(result); return [...jobs].slice(0,32).map(([id,state])=>({id,state}));
}

/** Pi defaults absent usage to zero. Keep absent/empty accounting unknown, never invent a bill. */
export function reportedPiUsage(value: any): unknown { return value && Number(value.totalTokens)>0 ? value : null; }
