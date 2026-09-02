import { parseCsv, parseCsvIndexed } from '../lib/csv.js';
import { parseAmount, isoDate, stableHash } from '../lib/normalize.js';

export const SOURCE = 'cibc';

// CIBC Visa export: no header row.
// date, description, debit, credit, masked card number
export function detect(text) {
  const rows = parseCsv(text);
  if (!rows.length) return false;
  const first = rows[0];
  return first.length >= 4 && !!isoDate(first[0]) && !isNaN(parseAmount(first[2] || first[3] || ''));
}

export function parse(text) {
  const { rows, lines } = parseCsvIndexed(text);
  const candidates = [];

  rows.forEach((row, i) => {
    if (row.length < 4) {
      candidates.push(errorRow(row, i, lines[i], 'Ligne trop courte (colonnes manquantes)'));
      return;
    }
    const date = isoDate(row[0]);
    const description = row[1] || '';
    const debit = parseAmount(row[2]);
    const credit = parseAmount(row[3]);

    if (!date) { candidates.push(errorRow(row, i, lines[i], `Date invalide : "${row[0]}"`)); return; }

    let amount;
    if (row[2] && row[2].trim() !== '' && !isNaN(debit)) amount = -Math.abs(debit);
    else if (row[3] && row[3].trim() !== '' && !isNaN(credit)) amount = Math.abs(credit);
    else { candidates.push(errorRow(row, i, lines[i], 'Montant introuvable (colonnes débit/crédit vides ou illisibles)')); return; }

    candidates.push({
      id: stableHash(SOURCE, date, description, amount, i),
      date, description, amount,
      source: SOURCE,
      suggestedCategory: null,
      raw: row,
      lineNo: lines[i],
      error: null,
    });
  });

  return { source: SOURCE, candidates, fileError: candidates.length ? null : 'Aucune ligne exploitable.' };
}

function errorRow(row, i, lineNo, reason) {
  return {
    id: stableHash(SOURCE, 'err', i, row.join('|')),
    date: null, description: (row[1] || row.join(' ')).trim(), amount: NaN,
    source: SOURCE, suggestedCategory: null, raw: row, lineNo,
    error: { reason },
  };
}
