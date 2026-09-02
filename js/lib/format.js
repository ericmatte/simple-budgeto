const MN = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MNL = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function money(n, decimals = 0) {
  const v = Number(n) || 0;
  return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('fr-CA', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).replace(/\s/g, '\u00a0') + '\u00a0$';
}

export function ymFull(key) {
  const [y, m] = key.split('-');
  return MNL[Number(m) - 1] + ' ' + y;
}

// "11 août" from a 'YYYY-MM-DD' key. Built from the parts rather than
// `new Date(iso)`, which reads the string as UTC midnight and lands on the
// day before once it's rendered in a Québec timezone.
export function shortDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''));
  if (!m) return '—';
  return `${Number(m[3])} ${MN[Number(m[2]) - 1]}`;
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
