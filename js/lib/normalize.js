// Shared helpers for turning raw bank/export text into normalized values.

// "1 234,56", "$1,234.56", "(45.00)", "-45,00 CAD" → -45 / 1234.56 / -45
export function parseAmount(raw) {
  if (raw == null || raw === '') return NaN;
  let v = String(raw).trim().replace(/[\s $]|CAD|USD|EUR|€/gi, '');
  const negative = /^\(.*\)$/.test(v) || v.startsWith('-');
  v = v.replace(/[()+-]/g, '');
  if (v.includes(',') && v.includes('.')) v = v.replace(/,/g, '');
  else if (v.includes(',')) v = v.replace(',', '.');
  const n = parseFloat(v);
  if (isNaN(n)) return NaN;
  return negative ? -n : n;
}

// 'YYYY-MM-DD' | 'YYYY/MM/DD' → 'YYYY-MM-DD'
export function isoDate(raw) {
  const m = String(raw || '').trim().match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

// 'MM/DD/YYYY' → 'YYYY-MM-DD'
export function mdyDate(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// 'YYYY-MM-DDTHH:mm:ss-04:00' → 'YYYY-MM-DD'
export function isoDateTime(raw) {
  const m = String(raw || '').trim().match(/^(\d{4}-\d{2}-\d{2})T/);
  return m ? m[1] : isoDate(raw);
}

// Stable short id from arbitrary parts — used to dedupe re-imports of the
// same statement rows (FNV-1a, good enough for a non-cryptographic dedupe key).
export function stableHash(...parts) {
  const s = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
