import { atomisticOutputs, atomisticOutputMethods } from '../../contracts/src/science-output.js';
import type { PlanContext } from '../../contracts/src/research-goal.js';

function mentions(text: string, aliases: readonly string[]) {
  return aliases.some(alias => /^[a-z]/i.test(alias)
    ? new RegExp('(?<![a-z])' + alias + '(?![a-z])', 'i').test(text)
    : text.includes(alias));
}
/** A host-declared result unit does not authorize a tool or supply a numeric threshold. */
export function requestedOutputQuantities(context: PlanContext, request: string) {
  const available = atomisticOutputMethods.some(name => {
    const permissions = context.methods.get(name);
    return permissions?.includes('science') && permissions.every(p => context.grant.permissions.includes(p));
  });
  return available ? atomisticOutputs.filter(q => mentions(request, q.aliases)) : [];
}
export function nativeOutputUnit(context: PlanContext, request: string, metric: { name: string; value: number | null; unit: string | null }) {
  return metric.value === null && requestedOutputQuantities(context, request).some(q =>
    mentions(metric.name, q.aliases) && (q.units as readonly string[]).includes(metric.unit ?? ''));
}
