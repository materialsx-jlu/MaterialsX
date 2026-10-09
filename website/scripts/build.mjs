import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locales, renderPage } from '../src/render.mjs';
import { release } from '../src/release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const rawBase = process.env.SITE_BASE_PATH || '/';
const base = rawBase.startsWith('/') ? rawBase : `/${rawBase}`;
if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(base)) {
  throw new Error('SITE_BASE_PATH must be a URL path ending in /, for example / or /MaterialsX/');
}
const rawOrigin = process.env.SITE_ORIGIN?.trim() || '';
if (rawOrigin && !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(rawOrigin)) {
  throw new Error('SITE_ORIGIN must be an HTTPS origin without a path, for example https://materialsx.example');
}

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
await cp(path.join(root, 'public', 'images'), path.join(output, 'images'), { recursive: true });
await cp(path.join(root, 'src', 'styles.css'), path.join(output, 'assets', 'styles.css'));
await cp(path.join(root, 'src', 'showcase.css'), path.join(output, 'assets', 'showcase.css'));
await cp(path.join(root, 'src', 'architecture.css'), path.join(output, 'assets', 'architecture.css'));
await cp(path.join(root, 'src', 'site.js'), path.join(output, 'assets', 'site.js'));
await mkdir(path.join(output, 'releases'), { recursive: true });
await writeFile(path.join(output, 'releases', `${release.channel}.json`), `${JSON.stringify(release)}\n`);

for (const locale of locales) {
  const directory = path.join(output, locale.code);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), renderPage(locale, { base, origin: rawOrigin }), 'utf8');
}

const languageRoutes = JSON.stringify(Object.fromEntries(locales.map(({ code }) => [code, `${base}${code}/`])));
const fallbackLinks = locales.map(({ code, name }) => `<a href="${base}${code}/">${name}</a>`).join(' · ');
const landing = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MaterialsX</title><link rel="icon" href="${base}images/materialsx-icon.png" type="image/png">
<script>const routes=${languageRoutes};const languages=navigator.languages||[navigator.language||''];const preferred=languages.map(x=>x.toLowerCase()).find(Boolean)||'en';const locale=preferred.startsWith('ja')?'ja':(preferred.startsWith('zh')?(preferred.includes('tw')||preferred.includes('hk')||preferred.includes('mo')||preferred.includes('hant')?'zh-TW':'zh-CN'):'en');location.replace(routes[locale]+location.hash);</script>
<noscript><meta http-equiv="refresh" content="0;url=${base}zh-CN/"></noscript></head><body><p>MaterialsX: ${fallbackLinks}</p></body></html>\n`;
await writeFile(path.join(output, 'index.html'), landing, 'utf8');
await writeFile(path.join(output, '404.html'), landing, 'utf8');
await writeFile(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\n${rawOrigin ? `Sitemap: ${rawOrigin}${base}sitemap.xml\n` : ''}`, 'utf8');
if (rawOrigin) {
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locales.map(({ code }) => `<url><loc>${rawOrigin}${base}${code}/</loc></url>`).join('')}</urlset>`;
  await writeFile(path.join(output, 'sitemap.xml'), sitemap, 'utf8');
}
console.log(`Built MaterialsX website: ${locales.length} languages in ${path.relative(root, output)}/ (base ${base})`);
