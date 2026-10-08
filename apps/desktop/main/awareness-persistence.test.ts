import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from './store.js';
import { supervisionStore } from './agent-supervision-store.js';
import { TaskSupervisor } from '../../../packages/agent/src/task-supervisor.js';
import { directPlan } from '../../../packages/agent/src/research-planning.js';
import { taskRefSchema, permissionGrantSchema } from '../../../packages/contracts/src/agent.js';
import { applicationCapabilities } from './application-capabilities.js';

test('capability revisions, corrected facts and exact answer audit survive SQLite restart without changing task grants or replaying work', async () => {
  const dir=mkdtempSync(join(tmpdir(),'mx-awareness-db-'));let store=new WorkspaceStore(join(dir,'workspace.sqlite'));
  try {
    const project=store.createProject(dir),conversation=store.createConversation(project.id),run=store.addRun(project.id,'awareness','running');
    const task=taskRefSchema.parse({taskId:run.id,projectId:project.id,conversationId:conversation.id});
    const grant=permissionGrantSchema.parse({grantId:randomUUID(),projectId:project.id,conversationId:conversation.id,permissions:['read'],approvedBy:'local-user',maxCredits:null,maxSeconds:60});
    const context={task,grant,methods:new Map([['engine.execute',[]],['read',['read'] as const]])};let enabled=false;
    const facts=()=>applicationCapabilities([{name:'saved-fixture',enabled}],[],false,true);
    const control=new TaskSupervisor({context,engine:'pi',connectionId:'sqlite-fixture',accountRef:'local',projectPath:dir,capabilityFacts:facts,...supervisionStore(store,run.id)});
    const plan=directPlan('显示 saved-fixture 安装状态',context);control.acceptPlan(plan);
    await control.command({action:'capabilities',query:'saved-fixture'});
    enabled=true;await control.command({action:'capabilities',query:'saved-fixture'});
    const revision=control.snapshot().awareness!.capabilities!.revision;
    const answer='saved-fixture is installed and enabled';
    const audit=await control.command({action:'validate_answer',answer,claims:[{kind:'capability',id:'skill:saved-fixture',dimension:'installed',value:true,revision}]}) as any;
    assert.equal(audit.status,'claims_verified');const before=control.snapshot();store.close();store=new WorkspaceStore(join(dir,'workspace.sqlite'));
    const restored=store.agentJournal.read(run.id)!;assert.deepEqual(restored.awareness,before.awareness);assert.deepEqual(restored.answerAssessment,before.answerAssessment);
    assert(restored.awareness!.corrections.some(c=>c.key==='capability:skill:saved-fixture'));
    const resumed=new TaskSupervisor({context,engine:'pi',connectionId:'sqlite-fixture',accountRef:'local',projectPath:dir,capabilityFacts:facts,
      previous:restored,previousPlan:store.researchPlan(run.id)!,...supervisionStore(store,run.id)});
    assert.equal(resumed.checkAnswer(answer).status,'claims_verified');assert.deepEqual(resumed.snapshot().grant,grant);
    assert.equal(resumed.snapshot().attempts.length,0);assert.equal(resumed.snapshot().requests.length,0);
    assert.throws(()=>new TaskSupervisor({context:{...context,grant:{...grant,permissions:['read','patch']}},engine:'pi',connectionId:'sqlite-fixture',accountRef:'local',projectPath:dir,previous:resumed.snapshot(),previousPlan:plan,...supervisionStore(store,run.id)}),/原任务/);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
