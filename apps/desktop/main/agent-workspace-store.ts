import type { DatabaseSync } from 'node:sqlite';
import { agentWorkspacePolicy, browserAsset, subtaskRecord, type AgentWorkspacePolicy, type BrowserAsset, type SubtaskRecord } from '../../../packages/contracts/src/agent-workspace.js';
/** Metadata in the existing SQLite database. Execution and budgets remain in AgentJournal. */
export class AgentWorkspaceStore {
    constructor(private db: DatabaseSync) { }
    private owner(projectId: string) { if (!this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))
        throw Error('PROJECT_NOT_OWNED'); }
    private get(key: string) { const r = this.db.prepare('SELECT value FROM app_meta WHERE key=?').get(key); return r ? JSON.parse(String(r.value)) : null; }
    private put(key: string, value: unknown) { this.db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
    private rows(prefix: string) { return this.db.prepare('SELECT value FROM app_meta WHERE key LIKE ? ORDER BY key').all(prefix + '%').map(r => JSON.parse(String(r.value))); }
    policy(id: string): AgentWorkspacePolicy { this.owner(id); return agentWorkspacePolicy.parse(this.get('agent_workspace_policy:' + id) ?? { subtasksEnabled: false, origins: [], shareBrowserContent: false }); }
    savePolicy(id: string, value: AgentWorkspacePolicy) { this.owner(id); const checked = agentWorkspacePolicy.parse(value); this.put('agent_workspace_policy:' + id, checked); return checked; }
    subtasks(projectId: string) { this.owner(projectId); return this.rows('agent_subtask:').map(v => subtaskRecord.parse(v)).filter(s => s.projectId === projectId); }
    saveSubtask(value: SubtaskRecord, previous: SubtaskRecord | null) {
        const v = subtaskRecord.parse(value);
        this.owner(v.projectId);
        const old = this.get('agent_subtask:' + v.id);
        if (JSON.stringify(old) !== JSON.stringify(previous))
            throw Error('SUBTASK_STATE_CONFLICT');
        if (previous)
            for (const k of ['id', 'projectId', 'parentTaskId', 'parentStepId', 'parentPlanRevision', 'conversationId', 'workspace', 'input', 'inputHashes', 'createdAt'] as const)
                if (JSON.stringify(v[k]) !== JSON.stringify(previous[k]))
                    throw Error('SUBTASK_IDENTITY_IMMUTABLE');
        if (!previous && !this.db.prepare('SELECT id FROM runs WHERE id=? AND project_id=?').get(v.parentTaskId, v.projectId))
            throw Error('PARENT_TASK_NOT_OWNED');
        this.put('agent_subtask:' + v.id, v);
        return v;
    }
    assets(projectId: string) { this.owner(projectId); return this.rows('browser_asset:').map(v => browserAsset.parse(v)).filter(a => a.projectId === projectId); }
    saveAsset(value: BrowserAsset) { const v = browserAsset.parse(value); this.owner(v.projectId); if (this.get('browser_asset:' + v.id))
        throw Error('BROWSER_ASSET_IMMUTABLE'); this.put('browser_asset:' + v.id, v); return v; }
}
