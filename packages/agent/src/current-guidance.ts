import { MATERIALS_RESEARCH_INSTRUCTIONS } from './research-instructions.js';

const marker = 'MaterialsX current application guidance:\n';
/** Resumed native threads may retain their original base instructions. Refresh at the model boundary.
 * Keep native instructions, history and grants intact; never rewrite old messages or tool receipts.
 */
export function withCurrentGuidance<T extends { input: any[] | string }>(payload: T): T {
  if (!Array.isArray(payload.input)) throw Error('MaterialsX native guidance requires message input');
  const input = payload.input.filter(item => !(item.role === 'developer' && typeof item.content === 'string' && item.content.startsWith(marker)));
  const hasCurrent = input.some(item => ['system', 'developer'].includes(item.role) &&
    (typeof item.content === 'string' ? item.content : (item.content ?? []).map((part: any) => part.text ?? '').join('\n')).includes(MATERIALS_RESEARCH_INSTRUCTIONS));
  if (!hasCurrent) input.push({ type: 'message', role: 'developer', content: marker + MATERIALS_RESEARCH_INSTRUCTIONS });
  return { ...payload, input };
}
