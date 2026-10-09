import { resolve } from 'node:path';
import { inventory } from '../deploy/inventory.mjs';

try {
  process.stdout.write(JSON.stringify(await inventory(resolve('.')), null, 2) + '\n');
} catch {
  process.stderr.write(JSON.stringify({ ok: false, error: 'INVENTORY_SCAN_FAILED' }) + '\n');
  process.exitCode = 1;
}
