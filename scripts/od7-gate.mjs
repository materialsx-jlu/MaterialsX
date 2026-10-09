import { readFile, stat, open, mkdir } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { evaluateGate, loadManifest, stages } from '../deploy/od7-gate.mjs';

function argumentsOf(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!['stage', 'manifest', 'production-manifest', 'evidence', 'previous', 'out'].includes(key) ||
      !args[i]?.startsWith('--') || !args[i + 1] || args[i + 1].startsWith('--') || options[key]) throw Error('OD7_USAGE_INVALID');
    options[key] = args[i + 1];
  }
  if (!stages.includes(options.stage) || !options.manifest || !options.evidence || !options.out ||
    (options.stage === 'staging') !== !!options['production-manifest'] ||
    (options.stage !== 'staging' && options.stage !== 'direct-read-only') !== !!options.previous) throw Error('OD7_USAGE_INVALID');
  return options;
}
async function privateJson(path) {
  const file = resolve(path), info = await stat(file);
  if (!info.isFile() || info.size > 256 * 1024 || info.mode & 0o077) throw Error('OD7_PRIVATE_INPUT_REQUIRED');
  return JSON.parse(await readFile(file, 'utf8'));
}

try {
  const args = argumentsOf(process.argv.slice(2));
  const out = resolve(args.out), repo = resolve(import.meta.dirname, '..');
  if (out === repo || out.startsWith(repo + sep)) throw Error('OD7_OUTPUT_OUTSIDE_REPOSITORY_REQUIRED');
  const [manifest, productionManifest, evidence, previous] = await Promise.all([
    loadManifest(args.manifest),
    args['production-manifest'] ? loadManifest(args['production-manifest']) : null,
    privateJson(args.evidence), args.previous ? privateJson(args.previous) : null,
  ]);
  const report = await evaluateGate({ stage: args.stage, manifest, productionManifest, evidence, previous });
  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  if ((await stat(dirname(out))).mode & 0o077) throw Error('OD7_OUTPUT_DIRECTORY_NOT_PRIVATE');
  const handle = await open(out, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(report, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  console.log(JSON.stringify({ stage: report.stage, status: report.status, receiptCount: report.receiptDigests.length, report: out }));
} catch (error) {
  const code = error instanceof Error && /^OD7_[A-Z_]+/.test(error.message) ? error.message.split(':')[0] : 'OD7_GATE_FAILED';
  console.error(JSON.stringify({ status: 'blocked', code }));
  process.exitCode = 1;
}
