export function initTheme() {
  const saved = localStorage.getItem('mustash-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const current = resolvedTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('mustash-theme', next);
  });
}

function resolvedTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
