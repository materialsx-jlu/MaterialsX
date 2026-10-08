import assert from 'node:assert/strict';
import test from 'node:test';
import type { CloudCatalog } from './platform.js';
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
