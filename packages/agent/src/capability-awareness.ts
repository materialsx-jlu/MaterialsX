import { capabilityFactSchema, type CapabilityFact, type CapabilitySnapshot, type KnowledgeFact } from '../../contracts/src/capability-awareness.js';
import type { Permission } from '../../contracts/src/agent.js';
import type { ResearchGoalPlan } from '../../contracts/src/research-goal.js';
import { canonical, digest } from './execution-context.js';
import {rankDocuments} from '../../search/src/lexical.js';
import {toolMetadata} from './tool-discovery-metadata.js';
import { supportsPlannedMethod } from './research-tools.js';
import type { ToolAttempt } from '../../contracts/src/task-execution.js';

export function toolCapabilityFacts(methods: ReadonlyMap<string, readonly Permission[]>, grant: readonly Permission[], plan: ResearchGoalPlan | null, activeStepId: string | null, attempts: readonly ToolAttempt[] = []): CapabilityFact[] {
  return [...methods].filter(([name]) => name !== 'engine.execute').map(([name, permissions]) => {
    const steps = activeStepId ? plan?.steps.filter(s => s.id === activeStepId) : plan?.steps;
    const allowed = permissions.every(p => grant.includes(p) && (!plan || plan.constraints.permissions.includes(p))) &&
      (!plan || ['task_control','find_tools','invoke_material_tool'].includes(name) || !!steps?.some(s => supportsPlannedMethod(s.method, name) && permissions.every(p => s.permissions.includes(p))));
    const last=attempts.filter(a=>a.method===name&&a.planRevision===plan?.planRevision&&['completed','failed'].includes(a.state)).at(-1);
    const failed=last?.state==='failed'||last?.jobs.some(j=>j.state==='failed');
    return { id: 'tool:' + name, label: { zh: name, en: name }, kind: 'tool', registered: true, configured: last?.state==='completed'?true:null, installed: null,
      authorization: allowed ? 'allowed' : 'denied', readiness: last?(failed?'blocked':'verified'):'unverified', evidence: ['host-tool-registration','host-task-grant',...(last?[last.id]:[])],
      detail: last?`Last current-task invocation ${last.id}: ${failed?'failed':'succeeded'}. Scope is this invocation; other inputs, backend health and scientific correctness remain separate.`:'Registered adapter and current permission scope only; backend configuration/health and task applicability require actual checks.' };
  });
}
export function capabilitySnapshot(previous: CapabilitySnapshot | null, facts: CapabilityFact[]): CapabilitySnapshot {
  const checked = facts.map(f => capabilityFactSchema.parse(f)).sort((a,b) => a.id.localeCompare(b.id));
  if (checked.length > 512 || new Set(checked.map(f => f.id)).size !== checked.length) throw Error('INVALID_CAPABILITY_REGISTRY');
  const hash = digest(canonical(checked));
  if (previous?.digest === hash) return previous;
  return { schemaVersion: 'capabilities-v1', revision: (previous?.revision ?? 0) + 1, digest: hash, facts: checked };
}
/** Full facts stay in the journal. A bounded relevant projection protects local-model input budgets. */
export function capabilityContext(snapshot: CapabilitySnapshot | null, request: string, query?: string) {
  if (!snapshot) return null;
  const matches=rankDocuments(snapshot.facts,query??request,f=>({id:f.id,names:[f.id.replace(/^[^:]+:/,''),f.label.zh,f.label.en],
    text:[f.detail,toolMetadata(f.id.slice(5))?.aliases??'']})).map(r=>r.value);
  if(query===undefined){const install=snapshot.facts.find(f=>f.id==='host:skill.install');if(install){const at=matches.indexOf(install);if(at>=0)matches.splice(at,1);matches.unshift(install);}}
  const facts = matches.slice(0,query===undefined?6:16).map(f=>query===undefined?{id:f.id,kind:f.kind,registered:f.registered,configured:f.configured,installed:f.installed,authorization:f.authorization,readiness:f.readiness}:f);
  return { schemaVersion:snapshot.schemaVersion,revision:snapshot.revision,digest:snapshot.digest,partial:true,totalFacts:snapshot.facts.length,
    facts,matchedFacts:matches.length,toolAuthorization:query===undefined?[]:facts.filter(f=>f.kind==='tool').map(f=>[f.id.slice(5),f.authorization]),
    hint:'Partial view, not absence. Query task_control capabilities by exact name for current facts.' };
}
export function capabilityKnowledge(snapshot: CapabilitySnapshot): Array<Pick<KnowledgeFact,'key'|'value'|'source'|'sourceHash'>> {
  return snapshot.facts.map(f => ({
    key: `capability:${f.id}`, value: JSON.stringify({ registered:f.registered,configured:f.configured,installed:f.installed,authorization:f.authorization,readiness:f.readiness }),
    source: `capabilities:${snapshot.revision}`, sourceHash: snapshot.digest,
  })).filter(f => !f.key.startsWith('capability:tool:')); // Tool permissions already live in the current snapshot; keep persistent facts bounded.
}
/** Extract only fixed typed host fields. Free-form error text, papers and model replies cannot mutate capability facts. */
export function receiptKnowledge(method: string, receiptId: string, result: unknown, sourceHash: string): Array<Pick<KnowledgeFact,'key'|'value'|'source'|'sourceHash'>> {
  const unwrap = (value: any): any => {
    if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
    if (value?.content?.[0]?.type === 'text') return unwrap(value.content[0].text);
    return value;
  };
  const r = unwrap(result), facts: Array<{key:string;value:string|boolean}> = [];
  if (['environment_check','environment_repair'].includes(method) && ['ready','unavailable','damaged','busy'].includes(r?.status))
    facts.push({ key:'environment:managed-python:status', value:r.status });
  if (method === 'skill_capabilities' && r?.schemaVersion === 'skill-capabilities-v1' && Array.isArray(r.installed))
    for (const s of r.installed.slice(0,128)) if (/^[a-z0-9][a-z0-9-]{0,127}$/.test(s.name) && typeof s.enabled === 'boolean')
      facts.push({ key:`skill:${s.name}:enabled`,value:s.enabled });
  return facts.map(f => ({ ...f, source: receiptId, sourceHash }));
}
