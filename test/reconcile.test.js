import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPreview, dayOffset, dedupeKey, matchGap, mergeMatched, planMatches, sameMoney, toStoredTransaction } from '../js/matching/reconcile.js';

const candidate = (patch = {}) => ({
  id: 'row', date: '2026-08-04', description: 'Achat', amount: -10,
  source: 'cibc', error: null, ...patch,
});

describe('simple import reconciliation', () => {
  test('keeps readable transactions, including transfers and settlements', () => {
    const items = buildPreview([
      candidate({ id: 'transfer', isTransfer: true }),
      candidate({ id: 'settlement', source: 'splitwise', isSettlement: true }),
    ], []);
    assert.deepEqual(items.map(i => i.status), ['ok', 'ok']);
  });

  test('keeps only an exact re-import out', () => {
    const first = candidate({ description: 'Marché Nordet', amount: -51.01 });
    const items = buildPreview([first], [{ ...first, dedupeKey: dedupeKey(first) }]);
    assert.equal(items[0].status, 'duplicate');
    assert.equal(items[0].included, false);
  });

  test('joins an exact bank and Splitwise match into one bank transaction', () => {
    const bank = candidate({ id: 'bank', date: '2026-06-27', description: 'Marché Nordet', amount: -38.94 });
    const splitwise = candidate({ id: 'sw', source: 'splitwise', date: '2026-06-27', description: 'Marché entre amis', amount: -19.47, matchHint: { date: '2026-06-27', amount: 38.94 } });
    const items = buildPreview([bank, splitwise], []);
    assert.equal(items[0].status, 'ok');
    assert.equal(items[0].matchedSource, 'splitwise');
    assert.equal(items[1].status, 'merged');
    const stored = toStoredTransaction(items[0], 'batch');
    assert.deepEqual(stored.sources, ['cibc', 'splitwise']);
    // What the row owes is the user's share; the statement total is kept aside.
    assert.equal(stored.amount, -19.47);
    assert.equal(stored.matchAmount, 38.94);
    assert.equal(stored.description, 'Marché Nordet');
  });

  test('does not join a different total', () => {
    const bank = candidate({ id: 'bank', amount: -38.94 });
    const splitwise = candidate({ id: 'sw', source: 'splitwise', amount: -19.47, matchHint: { date: '2026-08-04', amount: 41.10 } });
    const items = buildPreview([bank, splitwise], []);
    assert.deepEqual(items.map(i => i.status), ['ok', 'ok']);
  });
});

// A purchase is entered in Splitwise the day it happens; the card posts it a
// day or two later. The total is what identifies the pair.
describe('a Splitwise match across two days', () => {
  test('joins the pair and records the day the other source carries', () => {
    const bank = candidate({ id: 'bank', date: '2026-08-06', amount: -38.94 });
    const splitwise = candidate({ id: 'sw', source: 'splitwise', date: '2026-08-04', amount: -19.47, matchHint: { date: '2026-08-04', amount: 38.94 } });
    const items = buildPreview([bank, splitwise], []);
    assert.equal(items[0].matchedSource, 'splitwise');
    assert.equal(items[1].status, 'merged');
    const stored = toStoredTransaction(items[0], 'batch');
    assert.equal(stored.date, '2026-08-06');
    assert.equal(stored.matchDate, '2026-08-04');
  });

  test('the same day carries no warning', () => {
    const bank = candidate({ id: 'bank', date: '2026-08-04', amount: -38.94 });
    const splitwise = candidate({ id: 'sw', source: 'splitwise', amount: -19.47, matchHint: { date: '2026-08-04', amount: 38.94 } });
    const items = buildPreview([bank, splitwise], []);
    assert.equal(toStoredTransaction(items[0], 'batch').matchDate, null);
  });

  test('the nearest day wins when two bank rows carry the same total', () => {
    const far = candidate({ id: 'far', date: '2026-08-01', amount: -38.94 });
    const near = candidate({ id: 'near', date: '2026-08-05', amount: -38.94 });
    const splitwise = candidate({ id: 'sw', source: 'splitwise', amount: -19.47, matchHint: { date: '2026-08-04', amount: 38.94 } });
    const items = buildPreview([far, near, splitwise], []);
    assert.equal(items[0].matchedSource, undefined);
    assert.equal(items[1].matchedSource, 'splitwise');
  });

  test('a bank row is claimed by one expense only', () => {
    const bank = candidate({ id: 'bank', date: '2026-08-04', amount: -38.94 });
    const first = candidate({ id: 'sw1', source: 'splitwise', amount: -19.47, matchHint: { date: '2026-08-04', amount: 38.94 } });
    const second = candidate({ id: 'sw2', source: 'splitwise', amount: -19.47, matchHint: { date: '2026-08-09', amount: 38.94 } });
    const items = buildPreview([bank, first, second], []);
    assert.deepEqual(items.map(i => i.status), ['ok', 'merged', 'ok']);
  });
});

// How Splitwise filed the expense follows the row, whichever side survives.
describe('the Splitwise category', () => {
  const expense = (patch = {}) => candidate({
    id: 'sw', source: 'splitwise', amount: -19.47, suggestedCategory: 'Gas/fuel',
    matchHint: { date: '2026-08-04', amount: 38.94 }, ...patch,
  });

  test('follows the expense onto the bank row it matched', () => {
    const items = buildPreview([candidate({ id: 'bank', amount: -38.94 }), expense()], []);
    assert.equal(toStoredTransaction(items[0], 'batch').swCategory, 'Gas/fuel');
  });

  test('stays on an expense that matched nothing', () => {
    const items = buildPreview([expense()], []);
    assert.equal(toStoredTransaction(items[0], 'batch').swCategory, 'Gas/fuel');
  });

  test('a bank row alone has none, whatever its own parser guessed', () => {
    const items = buildPreview([candidate({ suggestedCategory: 'Dépôt' })], []);
    assert.equal(toStoredTransaction(items[0], 'batch').swCategory, '');
  });

  test('the group the expense was shared in follows it too', () => {
    const items = buildPreview([candidate({ id: 'bank', amount: -38.94 }), expense({ splitwiseGroup: 'Groupe Alpha' })], []);
    assert.equal(toStoredTransaction(items[0], 'batch').swGroup, 'Groupe Alpha');
    assert.equal(toStoredTransaction(buildPreview([expense({ splitwiseGroup: 'Groupe Alpha' })], [])[0], 'batch').swGroup, 'Groupe Alpha');
  });

  test('a bank row alone belongs to no group', () => {
    assert.equal(toStoredTransaction(buildPreview([candidate()], [])[0], 'batch').swGroup, '');
  });

  test('an expense filed under nothing leaves the column empty', () => {
    const items = buildPreview([candidate({ id: 'bank', amount: -38.94 }), expense({ suggestedCategory: null })], []);
    assert.equal(toStoredTransaction(items[0], 'batch').swCategory, '');
  });
});

// The two files rarely arrive together. Whichever comes second enriches the
// row that is already stored, and the bank side always dates it.
describe('a counterpart imported in a later session', () => {
  const storedBank = {
    id: 'bank', date: '2026-08-06', description: 'MARCHÉ NORDET', amount: -38.94,
    sources: ['cibc'], matchAmount: null, rawEntries: [{ source: 'cibc' }],
  };
  const storedSplitwise = {
    id: 'sw', date: '2026-08-04', description: 'Marché entre amis', amount: -19.47,
    sources: ['splitwise'], matchAmount: 38.94, rawEntries: [{ source: 'splitwise' }],
  };

  test('the Splitwise export arriving second leaves the bank day in place', () => {
    const item = candidate({ source: 'splitwise', date: '2026-08-04', amount: -19.47, matchHint: { date: '2026-08-04', amount: 38.94 } });
    const merged = mergeMatched(storedBank, item, toStoredTransaction(item, 'batch2'));
    assert.equal(merged.date, '2026-08-06');
    assert.equal(merged.matchDate, '2026-08-04');
    assert.equal(merged.description, 'MARCHÉ NORDET');
    assert.equal(merged.amount, -19.47);
    assert.deepEqual(merged.sources, ['cibc', 'splitwise']);
    assert.equal(merged.matchAmount, 38.94);
  });

  test('the bank export arriving second takes over the day', () => {
    const item = candidate({ source: 'cibc', date: '2026-08-06', description: 'MARCHÉ NORDET', amount: -38.94 });
    const merged = mergeMatched(storedSplitwise, item, toStoredTransaction(item, 'batch2'));
    assert.equal(merged.date, '2026-08-06');
    assert.equal(merged.matchDate, '2026-08-04');
    assert.equal(merged.description, 'MARCHÉ NORDET');
    assert.equal(merged.amount, -19.47);
    assert.deepEqual(merged.sources, ['splitwise', 'cibc']);
    assert.equal(merged.matchAmount, 38.94);
  });

  test('both sides on one day leave no warning behind', () => {
    const item = candidate({ source: 'cibc', date: '2026-08-04', amount: -38.94 });
    assert.equal(mergeMatched(storedSplitwise, item, toStoredTransaction(item, 'batch2')).matchDate, null);
  });

  test('the Splitwise category survives whichever file comes second', () => {
    const expense = candidate({ source: 'splitwise', amount: -19.47, suggestedCategory: 'Gas/fuel', matchHint: { date: '2026-08-04', amount: 38.94 } });
    const second = mergeMatched(storedBank, expense, toStoredTransaction(expense, 'batch2'));
    assert.equal(second.swCategory, 'Gas/fuel');

    const bank = candidate({ source: 'cibc', date: '2026-08-06', amount: -38.94 });
    const filed = { ...storedSplitwise, swCategory: 'Gas/fuel' };
    assert.equal(mergeMatched(filed, bank, toStoredTransaction(bank, 'batch2')).swCategory, 'Gas/fuel');
  });

  test('keeps the raw lines of both sides', () => {
    const item = candidate({ source: 'splitwise', amount: -19.47, matchHint: { date: '2026-08-04', amount: 38.94 } });
    const merged = mergeMatched(storedBank, item, toStoredTransaction(item, 'batch2'));
    assert.deepEqual(merged.rawEntries.map(e => e.source), ['cibc', 'splitwise']);
  });
});

describe('dayOffset', () => {
  test('counts forward and backward from the first date', () => {
    assert.equal(dayOffset('2026-08-04', '2026-08-06'), 2);
    assert.equal(dayOffset('2026-08-06', '2026-08-04'), -2);
    assert.equal(dayOffset('2026-08-04', '2026-08-04'), 0);
  });

  test('crosses a month and a year', () => {
    assert.equal(dayOffset('2026-07-31', '2026-08-01'), 1);
    assert.equal(dayOffset('2025-12-31', '2026-01-01'), 1);
  });

  test('a date it cannot read is no distance at all', () => {
    assert.equal(dayOffset('', '2026-08-04'), null);
    assert.equal(dayOffset('plus tard', '2026-08-04'), null);
  });
});

// The two sides of a pair sit within a week of each other, either side of the
// bank line.
describe('matchGap', () => {
  const bank = '2026-08-10';

  test('accepts an expense up to a week before the bank line', () => {
    assert.equal(matchGap(bank, '2026-08-03'), 7);
    assert.equal(matchGap(bank, '2026-08-09'), 1);
    assert.equal(matchGap(bank, bank), 0);
  });

  test('accepts an expense up to a week after the bank line', () => {
    assert.equal(matchGap(bank, '2026-08-17'), 7);
    assert.equal(matchGap(bank, '2026-08-11'), 1);
  });

  test('refuses either side past the week', () => {
    assert.equal(matchGap(bank, '2026-08-02'), null);
    assert.equal(matchGap(bank, '2026-08-18'), null);
    assert.equal(matchGap(bank, '2025-08-10'), null);
    assert.equal(matchGap(bank, '2027-08-10'), null);
  });

  test('a date it cannot read is no match', () => {
    assert.equal(matchGap(bank, ''), null);
    assert.equal(matchGap('', '2026-08-10'), null);
  });
});

describe('sameMoney', () => {
  test('one cent apart is not the same total', () => {
    assert.equal(sameMoney(46.00, 46.01), false);
    assert.equal(sameMoney(46.01, 46.00), false);
  });

  test('the same total either way round the sign', () => {
    assert.equal(sameMoney(-46.01, 46.01), true);
    assert.equal(sameMoney(46.01, 46.01), true);
  });

  test('reads a total written as a string', () => {
    assert.equal(sameMoney('46.01', 46.01), true);
  });

  test('a total it cannot read matches nothing', () => {
    assert.equal(sameMoney(NaN, 46.01), false);
    assert.equal(sameMoney(undefined, 46.01), false);
  });
});

describe('planMatches', () => {
  const storedBank = (id, date, amount = -38.94) => ({ id, date, amount, sources: ['cibc'], matchAmount: null });
  const storedSplitwise = (id, date, matchAmount = 38.94) => ({ id, date, amount: -19.47, sources: ['splitwise'], matchAmount });
  const expense = (id, date, amount = 38.94) => candidate({ id, source: 'splitwise', date, amount: -19.47, matchHint: { date, amount } });

  test('pairs an incoming expense with the bank line that paid it', () => {
    const plan = planMatches([expense('sw', '2026-08-04')], [storedBank('bank', '2026-08-06')]);
    assert.equal(plan.size, 1);
    assert.equal([...plan.values()][0].id, 'bank');
  });

  test('pairs an incoming bank line with the expense that reported it', () => {
    const bank = candidate({ id: 'bank', source: 'cibc', date: '2026-08-06', amount: -38.94 });
    const plan = planMatches([bank], [storedSplitwise('sw', '2026-08-04')]);
    assert.equal(plan.get(bank).id, 'sw');
  });

  test('leaves a bank line alone when the expense is far too old', () => {
    assert.equal(planMatches([expense('sw', '2025-01-01')], [storedBank('bank', '2026-08-06')]).size, 0);
  });

  test('the closest pair takes the row, whatever order the lines come in', () => {
    const far = expense('far', '2026-08-01');
    const near = expense('near', '2026-08-06');
    const plan = planMatches([far, near], [storedBank('bank', '2026-08-06')]);
    assert.equal(plan.has(far), false);
    assert.equal(plan.get(near).id, 'bank');
  });

  test('an expense takes one row and a row answers to one expense', () => {
    const first = expense('sw1', '2026-08-06');
    const second = expense('sw2', '2026-08-07');
    const plan = planMatches([first, second], [storedBank('b1', '2026-08-06'), storedBank('b2', '2026-08-07')]);
    assert.equal(plan.get(first).id, 'b1');
    assert.equal(plan.get(second).id, 'b2');
  });

  test('ignores a stored row that already carries both sources', () => {
    const bank = candidate({ id: 'bank', source: 'cibc', date: '2026-08-06', amount: -38.94 });
    const joined = { ...storedSplitwise('sw', '2026-08-04'), sources: ['splitwise', 'cibc'] };
    assert.equal(planMatches([bank], [joined]).size, 0);
  });

  test('a different total is never a pair', () => {
    assert.equal(planMatches([expense('sw', '2026-08-06', 41.10)], [storedBank('bank', '2026-08-06')]).size, 0);
  });
});
