import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { demoTransactions } from '../js/demo.js';
import { detectAdapter, parseText } from '../js/parsers/index.js';

const rows = demoTransactions();
const months = [...new Set(rows.map(r => r.date.slice(0, 7)))];
const bankEntry = (r) => r.rawEntries.find(e => e.source !== 'splitwise');
const splitwiseEntry = (r) => r.rawEntries.find(e => e.source === 'splitwise');
const text = (entry) => [entry.header, entry.line].filter(Boolean).join('\n');

describe('demo transactions', () => {
  test('covers three months and no more', () => {
    assert.equal(months.length, 3);
  });

  test('every row lands on a real day of one of those months', () => {
    for (const r of rows) {
      assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, r.description);
      assert.ok(months.includes(r.date.slice(0, 7)), `${r.description} on ${r.date}`);
    }
  });

  test('shows a line from every format the app reads', () => {
    const sources = new Set(rows.flatMap(r => r.sources));
    assert.deepEqual([...sources].sort(), ['cibc', 'generic', 'splitwise', 'tangerine', 'wealthsimple']);
  });

  test('carries Splitwise matches both with and without a date warning', () => {
    const matched = rows.filter(r => r.sources.length > 1);
    assert.ok(matched.some(r => r.matchDate), 'no match falls on a different day');
    assert.ok(matched.some(r => !r.matchDate), 'every match falls on a different day');
  });

  test('carries a Splitwise expense that no bank line paid', () => {
    assert.ok(rows.some(r => r.sources.length === 1 && r.sources[0] === 'splitwise'));
  });

  test('spreads the expenses over more than one Splitwise group', () => {
    const groups = new Set(rows.map(r => r.swGroup).filter(Boolean));
    assert.ok(groups.size > 1, `only ${[...groups]}`);
  });

  test('every row can be traced back to a source line', () => {
    for (const r of rows) assert.ok(r.rawEntries.length >= 1, r.description);
  });
});

// The source-line panel is only worth showing if it agrees with the row above
// it. Every generated line goes back through the real parser here, so a demo
// row can never quietly claim a line that does not say what the row says.
describe('demo source lines round-trip through the parsers', () => {
  test('each line is recognised by the adapter it claims', () => {
    for (const r of rows) {
      for (const entry of r.rawEntries) {
        const adapter = detectAdapter(text(entry));
        assert.ok(adapter, `${r.description}: ${entry.line} matched no adapter`);
        assert.equal(adapter.SOURCE, entry.source, `${r.description}: ${entry.line}`);
      }
    }
  });

  test('a plain row re-parses to its own date and amount', () => {
    for (const r of rows.filter(t => t.sources.length === 1 && t.sources[0] !== 'splitwise')) {
      const entry = bankEntry(r);
      const { candidates } = parseText(text(entry), entry.file);
      assert.equal(candidates.length, 1, r.description);
      assert.ok(!candidates[0].error, `${r.description}: ${candidates[0].error?.reason}`);
      assert.equal(candidates[0].date, r.date, r.description);
      assert.equal(candidates[0].amount, r.amount, r.description);
    }
  });

  test('a matched row re-parses to the full cost on the bank side', () => {
    for (const r of rows.filter(t => t.sources.length > 1)) {
      const entry = bankEntry(r);
      const { candidates } = parseText(text(entry), entry.file);
      assert.equal(candidates[0].amount, -r.matchAmount, r.description);
    }
  });

  test('the Splitwise side re-parses to exactly the share the row settles on', () => {
    for (const r of rows.filter(t => t.sources.includes('splitwise'))) {
      const entry = splitwiseEntry(r);
      const { candidates, fileError } = parseText(text(entry), entry.file, { splitwiseMyNames: ['Alix N.'] });
      assert.equal(fileError, null, r.description);
      assert.equal(candidates.length, 1, r.description);
      assert.equal(candidates[0].amount, r.amount, r.description);
      assert.equal(candidates[0].suggestedCategory, r.swCategory, r.description);
    }
  });
});
