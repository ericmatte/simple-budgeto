import { parseCsv, parseCsvIndexed } from '../lib/csv.js';
import { parseAmount, isoDate, stableHash } from '../lib/normalize.js';

export const SOURCE = 'splitwise';

function findHeaderRow(rows) {
  return rows.findIndex(r => {
    const h = r.map(c => c.toLowerCase().trim());
    return h.includes('date') && h.includes('cost') && h.length >= 6;
  });
}

// Reads just enough to tell the importer who the two member columns are, so
// it can ask "which one is you?" before the amounts can be computed.
export function inspect(text) {
  const rows = parseCsv(text);
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) return { fileError: 'En-têtes attendues introuvables (Date, Cost, ...).', memberColumns: [] };
  const head = rows[headerIdx];
  return { fileError: null, memberColumns: head.slice(5) };
}

// The user is a member of every Splitwise export they hand over at once, so
// the names shared by all the files are the only plausible answers to "which
// one is you?". When nothing is shared — the exports spell the person
// differently from one group to the next — every name stays a candidate.
export function commonMembers(memberLists) {
  const lists = (memberLists || []).filter(l => l && l.length);
  if (!lists.length) return [];
  const shared = lists.reduce((acc, list) => acc.filter(m => list.includes(m)), [...new Set(lists[0])]);
  return shared.length ? shared : [...new Set(lists.flat())];
}

export function detect(text) {
  return findHeaderRow(parseCsv(text)) >= 0;
}

// A Splitwise export says nothing about the group it came from, but the file
// it arrives in usually does ("Escapade 2026.csv", "splitwise-groupe-alpha.csv"). The
// guess is only a starting point — the import screen lets it be corrected or
// pointed at a group the budget already knows, which is what keeps a group's
// learned categories attached across monthly re-exports.
export function groupFromLabel(label) {
  const base = String(label || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^splitwise[\s_-]*/i, '')
    .replace(/[\s_-]*(export|expenses?)$/i, '')
    .replace(/[\s_-]*\d{4}[-_]\d{2}[-_]\d{2}$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return 'Splitwise';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// myName must be one of the member column names returned by inspect().
export function parse(text, myName) {
  const { rows, lines } = parseCsvIndexed(text);
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    return { source: SOURCE, candidates: [], fileError: 'En-têtes attendues introuvables (Date, Cost, ...).', memberColumns: [] };
  }

  const head = rows[headerIdx];
  const memberColumns = head.slice(5);
  const idx = { date: 0, description: 1, category: 2, cost: 3, myCol: head.indexOf(myName) };

  if (idx.myCol < 0) {
    return { source: SOURCE, candidates: [], fileError: null, memberColumns, needsMemberSelection: true };
  }

  const candidates = [];
  rows.slice(headerIdx + 1).forEach((row, i) => {
    if (!row.some(c => c.trim() !== '')) return; // blank spacer row
    if ((row[idx.description] || '').trim().toLowerCase() === 'total balance') return; // running-balance footer

    const lineNo = lines[headerIdx + 1 + i];
    const date = isoDate(row[idx.date]);
    const description = row[idx.description] || '';
    const category = (row[idx.category] || '').trim();
    const cost = parseAmount(row[idx.cost]);
    const myDelta = parseAmount(row[idx.myCol]);

    if (!date) { candidates.push(errorRow(row, i, lineNo, `Date invalide : "${row[idx.date]}"`)); return; }
    if (isNaN(myDelta)) { candidates.push(errorRow(row, i, lineNo, `Montant introuvable pour "${myName}"`)); return; }

    const isSettlement = category.toLowerCase() === 'payment';

    // Nobody owes anybody on this line. Either I paid the whole thing and all
    // of it was my share, or somebody else did and all of it was theirs — a
    // Splitwise export writes both cases exactly the same way (0 for every
    // member), so the line says nothing about my own money. It therefore
    // claims no share and, above all, no bank row: whatever my statement
    // holds that day is my real cost, in full.
    const noBalance = !isSettlement && myDelta === 0;

    // My real economic cost from a shared expense: if I paid the full amount
    // (myDelta > 0, I'm owed the difference back), my true spend is what's
    // left after being reimbursed. If I didn't pay (myDelta <= 0), my true
    // spend is exactly what I owe. This generalizes to any number of members.
    const amount = isSettlement ? myDelta : (myDelta > 0 ? myDelta - cost : myDelta);

    candidates.push({
      id: stableHash(SOURCE, date, description, amount, i),
      date, description, amount,
      source: SOURCE,
      suggestedCategory: isSettlement ? null : (category || null),
      isSettlement,
      noBalance,
      matchHint: (isSettlement || noBalance) ? null : { date, amount: cost },
      raw: row,
      lineNo,
      error: null,
    });
  });

  return { source: SOURCE, candidates, fileError: candidates.length ? null : 'Aucune ligne exploitable.', memberColumns };
}

function errorRow(row, i, lineNo, reason) {
  return {
    id: stableHash(SOURCE, 'err', i, row.join('|')),
    date: null, description: row.join(' ').trim(), amount: NaN,
    source: SOURCE, suggestedCategory: null, raw: row, lineNo,
    error: { reason },
  };
}
