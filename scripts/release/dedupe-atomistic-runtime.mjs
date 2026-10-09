import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, lstat, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const MIN_BYTES = 1024 * 1024;

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function candidates(root) {
  const found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const info = await lstat(path);
        if (info.size >= MIN_BYTES && info.nlink === 1)
          found.push({ path, size: info.size, mode: info.mode & 0o777, dev: info.dev });
      }
    }
  }
  for (const name of ['ani', 'chgnet', 'mace', 'sevennet']) {
    const dir = join(root, name, 'lib', 'python3.12', 'site-packages');
    try { await walk(dir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return found;
}

/** Replace identical large runtime files with hard links before building the DMG. */
export async function dedupeAtomisticRuntime(root, { dryRun = false } = {}) {
  const files = await candidates(root);
  const bySize = new Map();
  for (const file of files) {
    const key = `${file.dev}:${file.mode}:${file.size}`;
    const group = bySize.get(key) ?? [];
    group.push(file);
    bySize.set(key, group);
  }
  let linked = 0;
  let savedBytes = 0;
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    const byHash = new Map();
    for (const file of group) {
      const hash = await digest(file.path);
      const first = byHash.get(hash);
      if (!first) { byHash.set(hash, file.path); continue; }
      if (!dryRun) {
        const temp = `${file.path}.materialsx-link`;
        await link(first, temp);
        try { await rename(temp, file.path); }
        catch (error) { await rm(temp, { force: true }); throw error; }
      }
      linked++;
      savedBytes += file.size;
    }
  }
  return { scanned: files.length, linked, savedBytes, dryRun };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = process.argv[2];
  if (!root) throw Error('Usage: node dedupe-atomistic-runtime.mjs <runtime-directory> [--dry-run]');
  console.log(JSON.stringify(await dedupeAtomisticRuntime(root, { dryRun: process.argv.includes('--dry-run') })));
}
