import zhCN from './i18n/zh-CN.mjs';
import zhTW from './i18n/zh-TW.mjs';
import en from './i18n/en.mjs';
import ja from './i18n/ja.mjs';
import { researchContent } from './research-content.mjs';
import { architectureContent } from './architecture-content.mjs';
import { release, releaseTag, releaseUrl, releaseAssets, releaseAssetUrl } from './release.mjs';

export const locales = [zhCN, zhTW, en, ja];
export { releaseTag, releaseUrl, releaseAssets, releaseAssetUrl };
const repositoryUrl = 'https://github.com/materialsx-jlu/MaterialsX';
const securityUrl = 'mailto:huzhangyou@jlu.edu.cn?subject=MaterialsX%20security%20report';

const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const arrow = '<span aria-hidden="true">↗</span>';
const sectionHead = (eyebrow, title, description = '') => `
  <div class="section-head">
    <p class="eyebrow">${esc(eyebrow)}</p>
    <h2>${esc(title)}</h2>
    ${description ? `<p class="section-description">${esc(description)}</p>` : ''}
  </div>`;

function navigation(t, base) {
  const links = [
    ['research-tasks', researchContent[t.code].nav], ['features', t.nav.product],
    ['architecture', architectureContent[t.code].nav], ['gallery', t.nav.gallery], ['download', t.nav.download],
  ];
  return `<header class="site-header" id="top">
    <div class="announcement"><span class="announcement-dot" aria-hidden="true"></span>${esc(t.topbar)}</div>
    <div class="nav-shell container">
      <a class="brand" href="${base}${t.code}/" aria-label="MaterialsX"><img src="${base}images/materialsx-icon.png" width="38" height="38" alt=""><span>MaterialsX</span></a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="main-nav" aria-label="${esc(t.nav.menu)}"><span></span><span></span><span></span></button>
      <nav class="main-nav" id="main-nav" aria-label="${esc(t.nav.menu)}">
        ${links.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join('')}
      </nav>
      <div class="nav-actions">
        <label class="sr-only" for="language-switch">${esc(t.nav.language)}</label>
        <select id="language-switch" class="language-switch" aria-label="${esc(t.nav.language)}">
          ${locales.map((item) => `<option value="${base}${item.code}/" ${item.code === t.code ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
        </select>
        <a class="nav-cta" href="#download">${esc(t.nav.download)} <span aria-hidden="true">↗</span></a>
      </div>
    </div>
  </header>`;
}

function hero(t, base) {
  return `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-grid container">
      <div class="hero-copy">
        <p class="eyebrow hero-eyebrow"><span class="eyebrow-rule"></span>${esc(t.hero.eyebrow)}</p>
        <h1 id="hero-title">${esc(t.hero.title)}<br><em>${esc(t.hero.highlight)}</em></h1>
        <p class="hero-description">${esc(t.hero.description)}</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#research-tasks">${esc(researchContent[t.code].nav)} <span aria-hidden="true">→</span></a>
          <a class="button button-ghost" href="#download">${esc(t.hero.secondary)} <span aria-hidden="true">↗</span></a>
        </div>
        <p class="hero-note"><span aria-hidden="true">✳</span> ${esc(t.hero.note)}</p>
      </div>
      <div class="hero-art">
        <div class="hero-art-grid" aria-hidden="true"></div>
        <div class="hero-orbit hero-orbit-one" aria-hidden="true"></div>
        <div class="hero-orbit hero-orbit-two" aria-hidden="true"></div>
        <figure class="hero-window">
          <div class="window-chrome"><span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>MaterialsX / Research workspace</span><span class="window-index">01 — 03</span></div>
          <img src="${base}images/research-tasks.png" width="2960" height="1880" alt="${esc(researchContent[t.code].tasks.imageAlt)}" fetchpriority="high">
          <figcaption>${esc(researchContent[t.code].tasks.imageCaption)}</figcaption>
        </figure>
        <div class="hero-coordinate" aria-hidden="true">MX / 2026</div>
      </div>
    </div>
    <div class="metric-wrap container" aria-label="${esc(t.a11y.metrics)}">
      ${t.metrics.map((metric, index) => `<div class="metric"><span class="metric-index">0${index + 1}</span><strong>${esc(metric.value)}</strong><span>${esc(metric.label)}</span></div>`).join('')}
    </div>
  </section>`;
}

function researchTasks(t, base) {
  const copy = researchContent[t.code].tasks;
  return `<section class="research-tasks section" id="research-tasks"><div class="container">
    ${sectionHead(copy.eyebrow, copy.title, copy.lead)}
    <div class="task-showcase">
      <div class="task-main">
        <div class="task-guide"><span class="task-guide-icon" aria-hidden="true">?</span><div><h3>${esc(copy.guideTitle)}</h3><p>${esc(copy.guide)}</p></div></div>
        <div class="task-stage-head"><div><h3>${esc(copy.stageTitle)}</h3><p>${esc(copy.stageNote)}</p></div><span>${esc(copy.count)}</span></div>
        <div class="task-stages" aria-label="${esc(copy.stageTitle)}">${copy.stages.map((stage, index) => `<span class="task-stage ${index === 0 ? 'is-current' : ''}">${esc(stage)}</span>`).join('')}</div>
        <div class="task-cards">${copy.cards.map(([title, detail, hint], index) => `<article class="task-card"><span class="task-card-number">0${index + 1}</span><div><h4>${esc(title)}</h4><p>${esc(detail)}</p><small>${esc(hint)}</small></div><span class="task-card-arrow" aria-hidden="true">↗</span></article>`).join('')}</div>
        <p class="task-foot">${esc(copy.foot)}</p>
      </div>
      <figure class="task-figure"><img src="${base}images/research-tasks.png" width="2960" height="1880" loading="lazy" alt="${esc(copy.imageAlt)}"><figcaption>${esc(copy.imageCaption)}</figcaption></figure>
    </div>
    <ol class="task-flow">${copy.flow.map((step, index) => `<li><span>0${index + 1}</span>${esc(step)}</li>`).join('')}</ol>
    <nav class="task-next" aria-label="${esc(researchContent[t.code].nav)}">${['potentials', 'moos', 'local'].map((id) => `<a href="#${id}">${esc(researchContent[t.code][id].link)} <span aria-hidden="true">↗</span></a>`).join('')}</nav>
  </div></section>`;
}

function capabilityStory(t, base, id, image, number) {
  const copy = researchContent[t.code][id];
  return `<section class="capability-story section story-${id}" id="${id}"><div class="container">
    <div class="story-grid">
      <div class="story-copy"><span class="story-number">${number} / 03</span>${sectionHead(copy.eyebrow, copy.title, copy.description)}
        <ol class="story-steps">${copy.steps.map((step, index) => `<li><span>0${index + 1}</span><p>${esc(step)}</p></li>`).join('')}</ol>
        <p class="story-note"><span aria-hidden="true">ⓘ</span>${esc(copy.note)}</p>
      </div>
      <figure class="story-figure"><img src="${base}images/${image}" width="3456" height="1980" loading="lazy" alt="${esc(copy.imageAlt)}"><figcaption>${esc(copy.imageCaption)}</figcaption></figure>
    </div>
  </div></section>`;
}

function intro(t) {
  return `<section class="intro section" id="product">
    <div class="container intro-grid">
      <div>${sectionHead(t.intro.eyebrow, t.intro.title, t.intro.description)}</div>
      <div class="pillar-list">${t.pillars.map((pillar) => `<article class="pillar"><span class="pillar-number">${esc(pillar.number)}</span><div><h3>${esc(pillar.title)}</h3><p>${esc(pillar.description)}</p></div><span class="pillar-arrow" aria-hidden="true">↗</span></article>`).join('')}</div>
    </div>
  </section>`;
}

function process(t) {
  return `<section class="process section" id="process"><div class="container">
    ${sectionHead(t.process.eyebrow, t.process.title, t.process.description)}
    <div class="process-grid">${t.process.steps.map((step) => `<article class="process-step"><div class="step-top"><span>${esc(step.number)}</span><span class="step-marker" aria-hidden="true"></span></div><h3>${esc(step.title)}</h3><p>${esc(step.description)}</p></article>`).join('')}</div>
  </div></section>`;
}

function architecture(t) {
  const a = architectureContent[t.code];
  return `<section class="architecture section" id="architecture"><div class="container">
    ${sectionHead(a.eyebrow, a.title, a.lead)}
    <div class="architecture-map" aria-label="${esc(a.title)}">${a.nodes.map((node) => `<article class="architecture-node"><span class="architecture-tag">${esc(node.tag)}</span><h3>${esc(node.title)}</h3><p>${esc(node.body)}</p><span class="architecture-meta">${esc(node.meta)}</span></article>`).join('')}</div>
    <div class="architecture-bottom">
      <div class="architecture-flow"><h3>${esc(a.flowTitle)}</h3><ol>${a.flow.map((step, index) => `<li><span class="architecture-flow-index">0${index + 1}</span><div><h4>${esc(step.title)}</h4><p>${esc(step.body)}</p></div></li>`).join('')}</ol></div>
      <div class="architecture-aside"><h3>${esc(a.boundaryTitle)}</h3><ul>${a.boundaries.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
    </div>
    <div class="architecture-pricing"><div><h3>${esc(a.price.title)}</h3><p>${esc(a.price.lead)}</p></div><div class="architecture-table-wrap"><table><thead><tr><th scope="col">${esc(a.price.model)}</th><th scope="col">${esc(a.price.rate)}</th><th scope="col">${esc(a.price.state)}</th></tr></thead><tbody>${a.price.rows.map(([model, rate, state]) => `<tr><th scope="row">${esc(model)}</th><td>${esc(rate)}</td><td><span class="architecture-state architecture-state-${esc(state)}">${esc(a.price.states[state])}</span></td></tr>`).join('')}</tbody></table></div><p class="architecture-price-foot">${esc(a.price.foot)}</p></div>
    <p class="architecture-status"><span aria-hidden="true">ⓘ</span>${esc(a.status)}</p>
  </div></section>`;
}

function features(t) {
  return `<section class="features section" id="features"><div class="container">
    ${sectionHead(t.features.eyebrow, t.features.title, t.features.description)}
    <div class="feature-grid">${t.features.cards.map((card, index) => `<article class="feature-card ${index === 0 || index === 3 ? 'feature-card-wide' : ''}">
      <div class="feature-card-top"><span class="feature-symbol" aria-hidden="true">${['◇', '✳', '⌘', '◈', '⟡', '◎'][index]}</span><span class="feature-tag">${esc(card.tag)}</span></div>
      <div><h3>${esc(card.title)}</h3><p>${esc(card.description)}</p></div>
      <div class="feature-foot"><span class="feature-foot-line" aria-hidden="true"></span>${esc(card.foot)}</div>
    </article>`).join('')}</div>
  </div></section>`;
}

function gallery(t, base) {
  const images = {workbench: 'workbench.png', skills: 'skills.png', atomic: 'atomic-3d.png'};
  return `<section class="gallery section" id="gallery"><div class="container">
    ${sectionHead(t.gallery.eyebrow, t.gallery.title, t.gallery.description)}
    <div class="gallery-shell">
      <div class="gallery-tabs" role="tablist" aria-label="${esc(t.nav.gallery)}">${t.gallery.tabs.map((tab, index) => `<button type="button" class="gallery-tab" role="tab" id="gallery-tab-${tab.id}" aria-controls="gallery-panel-${tab.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? '0' : '-1'}" data-gallery-tab="${tab.id}"><span>0${index + 1}</span>${esc(tab.label)}</button>`).join('')}</div>
      ${t.gallery.tabs.map((tab, index) => `<div class="gallery-panel" role="tabpanel" id="gallery-panel-${tab.id}" aria-labelledby="gallery-tab-${tab.id}" ${index ? 'hidden' : ''}>
        <div class="gallery-image-frame"><img src="${base}images/${images[tab.id]}" width="1480" height="940" loading="lazy" alt="${esc(tab.imageAlt)}"></div>
        <div class="gallery-caption"><span class="gallery-caption-index">0${index + 1} / 0${t.gallery.tabs.length}</span><div><h3>${esc(tab.title)}</h3><p>${esc(tab.description)}</p></div></div>
      </div>`).join('')}
    </div>
  </div></section>`;
}

function download(t) {
  const available = { 'zh-CN': '可下载', 'zh-TW': '可下載', en: 'available', ja: 'ダウンロード可能' }[t.code];
  const stableDetail = { 'zh-CN': '请核对安装包架构和 SHA-256，安装前查看发布说明。', 'zh-TW': '請核對安裝檔架構與 SHA-256，安裝前查看發行說明。', en: 'Check the installer architecture, SHA-256 and release notes before installing.', ja: 'インストール前に構成、SHA-256 とリリースノートを確認してください。' }[t.code];
  return `<section class="download section" id="download"><div class="container">
    <div class="download-head">${sectionHead(t.download.eyebrow, t.download.title, t.download.description)}
      <div class="download-actions"><a class="button button-primary" href="${releaseUrl}" target="_blank" rel="noopener noreferrer">${esc(t.download.link)} ${arrow}</a><a class="button button-outline" href="#start">${esc(t.download.guide)} <span aria-hidden="true">↓</span></a></div>
    </div>
    <div class="platform-grid">${t.download.cards.map((card) => {
      const asset = releaseAssets[card.asset];
      return `<article class="platform-card"><div class="platform-heading"><span class="platform-icon" aria-hidden="true">${card.platform === 'macOS' ? '⌘' : card.platform === 'Windows' ? '⊞' : '⌁'}</span><div><h3>${esc(card.platform)}</h3><span>${esc(card.arch)}</span></div></div><p class="platform-status"><span class="status-dot" aria-hidden="true"></span>${esc(asset ? `${release.version} · ${available}` : card.status)}</p><p class="platform-detail">${esc(release.channel === 'stable' && asset ? stableDetail : card.detail)}</p>${asset ? `<div class="platform-file"><code>${esc(asset.name)}</code><span>${esc(asset.size)}</span></div><a class="platform-download" href="${releaseAssetUrl(asset.name)}" rel="noopener noreferrer" aria-label="${esc(card.action)} · ${esc(card.platform)} ${esc(card.arch)}">${esc(card.action)} <span aria-hidden="true">↓</span></a>` : ''}</article>`;
    }).join('')}</div>
    ${release.assets.length ? `<p class="download-verify">${esc(t.download.verify)} <a href="${releaseAssetUrl('SHA256SUMS.txt')}" target="_blank" rel="noopener noreferrer">${esc(t.download.checksums)} ${arrow}</a></p>` : `<p class="download-verify">${esc(t.download.withdrawn)}</p>`}
    <p class="download-note"><span aria-hidden="true">ⓘ</span> ${esc(t.download.note)}</p>
  </div></section>`;
}

function start(t) {
  return `<section class="start section" id="start"><div class="container start-grid">
    <div>${sectionHead(t.start.eyebrow, t.start.title)}
      <div class="start-steps">${t.start.steps.map((step, index) => `<article><span>0${index + 1}</span><div><h3>${esc(step.title)}</h3><p>${esc(step.description)}</p></div></article>`).join('')}</div>
    </div>
    <div class="example-panel"><div class="example-top"><span class="example-dots" aria-hidden="true">•••</span><span>${esc(t.start.exampleLabel)}</span></div><p>${esc(t.start.example)}</p><div class="example-bottom">MaterialsX <span aria-hidden="true">↗</span></div></div>
  </div></section>`;
}

function faq(t) {
  return `<section class="faq section" id="faq"><div class="container faq-grid"><div>${sectionHead(t.faq.eyebrow, t.faq.title)}</div><div class="faq-list">${t.faq.items.map((item) => `<details><summary>${esc(item.q)}<span aria-hidden="true">+</span></summary><p>${esc(item.a)}</p></details>`).join('')}</div></div></section>`;
}

function footer(t, base) {
  return `<footer class="site-footer"><div class="container footer-main">
    <div class="footer-brand"><a class="brand" href="${base}${t.code}/"><img src="${base}images/materialsx-icon.png" width="42" height="42" alt=""><span>MaterialsX</span></a><p>${esc(t.footer.tagline)}</p></div>
    <div class="footer-links"><div><h2>${esc(t.footer.product)}</h2><a href="#features">${esc(t.nav.product)}</a><a href="#process">${esc(t.nav.process)}</a><a href="#architecture">${esc(architectureContent[t.code].nav)}</a><a href="#gallery">${esc(t.nav.gallery)}</a></div><div><h2>${esc(t.footer.resources)}</h2><a href="${releaseUrl}" target="_blank" rel="noopener noreferrer">${esc(t.footer.release)}</a><a href="${repositoryUrl}" target="_blank" rel="noopener noreferrer">${esc(t.footer.repository)}</a><a href="${securityUrl}">${esc(t.footer.security)}</a></div></div>
  </div><div class="container footer-bottom"><span>${esc(t.footer.copyright)}</span><a href="#top">↑ ${esc(t.a11y.backToTop)}</a></div></footer>`;
}

export function renderPage(t, {base, origin}) {
  const pageUrl = origin ? `${origin}${base}${t.code}/` : '';
  const alternates = locales.map((locale) => `<link rel="alternate" hreflang="${locale.code}" href="${origin ? `${origin}${base}${locale.code}/` : `${base}${locale.code}/`}">`).join('\n');
  return `<!doctype html>
<html lang="${esc(t.htmlLang)}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#102630"><meta name="color-scheme" content="light">
  <title>${esc(t.meta.title)}</title><meta name="description" content="${esc(t.meta.description)}">
  <meta property="og:type" content="website"><meta property="og:title" content="${esc(t.meta.title)}"><meta property="og:description" content="${esc(t.meta.description)}"><meta property="og:image" content="${origin ? origin : ''}${base}images/materialsx-icon.png">
  ${pageUrl ? `<link rel="canonical" href="${pageUrl}">` : ''}
  ${alternates}<link rel="alternate" hreflang="x-default" href="${origin ? origin : ''}${base}zh-CN/">
  <link rel="icon" href="${base}images/materialsx-icon.png" type="image/png">
  <link rel="stylesheet" href="${base}assets/styles.css"><link rel="stylesheet" href="${base}assets/showcase.css"><link rel="stylesheet" href="${base}assets/architecture.css"><script src="${base}assets/site.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#content">${esc(t.a11y.skip)}</a>
  ${navigation(t, base)}
  <main id="content">${hero(t, base)}${researchTasks(t, base)}${intro(t)}${process(t)}${features(t)}${architecture(t)}${capabilityStory(t, base, 'potentials', 'potentials-catalog.png', '01')}${capabilityStory(t, base, 'moos', 'moos-mcp.png', '02')}${capabilityStory(t, base, 'local', 'local-model-settings.png', '03')}${gallery(t, base)}${download(t)}${start(t)}${faq(t)}</main>
  ${footer(t, base)}
</body>
</html>\n`;
}
