import { randomUUID } from 'node:crypto';
import { TaskSupervisor } from '../../../packages/agent/src/task-supervisor.js';
import { directPlan } from '../../../packages/agent/src/research-planning.js';
import { supervisionStore } from '../../../apps/desktop/main/agent-supervision-store.js';
import type { WorkspaceStore } from '../../../apps/desktop/main/store.js';
import type { ResearchService } from '../../../apps/desktop/main/research-service.js';
/** Technical test parent. The real model child still runs the production runtime, transport and tool loop. */
export function ua12Parent(store: WorkspaceStore, service: ResearchService, projectId: string, connectionId: string, engine: 'pi' | 'codex' = 'pi') {
    const conversation = store.createConversation(projectId), run = store.addRun(projectId, 'UA12 evidence review', 'running'), task = { taskId: run.id, projectId, conversationId: conversation.id } as any;
    const grant = { grantId: randomUUID(), projectId, conversationId: conversation.id, permissions: ['read', 'search', 'network', 'patch', 'terminal', 'science'], approvedBy: 'local-user', maxCredits: null, maxSeconds: 300 } as any;
    const context = { task, grant, methods: new Map<string, readonly any[]>([['engine.execute', []], ['research_subtask', ['read', 'search']], ['read', ['read']]]) };
    service.begin(run.id, projectId, '分工核对资料并综合');
    const control = new TaskSupervisor({ context, engine, connectionId, accountRef: 'local', projectPath: store.getProject(projectId)!.path, ...supervisionStore(store, run.id) }), plan = directPlan('分工核对资料并综合', context);
    plan.executionMode = 'planned';
    plan.steps = [{ ...plan.steps[0]!, method: 'research_subtask', permissions: ['read', 'search', 'network'], expectedArtifacts: ['子任务报告', '子任务回执'] }, { ...plan.steps[0]!, id: 'synthesize' as any, dependsOn: ['execute' as any] }];
    control.acceptPlan(plan);
    control.beforeTool({ id: 'delegate', name: 'research_subtask', args: { objective: 'Review input source' }, permissions: ['read', 'search'] });
    return { control, task, run, context };
}
