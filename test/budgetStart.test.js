import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBeforeBudgetStart, filterFromBudgetStart, clampWindowEnd, canScrollBack,
} from '../js/lib/budgetStart.js';

const tx = (o) => ({ kind: 'reel', date: '2026-03-15', amount: -10, ...o });

describe('budget start month', () => {
  test('with no start month set, nothing is filtered', () => {
    const rows = [tx({ date: '2001-01-01' })];
    assert.deepEqual(filterFromBudgetStart(rows, null), rows);
    assert.equal(isBeforeBudgetStart(rows[0], null), false);
  });

  test('drops movements dated before the start month', () => {
    assert.equal(isBeforeBudgetStart(tx({ date: '2026-02-28' }), '2026-03'), true);
    assert.equal(isBeforeBudgetStart(tx({ date: '2026-03-01' }), '2026-03'), false);
  });

  test('keeps the whole of the start month itself', () => {
    const rows = [tx({ date: '2026-03-01' }), tx({ date: '2026-03-31' })];
    assert.equal(filterFromBudgetStart(rows, '2026-03').length, 2);
  });

  test('drops adjustments too, but never balance anchors, goals or plans', () => {
    const rows = [
      tx({ kind: 'ajustement', date: '2025-01-05' }),
      tx({ kind: 'solde', date: '2025-01-01', amount: 21400 }),
      tx({ kind: 'objectif', date: '', amount: 60000 }),
      tx({ kind: 'planifie', date: '', freq: 'mensuel' }),
    ];
    const kept = filterFromBudgetStart(rows, '2026-03').map(r => r.kind);
    assert.deepEqual(kept, ['solde', 'objectif', 'planifie']);
  });

  test('a movement with no date at all is never dropped', () => {
    assert.equal(isBeforeBudgetStart(tx({ date: '' }), '2026-03'), false);
  });

  test('the 12-month window cannot end earlier than 11 months after the start', () => {
    assert.equal(clampWindowEnd('2026-05', '2026-03'), '2027-02');
    assert.equal(clampWindowEnd('2027-02', '2026-03'), '2027-02');
    assert.equal(clampWindowEnd('2030-01', '2026-03'), '2030-01');
    assert.equal(clampWindowEnd('2026-05', null), '2026-05');
  });

  test('scrolling back stops exactly at the window that starts on the start month', () => {
    assert.equal(canScrollBack('2027-03', '2026-03'), true);
    assert.equal(canScrollBack('2027-02', '2026-03'), false);
    assert.equal(canScrollBack('2020-01', null), true);
  });
});
