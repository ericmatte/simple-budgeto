import { money, MN, ymLabel, monthEnd } from '../lib/format.js';
import { slotKey } from '../storage/config.js';

function active(transactions) {
  return transactions.filter(t => t.status !== 'excluded' && t.status !== 'deleted');
}

// A line of the budget is a group *and* a category, never a category alone:
// "Restaurants" of the everyday budget and "Restaurants" of a trip are two
// lines, with two budgets and two totals. Callers resolve each row's group
// once (see storage/config.js `groupOf`) and everything here keys on the pair.
export function slotOf(r, fallbackCategory) {
  return slotKey(r.group || '', r.category || fallbackCategory || '');
}

export function plannedFor(r, key) {
  const a = Math.abs(r.amount);
  if (r.freq === 'mensuel') return a;
  if (r.freq === 'bihebdo') return a * 26 / 12;
  if (r.freq === 'annuel') return a / 12;
  if (r.freq === 'ponctuel') return Number(key.split('-')[1]) === Number(r.month) ? a : 0;
  if (r.freq === 'exact') return r.month === key ? a : 0;
  return 0;
}

export function nativeLabel(r) {
  const a = Math.abs(r.amount);
  if (r.freq === 'mensuel') return money(a) + '/mois';
  if (r.freq === 'bihebdo') return money(a) + '/2 sem. → ' + money(a * 26 / 12) + '/mois';
  if (r.freq === 'annuel') return money(a) + '/an → ' + money(a / 12) + '/mois';
  if (r.freq === 'exact') return money(a) + ' · ' + ymLabel(r.month);
  return money(a) + ' · ponctuel en ' + MN[Math.max(0, Math.min(11, Number(r.month) - 1))];
}

// A "planifie" row with freq 'exact' is a per-cell override typed directly
// into the 12-month table for one specific category+month — it takes
// priority over that category's recurring plans (mensuel/annuel/bihebdo/
// ponctuel) for that one month only, instead of stacking on top of them.
export function plannedForCategory(categoryPlans, key) {
  const override = categoryPlans.find(p => p.freq === 'exact' && p.month === key);
  if (override) return Math.abs(override.amount);
  return categoryPlans.reduce((a, p) => a + (p.freq === 'exact' ? 0 : plannedFor(p, key)), 0);
}

export function spentBySlot(transactions, key) {
  const out = {};
  for (const r of active(transactions)) {
    if (r.kind !== 'reel' || r.amount >= 0 || (r.date || '').slice(0, 7) !== key) continue;
    const slot = slotOf(r, 'Non classé');
    out[slot] = (out[slot] || 0) + Math.abs(r.amount);
  }
  return out;
}

export function incomeBySlot(transactions, key) {
  const out = {};
  for (const r of active(transactions)) {
    if (r.kind !== 'reel' || r.amount <= 0 || (r.date || '').slice(0, 7) !== key) continue;
    const slot = slotOf(r, 'Revenus');
    out[slot] = (out[slot] || 0) + r.amount;
  }
  return out;
}

export function spent(transactions, key) {
  return Object.values(spentBySlot(transactions, key)).reduce((a, v) => a + v, 0);
}

export function income(transactions, key) {
  return Object.values(incomeBySlot(transactions, key)).reduce((a, v) => a + v, 0);
}

export function plansBySlot(transactions) {
  const bySlot = new Map();
  for (const r of active(transactions)) {
    if (r.kind !== 'planifie') continue;
    const slot = slotOf(r);
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(r);
  }
  return bySlot;
}

export function planned(transactions, key) {
  let total = 0;
  for (const plans of plansBySlot(transactions).values()) total += plannedForCategory(plans, key);
  return total;
}

// The budgeted amount stands in for the real one whenever a category has a
// plan for a month and nothing actually landed on it. Without this, a month
// that was never imported (or paid in cash) reads as "spent nothing", and
// every future month flat-lines the projection at zero spending — which made
// the projected balance climb as if life stopped costing anything.
//
// A real amount always wins, however small: the substitution only fills a
// hole, it never tops anything up.
function withPlanFallback(realBySlot, transactions, key, wanted) {
  const out = { ...realBySlot };
  for (const [slot, plans] of plansBySlot(transactions)) {
    if (out[slot] || !wanted(slot)) continue;
    const amount = plannedForCategory(plans, key);
    if (amount > 0) out[slot] = amount;
  }
  return out;
}

// `isIncomeSlot` decides which side of the budget a plan belongs to — a
// planned row carries no sign of its own, only the group it is filed under
// says whether it is money coming in or going out.
export function effectiveSpentBySlot(transactions, key, isIncomeSlot = () => false) {
  return withPlanFallback(spentBySlot(transactions, key), transactions, key, s => !isIncomeSlot(s));
}

export function effectiveIncomeBySlot(transactions, key, isIncomeSlot = () => false) {
  return withPlanFallback(incomeBySlot(transactions, key), transactions, key, isIncomeSlot);
}

export function effectiveSpent(transactions, key, isIncomeSlot) {
  return Object.values(effectiveSpentBySlot(transactions, key, isIncomeSlot)).reduce((a, v) => a + v, 0);
}

export function effectiveIncome(transactions, key, isIncomeSlot) {
  return Object.values(effectiveIncomeBySlot(transactions, key, isIncomeSlot)).reduce((a, v) => a + v, 0);
}

export function adjust(transactions, key) {
  return active(transactions)
    .filter(r => r.kind === 'ajustement' && (r.date || '').slice(0, 7) === key)
    .reduce((a, r) => a + r.amount, 0);
}

export function flows(transactions, afterDate, throughDate) {
  return active(transactions).reduce((a, r) => {
    if (r.kind !== 'reel' && r.kind !== 'ajustement') return a;
    if (!r.date || r.date <= afterDate || r.date > throughDate) return a;
    return a + r.amount;
  }, 0);
}

export function netWorth(transactions, key) {
  const end = monthEnd(key);
  const anchors = active(transactions)
    .filter(r => r.kind === 'solde' && r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!anchors.length) return flows(transactions, '0000-00-00', end);
  const before = anchors.filter(a => a.date <= end);
  if (before.length) {
    const a = before[before.length - 1];
    return a.amount + flows(transactions, a.date, end);
  }
  const a = anchors[0];
  return a.amount - flows(transactions, end, a.date);
}
