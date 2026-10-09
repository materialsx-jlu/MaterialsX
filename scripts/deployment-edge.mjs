import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { parseManifest } from '../deploy/config-schema.mjs';
import { renderEdgeNginx } from '../deploy/edge-nginx.mjs';

function options(argv) {
  if ((argv.length !== 4 && argv.length !== 5) || argv[0] !== '--manifest' || argv[2] !== '--out-dir' ||
      !argv[1] || !argv[3] || (argv.length === 5 && argv[4] !== '--existing-nginx')) throw Error('USAGE_INVALID');
  return { manifest: resolve(argv[1]), out: resolve(argv[3]), existingNginx: argv.length === 5 };
}

try {
  const { manifest, out, existingNginx } = options(process.argv.slice(2));
  const rendered = renderEdgeNginx(parseManifest(await readFile(manifest, 'utf8')), {
    includeDefaultServer: !existingNginx,
  });
  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  await mkdir(out, { mode: 0o700 });
  await writeFile(join(out, 'materialsx-edge.conf'), rendered.config, { flag: 'wx', mode: 0o600 });
  await writeFile(join(out, 'admin-allow.conf'), rendered.adminAllow, { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ ok: true, files: ['materialsx-edge.conf', 'admin-allow.conf'], live: false }) + '\n');
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  const code = /^(?:MANIFEST_|PUBLIC_|DEVELOPMENT_|INTERNAL_|STABLE_|PRODUCTION_|PAYMENT_|ROUTE_|EDGE_|USAGE_)/.test(message)
    ? message : 'EDGE_RENDER_FAILED';
  process.stderr.write(JSON.stringify({ ok: false, error: code }) + '\n');
  process.exitCode = 1;
}
