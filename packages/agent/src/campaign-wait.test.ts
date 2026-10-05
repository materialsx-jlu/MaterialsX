import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness } from './task-supervisor.fixture.js';
test('approved campaign waiting preserves spent request and active-time budgets across two days, then resumes only after real job reconciliation', () => {
    const until = 1000 + 3 * 86400000, h = harness({ deferJobs: () => ({ campaignId: randomUUID(), until, jobIds: ['actual-job'] }) });
    h.control.acceptPlan(h.plan);
    const request = h.control.beforeRequest({ messages: [{ role: 'user', content: 'Compute approved input' }] }, 'execute', 32768, 100);
    h.control.endRequest(request.id, 'completed');
    h.tick(12000);
    h.control.beforeTool(h.tool('submit', 'materials_science', { action: 'run' }));
    h.control.afterTool('submit', { job: { id: 'actual-job', status: 'running' } }, false);
    assert.throws(() => h.control.beforeRequest({}, 'execute', 32768, 100), /COMPUTATION_PENDING/);
    assert.equal(h.control.snapshot().requests.length, 1);
    h.control.finish('completed_with_limitations');
    const before = h.control.snapshot();
    assert.equal(before.state, 'waiting');
    assert.equal(before.waiting?.remainingActiveMs, 48000);
    h.tick(2 * 86400000);
    assert.throws(() => h.control.resume(), /先查询原计算/);
    h.control.reconcileJobs([{ id: 'actual-job', state: 'completed' }]);
    h.control.resume();
    const after = h.control.snapshot();
    assert.equal(after.state, 'running');
    assert.equal(after.deadline, 1000 + 12000 + 2 * 86400000 + 48000);
    assert.equal(after.waitingMs, 2 * 86400000);
    assert.deepEqual(after.grant, before.grant);
    assert.deepEqual(after.requests, before.requests);
    const revised = structuredClone(h.plan);
    revised.planRevision++;
    revised.constraints.maxSeconds = 50;
    h.control.revise(revised, 1, 'user');
    assert.equal(h.control.snapshot().deadline, 1000 + 2 * 86400000 + 50000);
    h.tick(38000);
    assert.throws(() => h.control.beforeRequest({}, 'execute', 32768, 100), /时间上限/);
});
test('campaign expiration, unknown tool/model receipts and ordinary jobs never convert into an approved long wait', () => {
    const expired = harness({ deferJobs: () => ({ campaignId: randomUUID(), until: 9000, jobIds: ['j'] }) });
    expired.control.acceptPlan(expired.plan);
    expired.control.beforeTool(expired.tool('submit', 'materials_science'));
    expired.control.afterTool('submit', { job: { id: 'j', status: 'running' } }, false);
    expired.control.finish('completed_with_limitations');
    assert.equal(expired.control.snapshot().state, 'waiting');
    expired.tick(9000);
    expired.control.reconcileJobs([{ id: 'j', state: 'completed' }]);
    assert.throws(() => expired.control.resume(), /等待期限/);
    for (const unknown of ['model', 'tool', 'ordinary']) {
        const h = harness(unknown === 'ordinary' ? {} : { deferJobs: () => ({ campaignId: randomUUID(), until: 172801000, jobIds: ['j'] }) });
        h.control.acceptPlan(h.plan);
        if (unknown === 'model') {
            const r = h.control.beforeRequest({ messages: [{ role: 'user', content: 'Preserve unconfirmed response' }] }, 'interpret', 32768, 100);
            h.control.endRequest(r.id, 'unknown');
        }
        h.control.beforeTool(h.tool('submit', 'materials_science'));
        h.control.afterTool('submit', { job: { id: 'j', status: 'running' } }, false);
        if (unknown === 'tool')
            h.control.beforeTool(h.tool('status', 'materials_science', { action: 'status' }));
        h.control.finish('completed_with_limitations');
        assert.equal(h.control.snapshot().state, 'blocked');
        assert.equal(h.control.snapshot().waiting, undefined);
    }
});
