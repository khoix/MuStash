export function initTheme() {
  const saved = localStorage.getItem('mustash-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;

  const themeToggle = document.getElementById('themeToggle');
  const menuToggle = document.getElementById('menuToggle');
  const appMenu = document.getElementById('appMenu');

  syncThemeControl(themeToggle);

  themeToggle?.addEventListener('click', () => {
    const current = resolvedTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('mustash-theme', next);
    syncThemeControl(themeToggle);
  });

  menuToggle?.addEventListener('click', () => {
    const open = appMenu?.hidden ?? true;
    if (appMenu) appMenu.hidden = !open;
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });

  document.addEventListener('click', (event) => {
    if (!appMenu || appMenu.hidden || !menuToggle) return;
    if (appMenu.contains(event.target) || menuToggle.contains(event.target)) return;
    closeMenu(menuToggle, appMenu);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && appMenu && !appMenu.hidden && menuToggle) {
      closeMenu(menuToggle, appMenu);
      menuToggle.focus();
    }
  });
}

function syncThemeControl(toggle) {
  if (!toggle) return;
  const dark = resolvedTheme() === 'dark';
  toggle.setAttribute('aria-pressed', String(dark));
  const label = toggle.querySelector('.menu-copy strong');
  const detail = toggle.querySelector('.menu-copy small');
  if (label) label.textContent = dark ? 'Dark mode' : 'Dark mode';
  if (detail) detail.textContent = dark ? 'On' : 'Off';
}

function closeMenu(toggle, menu) {
  menu.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open menu');
}

function resolvedTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
