import { shift } from './format.js';

// The budget's start month ('YYYY-MM', or null for "no limit"). Anything that
// moved money before it is treated as not part of this budget at all: it is
// refused at import and hidden everywhere in the UI.
//
// Balance anchors (`solde`), goals and plans are deliberately exempt. A
// `solde` row IS the opening balance — dropping it because it predates the
// start month would leave the net worth with nothing to count from.
const MOVEMENT_KINDS = ['reel', 'ajustement'];

export function isBeforeBudgetStart(tx, startMonth) {
  if (!startMonth || !MOVEMENT_KINDS.includes(tx.kind || 'reel')) return false;
  const date = tx.date || '';
  return !!date && date.slice(0, 7) < startMonth;
}

export function filterFromBudgetStart(transactions, startMonth) {
  if (!startMonth) return transactions;
  return transactions.filter(t => !isBeforeBudgetStart(t, startMonth));
}

// The 12-month window may reach back to the start month and no further, so
// its last month can never sit less than 11 months after the start.
export function clampWindowEnd(winEnd, startMonth) {
  if (!startMonth || !winEnd) return winEnd;
  const earliest = shift(startMonth, 11);
  return winEnd < earliest ? earliest : winEnd;
}

export function canScrollBack(winEnd, startMonth) {
  return !startMonth || winEnd > shift(startMonth, 11);
}
