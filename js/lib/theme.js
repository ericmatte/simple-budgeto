// Light is the default, and the only stored value is an explicit choice away
// from it. index.html applies the stored one before first paint; this module
// just reads and flips it.

const KEY = 'budgeto.theme';
const DEFAULT = 'light';

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : DEFAULT;
}

function setTheme(theme) {
  const next = theme === 'dark' ? 'dark' : DEFAULT;
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* private mode: this session only */ }
  return next;
}

export function toggleTheme() {
  return setTheme(currentTheme() === 'light' ? 'dark' : 'light');
}
