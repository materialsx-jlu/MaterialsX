import { execFile } from 'node:child_process';
import { cp, copyFile, mkdir, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { SkillInstallationService } from '../packages/skills/src/installation-service.js';

// Development-only local test. The upstream CC BY-NC-SA content must not enter Git or release resources.
const REPO = 'https://github.com/HKUSTDial/Supervisor-Skills.git';
const REVISION = '207bc6f7a1aa107e544099c2c7cc86816fba9628';
const names = [
  'idea-evaluator', 'deep-research', 'vibe-research-workflow',
  'tech-paper-template', 'intro-drafter', 'paper-writer',
  'benchmark-paper-template', 'paper-polish', 'pre-submission-reviewer',
  'figure-designer', 'rebuttal-guidance', 'drawio-reconstruction',
];
const exec = promisify(execFile);
const root = process.cwd();
const upstream = resolve(root, 'runtime/supervisor-skills-upstream');
const packages = resolve(root, 'runtime/supervisor-skills-local-packages');
const userDataFlag = process.argv.indexOf('--user-data');
const userData = userDataFlag >= 0 && process.argv[userDataFlag + 1]
  ? resolve(process.argv[userDataFlag + 1]!)
  : process.platform === 'darwin' ? join(homedir(), 'Library/Application Support/MaterialsX') : null;
if (!userData) throw Error('Pass --user-data with the local MaterialsX user data directory.');

try { await access(upstream); }
catch { await mkdir(resolve(root, 'runtime'), { recursive: true }); await exec('git', ['clone', '--depth', '1', REPO, upstream]); }
const { stdout } = await exec('git', ['-C', upstream, 'rev-parse', 'HEAD']);
if (stdout.trim() !== REVISION) {
  await exec('git', ['-C', upstream, 'fetch', '--depth', '1', 'origin', REVISION]);
  await exec('git', ['-C', upstream, 'checkout', '--detach', REVISION]);
}
await mkdir(packages, { recursive: true });
const service = new SkillInstallationService(userData, () => []);
await service.restore();
const results: Array<{ name: string; installed: boolean }> = [];
for (const name of names) {
  const source = join(upstream, 'skills', name);
  await access(join(source, 'SKILL.md'));
  const local = join(packages, name);
  await cp(source, local, { recursive: true, force: true });
  await copyFile(join(upstream, 'LICENSE'), join(local, 'LICENSE.source'));
  const result = await service.install(local, AbortSignal.timeout(120_000));
  results.push({ name, installed: result.enabled });
}
process.stdout.write(JSON.stringify({ revision: REVISION, userData, skills: results }, null, 2) + '\n');
