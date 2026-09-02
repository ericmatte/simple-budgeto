import { parseCsv, toCsv } from '../lib/csv.js';

// Appending a column is backwards compatible: decode looks every column up by
// name, so a file written before `matchAmount` existed simply reads it as
// missing rather than shifting every field over by one.
const COLUMNS = [
  'id', 'dedupeKey', 'kind', 'date', 'description', 'amount',
  'category', 'freq', 'month', 'note', 'sources', 'linkedId',
  'importBatchId', 'status', 'matchAmount', 'group', 'swGroup', 'swCategory', 'file',
  'matchDate', 'matchDescription',
];

export function decodeTransactions(text) {
  if (!text || !text.trim()) return [];
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0];
  const idx = Object.fromEntries(COLUMNS.map(c => [c, head.indexOf(c)]));

  return rows.slice(1)
    .filter(r => r.some(c => c.trim() !== ''))
    .map(r => ({
      id: r[idx.id] || '',
      dedupeKey: r[idx.dedupeKey] || '',
      kind: r[idx.kind] || 'reel',
      date: r[idx.date] || '',
      description: r[idx.description] || '',
      amount: Number(r[idx.amount]),
      category: r[idx.category] || 'Non classé',
      // The dashboard group this row belongs to, when it isn't simply the
      // one its category lives in — a trip or a project. Blank on every row
      // written before the column existed, which reads as "no override".
      group: r[idx.group] || '',
      // Where a Splitwise row came from, kept so it can still be grouped with
      // its siblings — and have a rule learned from it — long after the
      // import that brought it in.
      swGroup: r[idx.swGroup] || '',
      swCategory: r[idx.swCategory] || '',
      // The export this row was read from, kept so a line can still be traced
      // back to the file it came from months after the import.
      file: r[idx.file] || '',
      freq: r[idx.freq] || null,
      // Kept as the raw string rather than coerced to Number: a 'ponctuel'
      // plan stores a bare month number ("6"), but an 'exact' per-cell plan
      // stores a full year-month key ("2027-03") which Number() would mangle.
      // Consumers that need the numeric form (ponctuel) already call Number() on it.
      month: r[idx.month] || null,
      note: r[idx.note] || '',
      sources: (r[idx.sources] || '').split(';').filter(Boolean),
      linkedId: r[idx.linkedId] || null,
      importBatchId: r[idx.importBatchId] || null,
      status: r[idx.status] || 'active',
      matchAmount: r[idx.matchAmount] ? Number(r[idx.matchAmount]) : null,
      // The day of the other source's line, written only when the two sides of
      // a match fall on different days.
      matchDate: r[idx.matchDate] || null,
      // What the other source of a match called the same purchase.
      matchDescription: r[idx.matchDescription] || '',
    }));
}

export function encodeTransactions(transactions) {
  const rows = [COLUMNS];
  for (const t of transactions) {
    rows.push(COLUMNS.map(c => {
      if (c === 'sources') return (t.sources || []).join(';');
      const v = t[c];
      return v == null ? '' : String(v);
    }));
  }
  return toCsv(rows, ',');
}
