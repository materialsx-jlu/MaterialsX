import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPlatformReceipt } from './platform-receipts.js';
import { alphaRequestSchema, alphaTaskSchema, cloudCatalogSchema } from '../../contracts/src/platform.js';
const budget = { maxRequests: 3, maxOutputTokensPerRequest: 512, maxDurationSeconds: 120, maxCredits: '50' };
const task = alphaTaskSchema.parse({ id: 'original-task', clientTaskId: 'original-client', modelId: 'materials-research', billingMode: 'paid-credits', budget, consent: { policyVersion: 'cloud-alpha-v1', prompt: true, history: 'platform-only', fileCount: 0, skillCount: 0 }, state: 'running', scientificQuality: 'not_evaluated', createdAt: new Date().toISOString(), deadline: new Date(Date.now() + 120000).toISOString(), requestCount: 1 });
const price = { id: 'price-original', modelId: 'materials-research', routeVersionId: 'route-original', testOnly: false, unit: 'paid-credit', tiers: [{ minInputTokens: 0, inputPerMillion: '1000', cachedInputPerMillion: '100', outputPerMillion: '10000' }], inputOverheadTokens: 0, maxInputTokens: 10000, inputPolicy: 'paid-pilot-ceiling-v1', evidenceRef: 'synthetic' };
const catalog = cloudCatalogSchema.parse({ items: [], nextCursor: null, paidPricing: price, alpha: { configured: true, available: true, remainingRequests: 3, expiresAt: null, limits: { maxRequests: 3, maxOutputTokensPerRequest: 512, maxDurationSeconds: 120 } } });
const receipt = alphaRequestSchema.parse({ id: 'actual-request', taskId: task.id, modelId: 'materials-research', billingMode: 'paid-credits', execution: 'completed', settlement: 'settled', scientificQuality: 'not_evaluated', usage: { source: 'responses', inputTokens: 10, outputTokens: 4, cachedInputTokens: 2, uncachedInputTokens: 8, reasoningTokens: 1 }, reservedCredits: '10', chargedCredits: '0.1', salesPriceVersionId: price.id, routeVersionId: price.routeVersionId, terminalReceived: true, errorCode: null, dispatched: true });
test('paid tool continuation requires the exact request, task and frozen price route with settled actual usage', () => {
    assertPlatformReceipt(receipt, receipt.id, task, catalog);
    for (const changes of [{ id: 'other-request' }, { taskId: 'other-task' }, { routeVersionId: 'other-route' }, { salesPriceVersionId: 'other-price' }, { billingMode: 'alpha-test' }, { dispatched: false }, { execution: 'unknown' }, { settlement: 'reserved' }, { terminalReceived: false }, { usage: null }])
        assert.throws(() => assertPlatformReceipt({ ...receipt, ...changes } as any, receipt.id, task, catalog));
});

test('confirmed supplier output overflow takes precedence over missing stream usage',()=>{
 assert.throws(()=>assertPlatformReceipt({...receipt,execution:'failed',errorCode:'TASK_BUDGET_EXCEEDED'} as any,receipt.id,task,catalog,null),(e:any)=>e.code==='BUDGET_EXCEEDED');
 assert.throws(()=>assertPlatformReceipt({...receipt,execution:'unknown',errorCode:'STREAM_INTERRUPTED'} as any,receipt.id,task,catalog),(e:any)=>e.code==='RECONCILIATION_REQUIRED');
});
