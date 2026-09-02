import { parseCsv, parseCsvIndexed } from '../lib/csv.js';
import { parseAmount, isoDateTime, stableHash } from '../lib/normalize.js';

export const SOURCE = 'wealthsimple';

const SUBTYPE_CATEGORY = {
  AFT_OUT: 'Paiement préautorisé',
  AFT_IN: 'Dépôt',
  OBP_OUT: 'Paiement de facture',
};

// Money movement between the user's own accounts — not a real expense/income,
// so it's excluded from the budget by default (see reconcile.js).
const TRANSFER_SUBTYPES = new Set(['E_TRFOUT', 'E_TRFIN', 'TRANSFER', 'P2P']);

function findHeaderRow(rows) {
  return rows.findIndex(r => {
    const h = r.map(c => c.toLowerCase().trim());
    return h.includes('effective_at') && h.includes('net_cash_amount');
  });
}

export function detect(text) {
  return findHeaderRow(parseCsv(text)) >= 0;
}

export function parse(text) {
  const { rows, lines } = parseCsvIndexed(text);
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    return { source: SOURCE, candidates: [], fileError: 'En-têtes attendues introuvables (effective_at, net_cash_amount).' };
  }

  const head = rows[headerIdx].map(c => c.toLowerCase().trim());
  const idx = {
    date: head.indexOf('effective_at'),
    description: head.indexOf('description'),
    subtype: head.indexOf('activity_sub_type'),
    amount: head.indexOf('net_cash_amount'),
  };

  const candidates = [];
  rows.slice(headerIdx + 1).forEach((row, i) => {
    if (!row.some(c => c.trim() !== '')) return; // blank spacer row
    if (/^as of /i.test(row[0] || '')) return; // trailing "As of ..." footer

    const lineNo = lines[headerIdx + 1 + i];
    const date = isoDateTime(row[idx.date]);
    const description = idx.description >= 0 ? (row[idx.description] || '') : '';
    const subtype = idx.subtype >= 0 ? (row[idx.subtype] || '').trim() : '';
    const amount = parseAmount(row[idx.amount]);

    if (!date) { candidates.push(errorRow(row, i, lineNo, `Date invalide : "${row[idx.date]}"`)); return; }
    if (isNaN(amount)) { candidates.push(errorRow(row, i, lineNo, `Montant invalide : "${row[idx.amount]}"`)); return; }

    candidates.push({
      id: stableHash(SOURCE, date, description, amount, i),
      date, description, amount,
      source: SOURCE,
      suggestedCategory: SUBTYPE_CATEGORY[subtype] || null,
      isTransfer: TRANSFER_SUBTYPES.has(subtype),
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
