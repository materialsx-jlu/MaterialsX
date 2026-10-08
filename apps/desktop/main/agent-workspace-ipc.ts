import { ipcMain } from 'electron';
import { z } from 'zod';
import { agentWorkspacePolicy, browserAction } from '../../../packages/contracts/src/agent-workspace.js';
import type { AgentWorkspace } from './agent-workspace.js';
import type { DesktopAgentRuntime } from './agent-runtime.js';
export function registerAgentWorkspaceIpc(service: AgentWorkspace, runtime: DesktopAgentRuntime) {
    const id = z.uuid();
    ipcMain.handle('agent-workspace:list', (_e, p) => service.overview(id.parse(p)));
    ipcMain.handle('agent-workspace:policy', (_e, p, q) => service.savePolicy(id.parse(p), agentWorkspacePolicy.parse(q)));
    ipcMain.handle('agent-workspace:browser', (_e, p, q) => service.browser.act(id.parse(p), browserAction.parse(q)));
    ipcMain.handle('agent-workspace:browser-close', (_e, p, clear) => service.browser.close(id.parse(p), z.boolean().parse(clear)));
    ipcMain.handle('agent-workspace:preview', (_e, p, a) => service.browser.preview(id.parse(p), id.parse(a)));
    ipcMain.handle('agent-workspace:cancel-child', (_e, p, c) => runtime.subtasks.cancel(id.parse(p), id.parse(c)));
    ipcMain.handle('agent-workspace:child-preview', (_e, p, c, path) => runtime.subtasks.preview(id.parse(p), id.parse(c), z.string().min(1).max(1000).parse(path)));
}
