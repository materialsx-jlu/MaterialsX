import type { CloudCatalog } from './platform.js';

/** Keep settings, message submission and the model transport on the same access rule. */
export function admittedPlatformModel(catalog: CloudCatalog, modelId: string) {
  const listed = catalog.items.find(item => item.id === modelId);
  // Older alpha catalogues did not include their built-in research model in items.
  if (!listed && modelId === 'materials-research' && catalog.alpha.available)
    return { id: modelId, accessMode: 'alpha-test' as const, salesPriceVersionId: null };
  const model = listed?.enabled ? listed : null;
  if (!model) return null;
  if (model.id === 'materials-research' || model.accessMode === 'alpha-diagnostic')
    return catalog.alpha.available ? model : null;
  return model.accessMode === 'mx-points' ? model : null;
}
