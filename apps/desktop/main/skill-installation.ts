import { ipcMain } from 'electron';
import { z } from 'zod';
import type { WorkspaceStore } from './store.js';
import type { SendMessageInput, MessageStreamEvent } from '../../../packages/contracts/src/desktop.js';
import type { SkillInstallationService } from '../../../packages/skills/src/installation-service.js';
import { parseSkillInstallCommand, executeSkillInstallCommand } from './skill-install-command.js';
import { TextStreamBuffer } from '../../../packages/pi-adapter/src/text-stream-buffer.js';
import { skillInstallationHelp } from '../../../packages/skills/src/installation-capability.js';

export function registerSkillInstallationIpc(service: SkillInstallationService, idle: () => boolean) {
  ipcMain.handle('skills:installed', () => service.list());
  ipcMain.handle('skills:installed-enable', async (_e, input) => {
    if (!idle()) throw Error('请等待正在运行的任务完成后修改 Skill。');
    const q = z.strictObject({ name: z.string(), enabled: z.boolean() }).parse(input); await service.enable(q.name, q.enabled);
  });
  ipcMain.handle('skills:installed-remove', async (_e, name) => {
    if (!idle()) throw Error('请等待正在运行的任务完成后移除 Skill。');
    await service.remove(z.string().parse(name));
  });
}
/** A user command is a deterministic application action, not another agent loop or a model-inferred grant. */
export function createSkillChatInstaller(context: { service: SkillInstallationService; store: WorkspaceStore;
  active: Set<string>; emit(event: MessageStreamEvent): void }) {
  const running = new Map<string, AbortController>();
  return {
    cancel(id: string) { const controller = running.get(id); controller?.abort(); return !!controller; },
    async handle(input: SendMessageInput, source: string | null) {
      const { service, store, active } = context, { projectId, conversationId, content } = input;
      const token = input.streamToken ? z.uuid().parse(input.streamToken) : null;
      active.add(conversationId); const controller = new AbortController(); running.set(conversationId, controller);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
      store.appendMessage(conversationId, 'user', content, 'complete'); store.renameConversationFromFirstMessage(conversationId, content);
      const run = store.addRun(projectId, content.slice(0, 80), 'running');
      const streamId = `stream:${conversationId}:${token ?? run.id}`; let sequence = 0;
      const emit = (event: Omit<MessageStreamEvent, 'conversationId' | 'streamId' | 'sequence'>) => context.emit({ conversationId, streamId, sequence: sequence++, ...event });
      const buffer = new TextStreamBuffer(delta => emit({ type: 'delta', delta }), 32); emit({ type: 'start' });
      buffer.push(source === null ? '正在读取 Skill 安装说明…\n' : '正在检查 Skill 来源并安装…\n');
      try {
        const result = source === null ? { status: 'completed' as const, text: skillInstallationHelp(content) }
          : await executeSkillInstallCommand(service, source, signal);
        buffer.close(); store.appendMessage(conversationId, 'assistant', result.text, 'complete', run.id);
        store.updateRun(run.id, result.status); emit({ type: 'complete', content: result.text });
      } catch (error) {
        buffer.close(); const cancelled = controller.signal.aborted;
        const text = cancelled ? 'Skill 安装已取消。' : 'Skill 未安装：' + (error instanceof Error ? error.message : String(error)) +
          '\n\n可发送：`安装 Skill https://github.com/组织/仓库/tree/main/skills/名称`，或 `安装 Skill /绝对路径/名称`。';
        store.appendMessage(conversationId, 'assistant', text, cancelled ? 'cancelled' : 'complete', run.id);
        store.updateRun(run.id, cancelled ? 'cancelled' : 'blocked'); emit({ type: cancelled ? 'cancelled' : 'complete', content: text });
      } finally { running.delete(conversationId); active.delete(conversationId); }
      return store.listMessages(conversationId);
    },
  };
}
export { parseSkillInstallCommand };
