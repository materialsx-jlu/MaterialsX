export function validateRelease(value, expectedChannel) {
  if (!value || value.schemaVersion !== 1 || value.channel !== expectedChannel ||
      !/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(value.version) ||
      (expectedChannel === 'preview') !== value.version.includes('-preview.')) throw Error('INVALID_RELEASE_MANIFEST');
  if (!Array.isArray(value.assets) || !value.assets.length || !value.assets.every(a =>
    typeof a.name === 'string' && a.name.startsWith(`MaterialsX-${value.version}-`) &&
    /^[A-Za-z0-9._-]+$/.test(a.name) && Number.isSafeInteger(a.bytes) && a.bytes > 0 &&
    /^[a-f0-9]{64}$/.test(a.sha256))) throw Error('INVALID_RELEASE_ASSETS');
  if (new Set(value.assets.map(a => a.name)).size !== value.assets.length) throw Error('DUPLICATE_RELEASE_ASSET');
  return value;
}
