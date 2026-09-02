import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  plannedFor, plannedForCategory, nativeLabel, spentBySlot, incomeBySlot, spent, income, planned, adjust, netWorth,
  slotOf,
} from '../js/views/dashboardCalc.js';
import * as calc from '../js/views/dashboardCalc.js';

// A line of the budget is a (group, category) pair, so the maps these
// functions return are keyed by that pair rather than by a bare name.
const slot = (category, group = '') => slotOf({ category, group });

function tx(overrides) {
  return { id: 't' + Math.random(), kind: 'reel', date: '2026-08-01', description: 'x', amount: -10, category: 'Épicerie', status: 'active', freq: null, month: null, ...overrides };
}

describe('plannedFor', () => {
  test('mensuel is the raw monthly amount', () => {
    assert.equal(plannedFor({ amount: -700, freq: 'mensuel' }, '2026-08'), 700);
  });
  test('bihebdo converts a 2-week amount to a monthly equivalent', () => {
    assert.equal(plannedFor({ amount: -150, freq: 'bihebdo' }, '2026-08'), 150 * 26 / 12);
  });
  test('annuel divides by 12', () => {
    assert.equal(plannedFor({ amount: -1200, freq: 'annuel' }, '2026-08'), 100);
  });
  test('ponctuel only counts in its target month', () => {
    assert.equal(plannedFor({ amount: -590, freq: 'ponctuel', month: 12 }, '2026-12'), 590);
    assert.equal(plannedFor({ amount: -590, freq: 'ponctuel', month: 12 }, '2026-08'), 0);
  });
  test('exact only counts for its exact year-month, unlike ponctuel which recurs yearly', () => {
    assert.equal(plannedFor({ amount: -56.32, freq: 'exact', month: '2027-03' }, '2027-03'), 56.32);
    assert.equal(plannedFor({ amount: -56.32, freq: 'exact', month: '2027-03' }, '2026-03'), 0);
  });
});

describe('nativeLabel', () => {
  test('exact shows the amount and the French month/year label', () => {
    assert.equal(nativeLabel({ amount: -56.32, freq: 'exact', month: '2027-03' }), '56 $ · mars 2027');
  });
});

describe('plannedForCategory', () => {
  test('sums recurring plans when there is no exact override for the month', () => {
    const plans = [{ amount: -700, freq: 'mensuel' }, { amount: -1180, freq: 'ponctuel', month: 6 }];
    assert.equal(plannedForCategory(plans, '2026-06'), 700 + 1180);
    assert.equal(plannedForCategory(plans, '2026-08'), 700);
  });

  test('an exact override replaces (not adds to) recurring plans for that one month', () => {
    const plans = [{ amount: -700, freq: 'mensuel' }, { amount: -950, freq: 'exact', month: '2026-08' }];
    assert.equal(plannedForCategory(plans, '2026-08'), 950);
    assert.equal(plannedForCategory(plans, '2026-09'), 700); // untouched months keep the recurring amount
  });
});

describe('spentBySlot / incomeBySlot', () => {
  test('groups real expenses by category for the given month, ignoring other months/kinds', () => {
    const rows = [
      tx({ amount: -50, category: 'Épicerie', date: '2026-08-05' }),
      tx({ amount: -20, category: 'Épicerie', date: '2026-08-10' }),
      tx({ amount: -30, category: 'Transport', date: '2026-08-10' }),
      tx({ amount: -99, category: 'Épicerie', date: '2026-07-10' }), // wrong month
      tx({ amount: -99, category: 'Épicerie', date: '2026-08-10', kind: 'planifie' }), // wrong kind
    ];
    const bySlot = spentBySlot(rows, '2026-08');
    assert.equal(bySlot[slot('Épicerie')], 70);
    assert.equal(bySlot[slot('Transport')], 30);
    assert.equal(spent(rows, '2026-08'), 100);
  });

  test('income groups positive amounts', () => {
    const rows = [tx({ amount: 2390, category: 'Revenus', date: '2026-08-15' })];
    assert.equal(incomeBySlot(rows, '2026-08')[slot('Revenus')], 2390);
    assert.equal(income(rows, '2026-08'), 2390);
  });

  test('excluded transactions do not count', () => {
    const rows = [tx({ amount: -50, status: 'excluded' })];
    assert.equal(spent(rows, '2026-08'), 0);
  });
});

describe('planned', () => {
  test('sums plannedFor across all planifie rows for the month', () => {
    const rows = [
      tx({ kind: 'planifie', amount: -700, freq: 'mensuel' }),
      tx({ kind: 'planifie', amount: -1180, freq: 'ponctuel', month: 6 }),
    ];
    assert.equal(planned(rows, '2026-06'), 700 + 1180);
    assert.equal(planned(rows, '2026-08'), 700);
  });

  test('an exact override for one category does not double-count alongside its recurring plan', () => {
    const rows = [
      tx({ kind: 'planifie', category: 'Épicerie', amount: -700, freq: 'mensuel' }),
      tx({ kind: 'planifie', category: 'Épicerie', amount: -950, freq: 'exact', month: '2026-08' }),
      tx({ kind: 'planifie', category: 'Transport', amount: -80, freq: 'mensuel' }),
    ];
    assert.equal(planned(rows, '2026-08'), 950 + 80);
    assert.equal(planned(rows, '2026-09'), 700 + 80);
  });
});

describe('adjust', () => {
  test('sums ajustement rows for the given month only', () => {
    const rows = [
      tx({ kind: 'ajustement', amount: 500, date: '2026-08-28' }),
      tx({ kind: 'ajustement', amount: -200, date: '2026-07-28' }),
    ];
    assert.equal(adjust(rows, '2026-08'), 500);
  });
});

describe('netWorth', () => {
  test('with a solde anchor, adds flows since the anchor', () => {
    const rows = [
      tx({ kind: 'solde', amount: 38400, date: '2026-01-01' }),
      tx({ kind: 'reel', amount: 2390, date: '2026-02-15' }),
      tx({ kind: 'reel', amount: -1450, date: '2026-02-01' }),
    ];
    assert.equal(netWorth(rows, '2026-02'), 38400 + 2390 - 1450);
  });

  test('before the only anchor, subtracts flows that happened between the query month and the anchor', () => {
    const rows = [
      tx({ kind: 'solde', amount: 10000, date: '2026-03-15' }),
      tx({ kind: 'reel', amount: -500, date: '2026-03-01' }), // between end of Feb and the anchor
      tx({ kind: 'reel', amount: -999, date: '2026-01-10' }), // before the query month: irrelevant here
    ];
    // net worth at end of Feb, walking backward from the March anchor: undo the -500 that
    // happened after Feb but before the anchor. The January transaction predates our query
    // window entirely so it can't be inferred from this single future anchor.
    assert.equal(netWorth(rows, '2026-02'), 10000 - (-500));
  });

  test('with no anchor at all, falls back to raw cumulative flows', () => {
    const rows = [
      tx({ kind: 'reel', amount: 1000, date: '2026-01-10' }),
      tx({ kind: 'reel', amount: -200, date: '2026-02-05' }),
    ];
    assert.equal(netWorth(rows, '2026-02'), 800);
  });
});

describe('planned amounts standing in for missing actuals', () => {
  const isIncome = (s) => s === slot('Salaire');
  const rows = [
    tx({ id: 'r1', kind: 'reel', date: '2026-03-04', amount: -580, category: 'Épicerie' }),
    tx({ id: 'p1', kind: 'planifie', freq: 'mensuel', amount: 620, category: 'Épicerie' }),
    tx({ id: 'p2', kind: 'planifie', freq: 'mensuel', amount: 400, category: 'Voyage' }),
    tx({ id: 'p3', kind: 'planifie', freq: 'mensuel', amount: 4000, category: 'Salaire' }),
  ];

  test('a real amount always wins over the budget, however small', () => {
    const small = [
      tx({ id: 'r', kind: 'reel', date: '2026-03-04', amount: -5, category: 'Épicerie' }),
      tx({ id: 'p', kind: 'planifie', freq: 'mensuel', amount: 620, category: 'Épicerie' }),
    ];
    assert.equal(calc.effectiveSpentBySlot(small, '2026-03')[slot('Épicerie')], 5);
  });

  test('fills only the categories that have no actual for that month', () => {
    const eff = calc.effectiveSpentBySlot(rows, '2026-03', isIncome);
    assert.equal(eff[slot('Épicerie')], 580);
    assert.equal(eff[slot('Voyage')], 400);
  });

  test('a month with no actuals at all falls back entirely to the budget', () => {
    const eff = calc.effectiveSpentBySlot(rows, '2026-04', isIncome);
    assert.equal(eff[slot('Épicerie')], 620);
    assert.equal(eff[slot('Voyage')], 400);
    assert.equal(calc.effectiveSpent(rows, '2026-04', isIncome), 1020);
  });

  test('income categories fill from their own plans, not from the expense side', () => {
    assert.equal(calc.effectiveIncome(rows, '2026-04', isIncome), 4000);
    assert.equal(calc.effectiveSpentBySlot(rows, '2026-04', isIncome)[slot('Salaire')], undefined);
  });

  test('without an isIncomeSlot predicate every plan counts as spending', () => {
    assert.equal(calc.effectiveIncome(rows, '2026-04'), 0);
    assert.equal(calc.effectiveSpent(rows, '2026-04'), 5020);
  });

  test('leaves the raw figures alone — the cells still show what really happened', () => {
    assert.equal(calc.spent(rows, '2026-04'), 0);
    assert.equal(calc.income(rows, '2026-04'), 0);
  });

  test('a category with no plan at all is never invented', () => {
    assert.equal(calc.effectiveSpentBySlot(rows, '2026-04', isIncome)[slot('Restaurants')], undefined);
  });

  test('an exact per-cell override is what gets substituted for its month', () => {
    const withOverride = [
      ...rows,
      tx({ id: 'x', kind: 'planifie', freq: 'exact', month: '2026-05', amount: 999, category: 'Voyage' }),
    ];
    assert.equal(calc.effectiveSpentBySlot(withOverride, '2026-05', isIncome)[slot('Voyage')], 999);
    assert.equal(calc.effectiveSpentBySlot(withOverride, '2026-06', isIncome)[slot('Voyage')], 400);
  });
});
