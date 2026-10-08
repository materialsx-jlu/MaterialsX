import assert from 'node:assert/strict';
import test from 'node:test';
import { alphaTaskSchema, cloudCatalogSchema, type CloudCatalog } from './platform.js';
import { admittedPlatformModel } from './platform-model-admission.js';

const catalog = {
  items: [
    { id: 'materials-research', enabled: true, accessMode: 'paid-credits' },
    { id: 'gpt-5.6-sol', enabled: true, accessMode: 'mx-points' },
    { id: 'gpt-6-sol', enabled: false, accessMode: 'mx-points' },
    { id: 'diagnostic', enabled: true, accessMode: 'alpha-diagnostic' },
  ],
  alpha: { available: false },
} as CloudCatalog;

test('a purchased MX model remains available without legacy alpha access', () => {
  assert.equal(admittedPlatformModel(catalog, 'gpt-5.6-sol')?.id, 'gpt-5.6-sol');
  assert.equal(admittedPlatformModel(catalog, 'materials-research'), null);
  assert.equal(admittedPlatformModel(catalog, 'diagnostic'), null);
  assert.equal(admittedPlatformModel(catalog, 'gpt-6-sol'), null);
});

test('legacy research and diagnostic models still require alpha access', () => {
  const granted = { ...catalog, alpha: { ...catalog.alpha, available: true } };
  assert.equal(admittedPlatformModel(granted, 'materials-research')?.id, 'materials-research');
  assert.equal(admittedPlatformModel(granted, 'diagnostic')?.id, 'diagnostic');
});

test('a newly published MX model survives the desktop catalogue and task contracts', () => {
  const unknown = { status: 'unknown', evidenceId: null };
  const verified = { status: 'verified', evidenceId: 'model-onboarding-probe' };
  const item = { id: 'new-materials-model', providerId: 'litellm-onboarded', upstreamModelId: 'vendor/model-v2',
    protocol: 'responses', enabled: true, contextWindow: null, maxOutputTokens: 8192,
    capabilities: { streaming: verified, tools: verified, structuredOutput: unknown, cancellation: unknown },
    salesPriceVersionId: 'immutable-price-v1', verifiedAt: null, accessMode: 'mx-points', routeVersionId: 'route-v1' };
  const parsed = cloudCatalogSchema.parse({ items: [item], nextCursor: null, testPricing: null, paidPricing: null,
    alpha: { configured: true, available: false, remainingRequests: 0, expiresAt: null,
      limits: { maxRequests: 0, maxOutputTokensPerRequest: 8192, maxDurationSeconds: 3600 } } });
  assert.equal(admittedPlatformModel(parsed, item.id)?.id, item.id);
  assert.equal(alphaTaskSchema.parse({ id: 'task-v1', clientTaskId: 'client-v1', modelId: item.id,
    billingMode: 'mx-points', state: 'created', scientificQuality: 'not_evaluated', requestCount: 0,
    createdAt: '2026-10-08T00:00:00Z', deadline: '2026-10-08T01:00:00Z',
    consent: { policyVersion: 'cloud-alpha-v1', prompt: true, history: 'platform-only', fileCount: 0, skillCount: 0 },
    budget: { maxRequests: 1, maxOutputTokensPerRequest: 48, maxDurationSeconds: 120 } }).modelId, item.id);
});
