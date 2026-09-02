export const MN = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const MNL = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const DN = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export function money(n, decimals = 0) {
  const v = Number(n) || 0;
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('fr-CA', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).replace(/\s/g, '\u00a0') + '\u00a0$';
}

export function num0(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '−' : '') + Math.round(Math.abs(v)).toLocaleString('fr-CA').replace(/\s/g, '\u00a0');
}

export function compact(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  return (v < 0 ? '−' : '') + (a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1).replace('.0', '') + 'k' : Math.round(a));
}

export function ym(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

export function ymLabel(key) {
  const [y, m] = key.split('-');
  return MN[Number(m) - 1] + ' ' + y;
}

export function ymFull(key) {
  const [y, m] = key.split('-');
  return MNL[Number(m) - 1] + ' ' + y;
}

// "mardi 11 août 2026" from a 'YYYY-MM-DD' key. Built from the parts rather
// than `new Date(iso)`, which reads the string as UTC midnight and lands on
// the day before once it's rendered in a Québec timezone.
export function dateLabel(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''));
  if (!m) return 'Date inconnue';
  const [, y, mo, d] = m;
  const weekday = DN[new Date(Number(y), Number(mo) - 1, Number(d)).getDay()];
  return `${weekday} ${Number(d)} ${MNL[Number(mo) - 1]} ${y}`;
}

// "11 août" — compact enough for a table cell, and built from the parts for
// the same timezone reason as `dateLabel`.
export function shortDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''));
  if (!m) return '—';
  return `${Number(m[3])} ${MN[Number(m[2]) - 1]}`;
}

export function shift(key, n) {
  const [y, m] = key.split('-').map(Number);
  return ym(new Date(y, m - 1 + n, 1));
}

export function monthEnd(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m, 0);
  return key + '-' + String(d.getDate()).padStart(2, '0');
}

// "il y a 5 min" / "hier" / "le 3 mars". Relative while it is still useful
// to know how fresh something is, absolute once "il y a 47 jours" stops
// meaning anything.
export function relativeTime(iso, now = new Date()) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 0) return 'à l\'instant';
  if (seconds < 60) return 'à l\'instant';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return 'le ' + then.getDate() + ' ' + MNL[then.getMonth()] + (then.getFullYear() === now.getFullYear() ? '' : ' ' + then.getFullYear());
}

export function absoluteTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MNL[d.getMonth()]} ${d.getFullYear()} à ${time}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Bank exports shout their descriptions in full caps, which is unreadable down
// a long list. The apostrophe is part of the word it sits in, so "BISTRO
// D'ALIZE" reads as "Bistro D'alize" and not "Bistro D'Alize"; anything that
// is not a letter is left exactly as the file wrote it.
export function titleCase(text) {
  return String(text ?? '').toLowerCase()
    .replace(/\p{L}[\p{L}\p{M}'’]*/gu, word => word[0].toUpperCase() + word.slice(1));
}

// "1 ligne" / "12 lignes". French turns the plural on at two, so zero and one
// both keep the singular — and the "(s)" that used to be printed everywhere
// was a form nobody actually writes.
export function plural(n, singular, many = singular + 's') {
  return `${n} ${Math.abs(n) >= 2 ? many : singular}`;
}
