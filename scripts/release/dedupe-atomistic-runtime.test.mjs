import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dedupeAtomisticRuntime } from './dedupe-atomistic-runtime.mjs';

test('links only byte-identical large runtime files and preserves imports by path', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mx-runtime-dedupe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = ['ani', 'chgnet', 'mace'].map(name => join(root, name, 'lib/python3.12/site-packages/torch/lib/libtorch_cpu.dylib'));
  for (const path of paths) await mkdir(join(path, '..'), { recursive: true });
  const original = Buffer.alloc(1024 * 1024 + 1, 41);
  await writeFile(paths[0], original);
  await writeFile(paths[1], original);
  await writeFile(paths[2], Buffer.alloc(original.length, 42));
  const dry = await dedupeAtomisticRuntime(root, { dryRun: true });
  assert.equal(dry.linked, 1);
  assert.notEqual((await stat(paths[0])).ino, (await stat(paths[1])).ino);
  const result = await dedupeAtomisticRuntime(root);
  assert.equal(result.savedBytes, original.length);
  assert.equal((await stat(paths[0])).ino, (await stat(paths[1])).ino);
  assert.notEqual((await stat(paths[0])).ino, (await stat(paths[2])).ino);
  assert.deepEqual(await readFile(paths[1]), original);
  assert.equal((await dedupeAtomisticRuntime(root)).linked, 0);
});
