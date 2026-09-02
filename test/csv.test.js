import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvIndexed, detectDelimiter } from '../js/lib/csv.js';

test('parseCsv splits on comma and trims cells', () => {
  const rows = parseCsv('a, b ,c\n1,2,3');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv handles quoted fields with embedded commas', () => {
  const rows = parseCsv('2026-08-07,"GARAGE SUROIT INC SAINTE-BRISE, QC",500.87');
  assert.deepEqual(rows, [['2026-08-07', 'GARAGE SUROIT INC SAINTE-BRISE, QC', '500.87']]);
});

test('parseCsv handles escaped quotes inside quoted fields', () => {
  const rows = parseCsv('a,"he said ""hi""",c');
  assert.deepEqual(rows[0], ['a', 'he said "hi"', 'c']);
});

test('parseCsv auto-detects semicolon delimiter', () => {
  const rows = parseCsv('date;type;montant\n2026-01-01;reel;-10');
  assert.deepEqual(rows, [['date', 'type', 'montant'], ['2026-01-01', 'reel', '-10']]);
});

test('detectDelimiter picks the most frequent candidate', () => {
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
});

test('parseCsvIndexed reports the real file line of each row, blank lines included', () => {
  const text = [
    'alix-and-bruno_export', // 1
    '',                      // 2
    'Date,Cost',             // 3
    '',                      // 4
    '2026-08-11,15.00',      // 5
    '2026-08-12,20.00',      // 6
  ].join('\n');
  const { rows, lines } = parseCsvIndexed(text);
  assert.deepEqual(rows.map(r => r[0]), ['alix-and-bruno_export', 'Date', '2026-08-11', '2026-08-12']);
  assert.deepEqual(lines, [1, 3, 5, 6]);
});

test('parseCsvIndexed counts the newlines inside a quoted field', () => {
  const { rows, lines } = parseCsvIndexed('a,"deux\nlignes"\nb,c');
  assert.deepEqual(rows[1], ['b', 'c']);
  assert.deepEqual(lines, [1, 3]);
});

test('parseCsvIndexed handles \\r\\n line endings', () => {
  const { lines } = parseCsvIndexed('a,b\r\nc,d\r\ne,f');
  assert.deepEqual(lines, [1, 2, 3]);
});
