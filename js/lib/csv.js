// Minimal RFC4180-ish CSV reader/writer: handles quoted fields, embedded
// separators/newlines inside quotes, and "" as an escaped quote.

export function detectDelimiter(sampleLine) {
  const candidates = [',', ';', '\t', '|'];
  let best = ',', bestCount = -1;
  for (const d of candidates) {
    const count = sampleLine.split(d).length - 1;
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return bestCount > 0 ? best : ',';
}

// Same rows as parseCsv, plus the 1-based line in the source file each one
// started on. Blank lines are dropped from the rows, so a row's index alone
// can't be turned back into a line number — and pointing the user at the
// wrong line of their file is worse than not pointing at all.
export function parseCsvIndexed(text, delimiter) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstNonEmpty = raw.split('\n').find(l => l.trim() !== '') || '';
  const delim = delimiter || detectDelimiter(firstNonEmpty);

  const rows = [];
  const lines = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); lines.push(rowLine); row = []; };

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delim) { pushField(); continue; }
    if (c === '\n') { pushRow(); line++; rowLine = line; continue; }
    field += c;
  }
  if (field !== '' || row.length) pushRow();

  const keep = rows.map((r, i) => [r, lines[i]]).filter(([r]) => !(r.length === 1 && r[0].trim() === ''));
  return {
    rows: keep.map(([r]) => r.map(c => c.trim())),
    lines: keep.map(([, l]) => l),
  };
}

// Parses CSV text into an array of rows (array of trimmed string cells),
// auto-detecting the delimiter from the first non-empty line unless given.
export function parseCsv(text, delimiter) {
  return parseCsvIndexed(text, delimiter).rows;
}

