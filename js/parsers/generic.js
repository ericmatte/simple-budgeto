import { parseCsv, parseCsvIndexed } from '../lib/csv.js';
import { parseAmount, isoDate, stableHash } from '../lib/normalize.js';

export const SOURCE = 'generic';

// Fallback adapter for the structured budget CSV (planned lines, net-worth
// adjustments/anchors, goals) that isn't a bank export — same schema as the
// original design: date;type;description;montant;categorie;frequence;mois.
// Also used as a last-resort adapter for any CSV with recognizable date/amount
// columns that didn't match a known bank format.

function stripAccents(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function findHeaderRow(rows) {
  return rows.findIndex(r => {
    const h = r.map(stripAccents);
    return h.some(c => /date|montant|type|amount/.test(c));
  });
}

function freqOf(raw) {
  const v = stripAccents(String(raw || ''));
  if (/bihebdo|deux ?semaine|biweek|quinzaine/.test(v)) return 'bihebdo';
  if (/annuel|year|an$/.test(v)) return 'annuel';
  if (/ponctuel|once|unique/.test(v)) return 'ponctuel';
  return 'mensuel';
}

function kindOf(raw) {
  const v = stripAccents(String(raw || ''));
  if (/planif|budget|prevu/.test(v)) return 'planifie';
  if (/ajust|adjust/.test(v)) return 'ajustement';
  if (/solde|balance|patrimoine/.test(v)) return 'solde';
  if (/objectif|goal|cible/.test(v)) return 'objectif';
  return 'reel';
}

export function detect(text) {
  return findHeaderRow(parseCsv(text)) >= 0;
}

export function parse(text) {
  const { rows, lines } = parseCsvIndexed(text);
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    return { source: SOURCE, candidates: [], fileError: 'Colonnes date/montant/type introuvables — impossible de reconnaître ce fichier.' };
  }

  const head = rows[headerIdx].map(stripAccents);
  const idx = {
    date: head.findIndex(h => /date/.test(h)),
    type: head.findIndex(h => /type|nature/.test(h)),
    desc: head.findIndex(h => /desc|libell|detail/.test(h)),
    amt: head.findIndex(h => /montant|amount|somme/.test(h)),
    cat: head.findIndex(h => /categ/.test(h)),
    freq: head.findIndex(h => /freq/.test(h)),
    month: head.findIndex(h => /^mois$|month/.test(h)),
  };
  if (idx.amt < 0) {
    return { source: SOURCE, candidates: [], fileError: 'Colonne « montant » introuvable.' };
  }

  const candidates = [];
  rows.slice(headerIdx + 1).forEach((row, i) => {
    if (!row.some(c => c.trim() !== '')) return;

    const lineNo = lines[headerIdx + 1 + i];
    const kind = idx.type >= 0 ? kindOf(row[idx.type]) : 'reel';
    const amount = parseAmount(row[idx.amt]);
    if (isNaN(amount)) { candidates.push(errorRow(row, i, lineNo, `Montant invalide : "${row[idx.amt]}"`)); return; }

    const date = idx.date >= 0 ? isoDate(row[idx.date]) : null;
    if (!date && kind !== 'planifie' && kind !== 'objectif') {
      candidates.push(errorRow(row, i, lineNo, 'Date manquante ou invalide (requise pour ce type de ligne)'));
      return;
    }

    const description = idx.desc >= 0 ? (row[idx.desc] || '') : '';
    candidates.push({
      id: stableHash(SOURCE, kind, date, description, amount, i),
      date: date || '', description, amount,
      source: SOURCE,
      suggestedCategory: (idx.cat >= 0 ? row[idx.cat] : '') || description || null,
      kind,
      freq: kind === 'planifie' ? freqOf(idx.freq >= 0 ? row[idx.freq] : '') : null,
      month: idx.month >= 0 ? (Number(parseAmount(row[idx.month])) || null) : (date ? Number(date.slice(5, 7)) : null),
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
