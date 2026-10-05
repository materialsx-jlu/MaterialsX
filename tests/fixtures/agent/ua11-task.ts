import { randomUUID } from 'node:crypto';
import type { WorkspaceStore } from '../../../apps/desktop/main/store.js';
import type { ResearchService } from '../../../apps/desktop/main/research-service.js';
import { TaskSupervisor } from '../../../packages/agent/src/task-supervisor.js';
import { directPlan } from '../../../packages/agent/src/research-planning.js';
import { supervisionStore } from '../../../apps/desktop/main/agent-supervision-store.js';
export function campaignTask(s: {
    temp: string;
    store: WorkspaceStore;
    p: {
        id: string;
    };
    service: ResearchService;
}, configId: string) {
    const conversation = s.store.createConversation(s.p.id), run = s.store.addRun(s.p.id, 'UA11 actual reference', 'running');
    s.service.begin(run.id, s.p.id, '@materials-long-compute Run configured computation ' + configId);
    const task = { taskId: run.id, projectId: s.p.id, conversationId: conversation.id } as any, grant = { grantId: randomUUID(), projectId: s.p.id, conversationId: conversation.id, permissions: ['read', 'patch', 'terminal', 'science'] as any, approvedBy: 'local-user' as const, maxCredits: null, maxSeconds: 120 };
    const context = { task, grant, methods: new Map([['engine.execute', []], ['campaign_job', grant.permissions]]) };
    const control = new TaskSupervisor({ context, engine: 'pi', connectionId: 'fixture', accountRef: 'local', projectPath: s.temp, deferJobs: state => s.service.campaigns.wait(state), resolveArtifact: (step, name) => s.service.campaigns.resolveArtifact(run.id, step, name), ...supervisionStore(s.store, run.id) });
    const plan = directPlan('Run approved long computation', context);
    plan.executionMode = 'planned';
    plan.steps[0]!.method = 'campaign_job';
    plan.steps[0]!.permissions = grant.permissions;
    plan.steps[0]!.expectedArtifacts = ['计算 JSON', '计算报告'];
    plan.acceptance.requiredArtifacts = plan.steps[0]!.expectedArtifacts;
    control.acceptPlan(plan);
    return { run, conversation, control, plan, context };
}
