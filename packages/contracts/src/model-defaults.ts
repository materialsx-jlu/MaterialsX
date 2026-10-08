import type { ModelSettings } from './desktop.js';

/** Public M5 route ID; the upstream supplier/model are fixed by the server. */
export const PLATFORM_MODEL_ID = 'materials-research';
export const DEFAULT_CLOUD_MODEL = 'gpt-5.6-sol';
export const DEFAULT_MODEL_SETTINGS = {
  mode: 'platform',
  modelId: PLATFORM_MODEL_ID,
  agentEngine: 'codex',
  localEndpoint: 'http://127.0.0.1:11434',
} as const satisfies ModelSettings;
