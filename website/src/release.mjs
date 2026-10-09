import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRelease } from './release-validation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const channel = process.env.MATERIALSX_SITE_RELEASE_CHANNEL || 'preview';
if (!['preview', 'stable'].includes(channel)) throw Error('INVALID_SITE_RELEASE_CHANNEL');
const path = process.env.MATERIALSX_SITE_RELEASE_MANIFEST || resolve(root, 'releases', `${channel}.json`);
let source;
try { source = readFileSync(path, 'utf8'); }
catch { throw Error(`RELEASE_CHANNEL_MANIFEST_MISSING:${channel}`); }
export const release = validateRelease(JSON.parse(source), channel);
export const releaseTag = `v${release.version}`;
export const releaseUrl = `https://github.com/materialsx-jlu/MaterialsX/releases/tag/${releaseTag}`;
const assetBase = `https://github.com/materialsx-jlu/MaterialsX/releases/download/${releaseTag}`;
export const releaseAssetUrl = name => `${assetBase}/${encodeURIComponent(name)}`;
export const releaseAssets = Object.freeze(Object.fromEntries([
  ['macos', release.assets.find(a => a.name.endsWith('-mac-arm64.dmg'))],
  ['windows', release.assets.find(a => a.name.endsWith('-win-x64.exe'))],
  ['linux', release.assets.find(a => a.name.endsWith('-linux-x86_64.AppImage'))],
].filter(([, asset]) => asset).map(([key, asset]) => [key, { ...asset, size: `${(asset.bytes / 1_000_000).toFixed(1)} MB` }])));
