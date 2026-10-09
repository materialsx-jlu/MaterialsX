import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseManifest } from '../deploy/config-schema.mjs';
import { renderPreview } from '../deploy/render.mjs';

function options(argv) {
  const result = { manifest: 'deploy/examples/development.yaml', out: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--manifest' && flag !== '--out') throw Error('USAGE_INVALID');
    const next = argv[++i];
    if (!next || next.startsWith('--')) throw Error('USAGE_INVALID');
    result[flag.slice(2)] = next;
  }
  return result;
}

try {
  const { manifest, out } = options(process.argv.slice(2));
  const source = await readFile(resolve(manifest), 'utf8');
  const preview = renderPreview(parseManifest(source));
  const serialized = JSON.stringify(preview, null, 2) + '\n';
  if (out) await writeFile(resolve(out), serialized, { flag: 'wx', mode: 0o600 });
  process.stdout.write(serialized);
} catch (error) {
  // Input values, YAML parser diagnostics and secrets are never echoed.
  const message = error instanceof Error ? error.message : 'CONFIG_CHECK_FAILED';
  const code = /^(?:MANIFEST_|PUBLIC_|DEVELOPMENT_|INTERNAL_|STABLE_|PRODUCTION_|PAYMENT_|ROUTE_|USAGE_)/.test(message)
    ? message : 'CONFIG_CHECK_FAILED';
  process.stderr.write(JSON.stringify({ ok: false, error: code }) + '\n');
  process.exitCode = 1;
}
