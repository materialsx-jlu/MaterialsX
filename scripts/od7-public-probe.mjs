import { open, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { loadManifest } from '../deploy/od7-gate.mjs';
import { probeTopology } from '../deploy/od7-probe.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--manifest' || args[2] !== '--out') throw Error('OD7_USAGE_INVALID');
  const out = resolve(args[3]), repo = resolve(import.meta.dirname, '..');
  if (out === repo || out.startsWith(repo + sep)) throw Error('OD7_OUTPUT_OUTSIDE_REPOSITORY_REQUIRED');
  const report = await probeTopology(await loadManifest(args[1]));
  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  if ((await stat(dirname(out))).mode & 0o077) throw Error('OD7_OUTPUT_DIRECTORY_NOT_PRIVATE');
  const handle = await open(out, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(report, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  console.log(JSON.stringify({ passed: report.passed, checkedAt: report.checkedAt, checks: report.items }));
  if (!report.passed) process.exitCode = 2;
} catch (error) {
  const code = error instanceof Error && /^OD7_[A-Z_]+/.test(error.message) ? error.message : 'OD7_PROBE_FAILED';
  console.error(JSON.stringify({ passed: false, code }));
  process.exitCode = 1;
}
