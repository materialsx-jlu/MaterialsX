import { readFileSync, writeFileSync } from 'node:fs';
import { fitLine } from './math.mjs';
const source = readFileSync(new URL('./Norris.dat', import.meta.url), 'utf8'), points = source.slice(source.lastIndexOf('Data:')).split(/\r?\n/).filter(l => /^\s*[-+\d.]+\s+[-+\d.]+\s*$/.test(l)).map(l => { const [y, x] = l.trim().split(/\s+/).map(Number); return { x, y }; });
if (points.length !== 36)
    throw Error('REFERENCE_ROWS_INVALID');
const { predict, ...fit } = fitLine(points);
const checks = [['slope', 1.00211681802045], ['intercept', -0.262323073774029], ['residualSd', 0.884796396144373], ['rSquared', 0.999993745883712]].map(([field, expected]) => ({ field, actual: fit[field], expected, error: Math.abs(fit[field] - expected) }));
if (checks.some(c => c.error > 1e-10))
    throw Error('REFERENCE_FAILED');
// A short wait demonstrates detached lifetime, not a material throughput benchmark.
await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(0, Number(process.argv[2] ?? 2))) * 1000));
writeFileSync('reference-result.json', JSON.stringify({ reference: 'NIST Norris', rows: 36, fit, checks, domainValidated: false, scientificStatus: 'needs_review' }, null, 2) + '\n');
console.log('NIST numerical reference finished; no material-domain validation.');
