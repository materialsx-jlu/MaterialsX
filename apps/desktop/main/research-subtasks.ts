import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { AgentError, type Permission } from '../../../packages/contracts/src/agent.js';
import { subtaskInput, type SubtaskRecord } from '../../../packages/contracts/src/agent-workspace.js';
import type { ModelSettings } from '../../../packages/contracts/src/desktop.js';
import type { ModelConnection } from '../../../packages/contracts/src/engine-selection.js';
import type { TaskExecution } from '../../../packages/contracts/src/task-execution.js';
import { readOwnedBytes } from '../../../packages/atomistic/src/artifact-io.js';
import { safeDirectory } from '../../../packages/atomistic/src/discovery-io.js';
import { writeScientificFiles } from '../../../packages/agent/src/scientific-artifacts.js';
import type { WorkspaceStore } from './store.js';
export interface SubtaskLaunch {
    parent: TaskExecution;
    workspace: string;
    connection: ModelConnection;
    settings: ModelSettings;
    signal: AbortSignal;
}
export type SubtaskRunner = (record: SubtaskRecord, launch: SubtaskLaunch, prompt: string) => Promise<string>;
/** Same execution journal and engine runner; no agent loop or private budget ledger. One-level, at most three sequential children. */
export class ResearchSubtasks {
    private running = new Map<string, AbortController>();
    private preparing = new Set<string>();
    constructor(private store: WorkspaceStore, private run: SubtaskRunner) { }
    private records(projectId: string) { return this.store.agentWorkspace.subtasks(projectId); }
    parentOf(taskId: string, projectId: string) { return this.records(projectId).find(s => s.id === taskId) ?? null; }
    scope(conversationId: string) { return this.store.listProjects().flatMap(p => this.records(p.id)).find(s => s.conversationId === conversationId) ?? null; }
    /** Synchronous admission followed by the supervisor's synchronous SQLite save: concurrent promises cannot spend the last slot twice. */
    admit(taskId: string, projectId: string, kind: 'check' | 'request' | 'tool', permissions: readonly Permission[] = []) {
        const child = this.parentOf(taskId, projectId), rootId = child?.parentTaskId ?? taskId, root = this.store.agentJournal.read(rootId);
        if (child) {
            if (!this.store.agentWorkspace.policy(projectId).subtasksEnabled)
                throw new AgentError('PERMISSION_DENIED', '子任务授权已关闭 / Subtasks disabled');
            if (!root || root.state !== 'running' || Date.now() >= root.deadline)
                throw new AgentError('CANCELLED', '主任务已停止或到期 / Parent stopped or expired');
            if (root.planRevision !== child.parentPlanRevision || root.activeStepId !== child.parentStepId)
                throw new AgentError('CONFLICT', '主任务步骤或计划已改变 / Parent plan changed');
            if (permissions.some(p => !root.grant.permissions.includes(p) || !this.store.researchPlan(rootId)?.constraints.permissions.includes(p) || !this.store.researchPlan(rootId)?.steps.find(s => s.id === child.parentStepId)?.permissions.includes(p)))
                throw new AgentError('PERMISSION_DENIED', '子任务不能扩大主任务权限 / Parent grant narrowed');
            if (kind === 'tool' && permissions.some(p => !['read', 'search', 'network'].includes(p)))
                throw new AgentError('PERMISSION_DENIED', '子任务只读；计算和写入由主任务负责 / Read-only research child');
            const own = this.store.research.binding(taskId), parent = this.store.research.binding(rootId);
            if (!own || !parent || JSON.stringify(own.approvedInputs) !== JSON.stringify(parent.approvedInputs))
                throw new AgentError('CONFLICT', '父子任务冻结输入已改变 / Frozen inputs changed');
        }
        const children = this.records(projectId).filter(s => s.parentTaskId === rootId), ids = new Set([rootId, ...children.map(s => s.id)]);
        const family = this.store.agentJournal.forProject(projectId).filter(s => ids.has(s.task.taskId));
        if (kind === 'tool' && family.reduce((n, s) => n + s.attempts.length, 0) >= 512)
            throw new AgentError('BUDGET_EXCEEDED', '主任务与子任务共用 512 次工具上限 / Shared tool cap');
    }
    async execute(projectId: string, parent: TaskExecution, input: unknown, connection: ModelConnection, settings: ModelSettings, signal: AbortSignal) {
        const id = parent.task.taskId;
        if (this.preparing.has(id)) throw Error('SUBTASK_ALREADY_IN_FLIGHT');
        this.preparing.add(id);
        try { return await this.dispatch(projectId, parent, input, connection, settings, signal); }
        finally { this.preparing.delete(id); }
    }
    private async dispatch(projectId: string, parent: TaskExecution, input: unknown, connection: ModelConnection, settings: ModelSettings, signal: AbortSignal) {
        const spec = subtaskInput.parse(input);
        signal.throwIfAborted();
        const policy = this.store.agentWorkspace.policy(projectId), plan = this.store.researchPlan(parent.task.taskId), step = plan?.steps.find(s => s.id === parent.activeStepId);
        if (!policy.subtasksEnabled || parent.accountRef !== 'local' || connection.source !== 'local')
            throw Error('SUBTASK_LOCAL_APPROVAL_REQUIRED');
        if (parent.parentTaskId || this.parentOf(parent.task.taskId, projectId))
            throw Error('NESTED_SUBTASK_DENIED');
        if (parent.task.projectId !== projectId || connection.id !== parent.connectionId || (settings.agentEngine ?? 'pi') !== parent.engine)
            throw Error('SUBTASK_PARENT_IDENTITY_REQUIRED');
        if (parent.state !== 'running' || plan?.executionMode !== 'planned' || plan.steps.length < 2 || !step || !['engine.execute', 'research_subtask'].includes(step.method))
            throw Error('SUBTASK_REQUIRES_USEFUL_PLANNED_STEP');
        if (!parent.attempts.some(a => a.method === 'research_subtask' && a.state === 'running' && a.stepId === step.id))
            throw Error('SUBTASK_SUPERVISED_ATTEMPT_REQUIRED');
        const records = this.records(projectId).filter(s => s.parentTaskId === parent.task.taskId);
        if (records.length >= 3 || records.some(s => ['prepared', 'running', 'unknown'].includes(s.status)))
            throw Error('SUBTASK_LIMIT_OR_RECONCILIATION');
        this.admit(parent.task.taskId, projectId, 'check');
        const root = this.store.getProject(projectId)!.path;
        const originals: Array<{
            name: string;
            bytes: Buffer;
            sha256: string;
        }> = [];
        for (const path of spec.files) {
            const absolute = resolve(root, path), r = relative(root, absolute);
            if (isAbsolute(r) || r === '..' || r.startsWith('../') || /(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|sqlite|db)$|(?:auth|credentials)\.json$|(?:^|\/)\.git(?:\/|$)/i.test(r))
                throw Error('SUBTASK_INPUT_DENIED');
            const bytes = await readOwnedBytes(root, absolute, null, 512 * 1024);
            originals.push({ name: 'input-' + originals.length + '-' + r.split('/').at(-1), bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
        }
        signal.throwIfAborted();
        const current = this.store.agentJournal.read(parent.task.taskId);
        if (!this.store.agentWorkspace.policy(projectId).subtasksEnabled || current?.state !== 'running' || current.planRevision !== parent.planRevision || current.activeStepId !== parent.activeStepId || Date.now() >= current.deadline)
            throw Error('SUBTASK_PARENT_CHANGED_DURING_PREPARATION');
        const conversation = this.store.createConversation(projectId), run = this.store.addRun(projectId, 'Subtask · ' + spec.objective.slice(0, 80), 'running');
        const base = safeDirectory(root, '.materialsx'), tasks = safeDirectory(base, 'subtasks'), workspace = safeDirectory(tasks, run.id), copied = originals.map(i => ({ path: i.name, sha256: i.sha256 }));
        const parentBinding = this.store.research.binding(parent.task.taskId);
        if (!parentBinding)
            throw Error('PARENT_RESEARCH_BINDING_REQUIRED');
        this.store.research.saveBinding({ ...parentBinding, taskId: run.id, createdAt: new Date().toISOString() });
        let record: SubtaskRecord = { id: run.id, projectId, parentTaskId: parent.task.taskId, parentStepId: step.id, parentPlanRevision: parent.planRevision, conversationId: conversation.id, workspace, input: spec, inputHashes: copied, createdAt: new Date().toISOString(), status: 'prepared', error: null, artifacts: [] };
        this.store.agentWorkspace.saveSubtask(record, null);
        const controller = new AbortController(), combined = AbortSignal.any([controller.signal, signal]);
        this.running.set(run.id, controller);
        const prompt = `独立研究子任务 / Independent research subtask\n目标 / Goal: ${spec.objective}\n验收要求 / Acceptance: ${spec.acceptance}\nApproved local files (hash-frozen): ${JSON.stringify(copied)}\nThis is a read-only research child. Use original MaterialsX source tools; calculations and writes belong to the parent. Do not delegate, alter project settings, invent missing data, execute outside this workspace or claim scientific validation. Deliver a concise Markdown answer with actual evidence references and limitations. This is part of the parent task; do not expand its goal.\nParent goal: ${plan.originalRequest.slice(0, 2000)}`;
        try {
            for (const source of originals)
                await writeFile(join(workspace, source.name), source.bytes, { flag: 'wx', mode: 0o600 });
            record = this.store.agentWorkspace.saveSubtask({ ...record, status: 'running' }, record);
            const result = await this.run(record, { parent, workspace, connection, settings, signal: combined }, prompt);
            combined.throwIfAborted();
            const execution = this.store.agentJournal.read(run.id);
            if (!execution || execution.parentTaskId !== parent.task.taskId || execution.state !== 'completed_with_limitations' || !result.trim() || Buffer.byteLength(result) > 128 * 1024)
                throw Error('SUBTASK_REAL_COMPLETION_REQUIRED');
            const evidence = execution.attempts.filter(a => a.state === 'completed' && a.resultRef && ['read', 'research_data', 'paper_search', 'paper_get'].includes(a.method));
            if (!evidence.length || copied.some(input => !evidence.some(a => { if (a.method !== 'read' || !a.inputRef)
                return false; const call = this.store.agentJournal.readResult(run.id, a.inputRef) as {
                args?: {
                    path?: string;
                };
            }; return call.args?.path && resolve(workspace, call.args.path) === join(workspace, input.path); })))
                throw Error('SUBTASK_SOURCE_READ_RECEIPT_REQUIRED');
            this.admit(run.id, projectId, 'check');
            for (const input of copied)
                await readOwnedBytes(workspace, join(workspace, input.path), input.sha256, 512 * 1024);
            const artifacts = await writeScientificFiles(workspace, run.id, [{ name: 'result.md', body: result }, { name: 'receipt.json', body: JSON.stringify({ taskId: run.id, parentTaskId: parent.task.taskId, inputHashes: copied, planRevision: execution.planRevision, requests: execution.requests, attempts: execution.attempts, scientificStatus: 'needs_review', acceptance: { technical: 'journal-and-files-verified', semantic: 'needs_review' } }, null, 2) + '\n' }]);
            record = this.store.agentWorkspace.saveSubtask({ ...record, status: 'completed', artifacts }, record);
            this.store.updateRun(run.id, 'completed');
            return { id: run.id, status: 'completed', parentTaskId: parent.task.taskId, result, artifacts, scientificStatus: 'needs_review', semanticAcceptance: 'needs_review' };
        }
        catch (error) {
            record = this.store.agentWorkspace.saveSubtask({ ...record, status: combined.aborted ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : 'Subtask failed' }, record);
            this.store.updateRun(run.id, 'failed');
            throw error;
        }
        finally {
            this.running.delete(run.id);
        }
    }
    async resolveArtifact(parentId: string, stepId: string, name: string) { if (!['子任务报告', '子任务回执'].includes(name))
        return null; const parent = this.store.agentJournal.read(parentId); if (!parent)
        return null; const record = this.records(parent.task.projectId).filter(s => s.parentTaskId === parentId && s.parentStepId === stepId && s.parentPlanRevision === parent.planRevision && s.status === 'completed').at(-1), file = record?.artifacts.find(a => a.path.endsWith(name === '子任务报告' ? 'result.md' : 'receipt.json')); if(!record||!file)return null;await readOwnedBytes(record.workspace,join(record.workspace,file.path),file.sha256,1024*1024);return join(record.workspace,file.path); }
    overview(projectId: string) { return this.records(projectId).map(record => { const execution = this.store.agentJournal.read(record.id); return { ...record, ...(['prepared', 'running'].includes(record.status) && !this.running.has(record.id) ? { status: 'unknown' as const, error: 'Original dispatch needs reconciliation; never automatically resubmitted' } : {}), execution }; }); }
    cancel(projectId: string, id: string) { const record = this.records(projectId).find(s => s.id === id); if (!record)
        throw Error('SUBTASK_NOT_OWNED'); this.running.get(id)?.abort(Error('SUBTASK_CANCELLED')); }
    cancelParent(parentId: string) { for (const p of this.store.listProjects())
        for (const s of this.records(p.id).filter(s => s.parentTaskId === parentId))
            this.running.get(s.id)?.abort(Error('PARENT_STOPPED')); }
    async preview(projectId: string, id: string, path: string) { const record = this.records(projectId).find(s => s.id === id), artifact = record?.artifacts.find(a => a.path === path); if (!record || !artifact)
        throw Error('SUBTASK_ARTIFACT_NOT_OWNED'); return (await readOwnedBytes(record.workspace, join(record.workspace, path), artifact.sha256, 1024 * 1024)).toString('utf8'); }
}
