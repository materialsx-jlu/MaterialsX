import { z } from 'zod';
import type { TaskExecution } from './task-execution.js';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const agentWorkspacePolicy = z.strictObject({ subtasksEnabled: z.boolean(), origins: z.array(z.url()).max(12), shareBrowserContent: z.boolean() });
export type AgentWorkspacePolicy = z.infer<typeof agentWorkspacePolicy>;
export const subtaskInput = z.strictObject({ objective: z.string().min(10).max(2000), reason: z.string().min(10).max(500), acceptance: z.string().min(10).max(1000), files: z.array(z.string().min(1).max(500)).max(8) });
export type SubtaskInput = z.infer<typeof subtaskInput>;
export const subtaskRecord = z.strictObject({ id: z.uuid(), projectId: z.uuid(), parentTaskId: z.uuid(), parentStepId: z.string(), parentPlanRevision: z.number().int().positive(), conversationId: z.uuid(), workspace: z.string(), input: subtaskInput, inputHashes: z.array(z.strictObject({ path: z.string(), sha256: hash })), createdAt: z.iso.datetime(), status: z.enum(['prepared', 'running', 'completed', 'failed', 'cancelled', 'unknown']), error: z.string().nullable(), artifacts: z.array(z.strictObject({ path: z.string(), sha256: hash, bytes: z.number().int().nonnegative() })).max(2) });
export type SubtaskRecord = z.infer<typeof subtaskRecord>;
export const browserAction = z.strictObject({ action: z.enum(['open', 'read', 'click', 'scroll', 'screenshot', 'download', 'inspect_image']), url: z.url().optional(), selector: z.string().min(1).max(160).optional(), dy: z.number().int().min(-1500).max(1500).optional(), assetId: z.uuid().optional(), question: z.string().min(5).max(1200).optional() });
export const browserAsset = z.strictObject({ id: z.uuid(), projectId: z.uuid(), taskId: z.uuid().nullable(), kind: z.enum(['screenshot', 'download', 'visual-report']), path: z.string(), sha256: hash, bytes: z.number().int().nonnegative(), mime: z.string(), sourceUrl: z.string(), createdAt: z.iso.datetime(), modelConnectionId: z.string().nullable(), pixelInputSha256: hash.nullable() });
export type BrowserAsset = z.infer<typeof browserAsset>;
export interface AgentWorkspaceOverview {
    policy: AgentWorkspacePolicy;
    subtasks: Array<SubtaskRecord & {
        execution: TaskExecution | null;
    }>;
    assets: BrowserAsset[];
    browser: {
        open: boolean;
        url: string | null;
    };
}
export interface AgentWorkspaceAPI {
    getAgentWorkspace(projectId: string): Promise<AgentWorkspaceOverview>;
    saveAgentWorkspacePolicy(projectId: string, policy: AgentWorkspacePolicy): Promise<AgentWorkspacePolicy>;
    browserAction(projectId: string, input: z.infer<typeof browserAction>): Promise<unknown>;
    closeResearchBrowser(projectId: string, clearSession: boolean): Promise<void>;
    previewBrowserAsset(projectId: string, id: string): Promise<{
        kind: 'image' | 'text';
        content: string;
    }>;
    cancelResearchSubtask(projectId: string, id: string): Promise<void>;
    previewResearchSubtask(projectId: string, id: string, path: string): Promise<string>;
}
