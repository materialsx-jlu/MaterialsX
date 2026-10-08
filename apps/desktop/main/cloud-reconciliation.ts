import { AgentError } from '../../../packages/contracts/src/agent.js';
import type { TaskExecution } from '../../../packages/contracts/src/task-execution.js';
import type { PlatformRunSnapshot, PiPlatformSessionService } from '../../../packages/pi-adapter/src/platform-session.js';
import { needsReconciliation } from './agent-recovery.js';
import type { WorkspaceStore } from './store.js';

/** Read the exact original cloud task, never assume the latest task owns older requests. */
export async function originalCloudSnapshot(store: WorkspaceStore, platform: PiPlatformSessionService,
  state: TaskExecution, accountId?: string): Promise<PlatformRunSnapshot> {
  if (state.accountRef === 'local' || state.accountRef !== accountId)
    throw new AgentError('PERMISSION_DENIED', '请登录原平台账户后核对');
  for (const id of store.cloudTaskIds(accountId, state.task.conversationId)) {
    const actual = await platform.readSnapshot(id);
    if (actual.task.id !== id) throw new AgentError('CONFLICT', '云端任务身份不一致');
    if (actual.task.clientTaskId === state.task.taskId) return actual;
  }
  throw new AgentError('RECONCILIATION_REQUIRED', '原 M5 任务引用缺失，不新建付费任务');
}

/** Absence proves non-dispatch only on a closed, exactly bound task with a complete empty ledger. */
export function cloudRequestReconciliation(state: TaskExecution, actual: PlatformRunSnapshot) {
  if (actual.task.clientTaskId !== state.task.taskId ||
      actual.requests.some(r => r.taskId !== actual.task.id) ||
      new Set(actual.requests.map(r => r.id)).size !== actual.requests.length)
    throw new AgentError('CONFLICT', 'M5 回执属于另一轮任务');
  const closed = ['completed', 'failed', 'cancelled', 'interrupted'].includes(actual.task.state);
  const emptyClosedTask = closed && actual.task.requestCount === 0 && actual.requests.length === 0;
  const records = emptyClosedTask
    ? state.requests.filter(r => ['running', 'unknown', 'failed'].includes(r.state) && r.reconciledAt === undefined)
      .map(r => ({ id: r.id, state: 'failed' as const, usage: null }))
    : actual.requests.filter(r => ['settled', 'released', 'not_billed'].includes(r.settlement) &&
      (r.terminalReceived || !r.dispatched) && ['completed', 'failed', 'cancelled'].includes(r.execution))
      .map(r => ({ id: r.id, state: r.execution === 'completed' ? 'completed' as const : 'failed' as const, usage: r.usage }));
  return { records, detail: emptyClosedTask
    ? `M5 task ${actual.task.id} is ${actual.task.state}; requestCount=0 and request ledger empty. No provider dispatch or replay.`
    : `Actual M5 receipts for task ${actual.task.id}; no provider invocation.` };
}

/** Preflight uses the same receipt reconciliation as the manual action, with no generation. */
export async function reconcilePendingConversation(store: WorkspaceStore, conversationId: string,
  accountId: string | undefined, reconcile: (id: string, accountId: string) => Promise<unknown>) {
  for (const state of store.agentJournal.forConversation(conversationId).filter(needsReconciliation))
    if (accountId && state.accountRef === accountId) await reconcile(state.task.taskId, accountId);
  return store.agentJournal.forConversation(conversationId).some(needsReconciliation);
}
