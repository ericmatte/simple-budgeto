import { parseCsv, parseCsvIndexed } from '../lib/csv.js';
import { parseAmount, mdyDate, stableHash } from '../lib/normalize.js';

export const SOURCE = 'tangerine';

function normHeader(h) {
  return h.toLowerCase().trim();
}

// Tangerine credit card export header:
// Transaction date,Transaction,Name,Memo,Amount
export function detect(text) {
  const rows = parseCsv(text);
  if (!rows.length) return false;
  const head = rows[0].map(normHeader);
  return head.some(h => h.includes('transaction date')) && head.some(h => h === 'amount');
}

export function parse(text) {
  const { rows, lines } = parseCsvIndexed(text);
  if (!rows.length) return { source: SOURCE, candidates: [], fileError: 'Fichier vide.' };

  const head = rows[0].map(normHeader);
  const idx = {
    date: head.findIndex(h => h.includes('transaction date')),
    name: head.findIndex(h => h === 'name'),
    memo: head.findIndex(h => h === 'memo'),
    amount: head.findIndex(h => h === 'amount'),
  };
  if (idx.date < 0 || idx.amount < 0) {
    return { source: SOURCE, candidates: [], fileError: 'En-têtes attendues introuvables (Transaction date, Amount).' };
  }

  const candidates = [];
  rows.slice(1).forEach((row, i) => {
    if (!row.some(c => c.trim() !== '')) return; // blank spacer row, not an error
    const lineNo = lines[i + 1];
    const date = mdyDate(row[idx.date]);
    const description = idx.name >= 0 ? (row[idx.name] || '') : '';
    const memo = idx.memo >= 0 ? (row[idx.memo] || '') : '';
    const amount = parseAmount(row[idx.amount]);

    if (!date) { candidates.push(errorRow(row, i, lineNo, `Date invalide : "${row[idx.date]}"`)); return; }
    if (isNaN(amount)) { candidates.push(errorRow(row, i, lineNo, `Montant invalide : "${row[idx.amount]}"`)); return; }

    const catMatch = memo.match(/Category:\s*([^~]+)/i);

    candidates.push({
      id: stableHash(SOURCE, date, description, amount, i),
      date, description, amount,
      source: SOURCE,
      suggestedCategory: catMatch ? catMatch[1].trim() : null,
      raw: row,
      lineNo,
      error: null,
    });
  });

  return { source: SOURCE, candidates, fileError: candidates.length ? null : 'Aucune ligne exploitable.' };
}

function errorRow(row, i, lineNo, reason) {
  return {
    id: stableHash(SOURCE, 'err', i, row.join('|')),
    date: null, description: row.join(' ').trim(), amount: NaN,
    source: SOURCE, suggestedCategory: null, raw: row, lineNo,
    error: { reason },
  };
}
