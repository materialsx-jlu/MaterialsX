import { mkdir, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readOwnedBytes } from '../../atomistic/src/artifact-io.js';
import type { SkillInstallationService } from './installation-service.js';

/** Copy verified package resources into the existing project sandbox; no scripts or dependency installers run. */
export async function prepareSkillResources(service: SkillInstallationService, name: string, project: string, signal: AbortSignal) {
  const r = service.get(name); if (!r.enabled) throw Error('SKILL_DISABLED');
  const safeDirectory = async (path: string) => {
    await mkdir(path, { recursive: true, mode: 0o700 }); const s = await lstat(path);
    if (s.isSymbolicLink() || !s.isDirectory()) throw Error('UNSAFE_SKILL_RESOURCE_DIRECTORY');
  };
  const parent = join(project, '.materialsx'); await safeDirectory(parent);
  const root = join(parent, 'skill-resources'); await safeDirectory(root);
  const path = join(root, name + '-' + r.sha256.slice(0, 12));
  try {
    const s = await lstat(path); if (s.isSymbolicLink() || !s.isDirectory()) throw Error('UNSAFE_SKILL_RESOURCE_DIRECTORY');
    for (const f of r.files) await readOwnedBytes(root, join(path, f.path), f.sha256, 2 * 1024 * 1024, true);
    return { directory: path, files: r.files.map(f => f.path), scriptsExecuted: false, dependenciesInstalled: false };
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const stage = join(root, '.prepare-' + randomUUID()); await mkdir(stage, { mode: 0o700 });
  try {
    for (const f of r.files) { signal.throwIfAborted(); const bytes = await service.bytes(name, f.path), target = join(stage, f.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); }
    signal.throwIfAborted(); await rename(stage, path);
  } finally { await rm(stage, { recursive: true, force: true }); }
  return { directory: path, files: r.files.map(f => f.path), scriptsExecuted: false, dependenciesInstalled: false };
}
