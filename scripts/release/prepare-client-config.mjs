import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseManifest } from '../../deploy/config-schema.mjs';

const target = resolve('runtime/release-build/client/materialsx-client.json');
const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const manifestPath = process.env.MATERIALSX_DEPLOY_MANIFEST;
let config = { schemaVersion: 1, apiOrigin: null, releaseChannel: 'preview' };
if (manifestPath) {
  const manifest = parseManifest(await readFile(resolve(manifestPath), 'utf8'));
  config = {
    schemaVersion: 1,
    apiOrigin: manifest.public.apiOrigin,
    releaseChannel: manifest.releaseChannel,
    websiteOrigin: manifest.public.siteOrigin,
  };
}
if ((process.env.MATERIALSX_RELEASE_CHANNEL === 'stable' || !version.includes('-')) && config.releaseChannel !== 'stable')
  throw Error('STABLE_RELEASE_REQUIRES_VALID_PRODUCTION_MANIFEST');
if (version.includes('-') && config.releaseChannel === 'stable')
  throw Error('PREVIEW_VERSION_CANNOT_USE_STABLE_CLIENT_CONFIG');
await mkdir(resolve('runtime/release-build/client'), { recursive: true });
await writeFile(target, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
console.log(`Prepared ${config.releaseChannel} client config (${config.apiOrigin ?? 'platform unconfigured'})`);
