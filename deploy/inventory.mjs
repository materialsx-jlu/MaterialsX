import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const areas = {
  desktop: ['apps/desktop/main', 'packages/control-plane-client/src'],
  goApiAndPayments: ['services/control-plane/cmd', 'services/control-plane/internal'],
  billingWeb: ['apps/billing-admin'],
  liteLLM: ['services/litellm', 'services/litellm-console'],
  moosAndResearch: ['packages/agent/src/team', 'packages/agent/src/papers', 'scripts/agent/ua13-server.ts', '../MOOS/services/materials-mcp/src'],
  website: ['website/scripts', 'website/src'],
};
const skipped = new Set(['node_modules', 'dist', 'runtime', '.git', 'testdata', '__pycache__']);
const source = /\.(?:ts|mjs|js|go|vue)$/;

export function scanText(text) {
  const variables = new Set();
  for (const pattern of [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
    /(?:os\.Getenv|os\.LookupEnv|env)\(['"]([A-Z][A-Z0-9_]*)['"]/g,
  ]) for (const match of text.matchAll(pattern)) variables.add(match[1]);
  const hosts = new Set();
  for (const match of text.matchAll(/https?:\/\/[^\s"'`<>\\]+/g)) {
    try {
      const url = new URL(match[0]);
      if (!url.hostname.includes('${') && !url.username && !url.password) hosts.add(url.origin);
    } catch { /* Dynamic URLs are reported through their environment variable. */ }
  }
  for (const match of text.matchAll(/\b(?:127\.0\.0\.1|localhost):[1-9][0-9]{1,4}\b/g)) hosts.add('http://' + match[0]);
  return { variables: [...variables].sort(), origins: [...hosts].sort() };
}

async function filesAt(path) {
  let info;
  try { info = await stat(path); }
  catch { return null; }
  if (info.isFile()) return source.test(path) ? [path] : [];
  if (!info.isDirectory()) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skipped.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await filesAt(child) ?? []));
    else if (entry.isFile() && source.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(child);
  }
  return files;
}

export async function inventory(root) {
  const result = { schemaVersion: 'od0-inventory-v1', areas: {}, missingOptionalSources: [] };
  for (const [area, paths] of Object.entries(areas)) {
    const env = new Set(), origins = new Set();
    let filesScanned = 0;
    for (const path of paths) {
      const files = await filesAt(join(root, path));
      if (files === null) { result.missingOptionalSources.push(path); continue; }
      for (const file of files) {
        const content = await readFile(file, 'utf8');
        if (content.length > 1024 * 1024) continue;
        filesScanned++;
        const found = scanText(content);
        for (const variable of found.variables) env.add(variable);
        for (const origin of found.origins) origins.add(origin);
      }
    }
    result.areas[area] = { filesScanned, variableNames: [...env].sort(), observedOrigins: [...origins].sort() };
  }
  result.missingOptionalSources = [...new Set(result.missingOptionalSources)].sort();
  return result;
}
