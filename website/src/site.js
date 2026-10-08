const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('.main-nav');
const languageSwitch = document.querySelector('#language-switch');

function closeMenu() {
  menu?.classList.remove('is-open');
  menuButton?.setAttribute('aria-expanded', 'false');
}

menuButton?.addEventListener('click', () => {
  const opened = menu.classList.toggle('is-open');
  menuButton.setAttribute('aria-expanded', String(opened));
});
menu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenu();
});
languageSwitch?.addEventListener('change', () => {
  window.location.assign(`${languageSwitch.value}${window.location.hash}`);
});

const tabs = [...document.querySelectorAll('[data-gallery-tab]')];
function selectTab(nextTab, shouldFocus = false) {
  for (const tab of tabs) {
    const active = tab === nextTab;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    const panel = document.getElementById(`gallery-panel-${tab.dataset.galleryTab}`);
    if (panel) panel.hidden = !active;
  }
  if (shouldFocus) nextTab.focus();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[next], true);
  });
}
