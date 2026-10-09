import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { validateRelease } from '../../website/src/release-validation.mjs';

const {version:packageVersion}=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
const source = resolve(process.argv[2] || `release/dist/${packageVersion}/release-info.json`);
const info = JSON.parse(await readFile(source, 'utf8'));
const channel = info.channel;
if (!['preview', 'stable'].includes(channel)) throw Error('INVALID_RELEASE_CHANNEL');
const assets = info.assets;
const manifest = validateRelease({ schemaVersion: 1, channel, version: info.version, assets }, channel);
const directory = dirname(source);
const checksums=await readFile(join(directory,'SHA256SUMS.txt'),'utf8');
for (const asset of assets) {
  if (basename(asset.name) !== asset.name) throw Error('INVALID_ASSET_NAME');
  const file = join(directory, asset.name);
  if ((await stat(file)).size !== asset.bytes) throw Error(`ASSET_SIZE_MISMATCH:${asset.name}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== asset.sha256) throw Error(`ASSET_HASH_MISMATCH:${asset.name}`);
  if(!checksums.split('\n').includes(`${asset.sha256}  ${asset.name}`))throw Error(`CHECKSUM_LIST_MISMATCH:${asset.name}`);
}
const sourceHash=createHash('sha256').update(await readFile(source)).digest('hex');
if(!checksums.split('\n').includes(`${sourceHash}  release-info.json`))throw Error('RELEASE_INFO_CHECKSUM_MISMATCH');
const output = resolve(`website/releases/${channel}.json`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Published verified ${channel} manifest: ${output}`);
