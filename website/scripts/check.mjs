import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locales, renderPage, releaseTag, releaseUrl, releaseAssets, releaseAssetUrl } from '../src/render.mjs';
import { researchContent } from '../src/research-content.mjs';
import { architectureContent } from '../src/architecture-content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shape = (value) => Array.isArray(value)
  ? value.map(shape)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shape(entry)]))
    : typeof value;
const expectedShape = shape(locales[0]);
const expectedResearchShape = shape(researchContent['zh-CN']);
const expectedArchitectureShape = shape(architectureContent['zh-CN']);

for (const locale of locales) {
  assert.deepEqual(shape(locale), expectedShape, `translation keys differ: ${locale.code}`);
  assert.deepEqual(shape(researchContent[locale.code]), expectedResearchShape, `research copy differs: ${locale.code}`);
  assert.deepEqual(shape(architectureContent[locale.code]), expectedArchitectureShape, `architecture copy differs: ${locale.code}`);
  assert.equal(researchContent[locale.code].tasks.cards.length, 6, `${locale.code}: expected six starter tasks`);
  assert.equal(researchContent[locale.code].tasks.stages.length, 6, `${locale.code}: expected six research stages`);
  assert.equal(locale.htmlLang, locale.code === 'zh-TW' ? 'zh-Hant' : locale.code);
  const html = renderPage(locale, { base: '/', origin: '' });
  assert.ok(!html.includes('undefined'), `${locale.code}: missing translation`);
  assert.ok(!/\/Users\//.test(html), `${locale.code}: local path leaked`);
  assert.ok(html.includes(releaseUrl), `${locale.code}: public release link missing`);
  assert.deepEqual(locale.download.cards.map((card) => card.asset), ['macos', 'windows', ''], `${locale.code}: installer cards differ`);
  for (const asset of Object.values(releaseAssets)) {
    assert.ok(asset.name.includes(releaseTag.slice(1)), `${locale.code}: installer version differs from release tag`);
    assert.ok(html.includes(`href="${releaseAssetUrl(asset.name)}"`), `${locale.code}: ${asset.name} download missing`);
  }
  assert.equal((html.match(/class="platform-download"/g) || []).length, 2, `${locale.code}: expected two direct installer buttons`);
  assert.ok(html.includes(`href="${releaseAssetUrl('SHA256SUMS.txt')}"`), `${locale.code}: checksum link missing`);
  for (const id of ['research-tasks', 'features', 'process', 'architecture', 'potentials', 'moos', 'local', 'gallery', 'download', 'start', 'faq']) {
    assert.ok(html.includes(`id="${id}"`), `${locale.code}: section ${id} missing`);
  }
  assert.ok(html.includes('0.3.0-preview.1'), `${locale.code}: public preview version missing`);
  assert.ok(html.includes('/assets/architecture.css'), `${locale.code}: architecture styles missing`);
  assert.ok(!/sk-[A-Za-z0-9]{12,}/.test(html), `${locale.code}: upstream key leaked`);
}

for (const image of ['materialsx-icon.png', 'workbench.png', 'skills.png', 'atomic-3d.png', 'research-tasks.png', 'potentials-catalog.png', 'moos-mcp.png', 'local-model-settings.png']) {
  assert.ok((await stat(path.join(root, 'public', 'images', image))).size > 1000, `${image}: image missing or empty`);
}

execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' });
for (const { code } of locales) {
  const html = await readFile(path.join(root, 'dist', code, 'index.html'), 'utf8');
  assert.ok(html.includes(`lang="${code === 'zh-TW' ? 'zh-Hant' : code}"`));
  assert.ok(html.includes('/assets/styles.css'));
  assert.ok(html.includes('/assets/showcase.css'));
  assert.ok(html.includes('/assets/architecture.css'));
}
execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], {
  cwd: root,
  env: { ...process.env, SITE_BASE_PATH: '/MaterialsX/', SITE_ORIGIN: 'https://example.org' },
  stdio: 'inherit',
});
const nested = await readFile(path.join(root, 'dist', 'ja', 'index.html'), 'utf8');
assert.ok(nested.includes('https://example.org/MaterialsX/ja/'));
assert.ok(nested.includes('/MaterialsX/assets/styles.css'));
assert.ok(nested.includes('/MaterialsX/assets/showcase.css'));
assert.ok(nested.includes('/MaterialsX/assets/architecture.css'));
assert.ok(nested.includes('/MaterialsX/images/materialsx-icon.png'));
await stat(path.join(root, 'dist', 'sitemap.xml'));
execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' });
console.log('Website checks passed: four locales, release status, images, base path and static output.');
