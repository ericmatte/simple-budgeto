import { stableHash } from '../lib/normalize.js';

// An import is deliberately boring now: retain every readable transaction and
// only prevent true re-imports.  Budget rules, categories and automatic
// exclusions used to make an import surprisingly destructive.
export function normalizeDescription(s) {
  return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function dedupeKey(c) {
  return stableHash(c.kind || 'reel', c.date, normalizeDescription(c.description), Math.round((c.amount || 0) * 100));
}

// The two totals have to be the same to the cent: 46.00 and 46.01 are two
// different purchases. Compared as whole cents, because 46.01 - 46.00 is not
// 0.01 in floating point and any tolerance written that way lets the pair
// through.
export const sameMoney = (a, b) => Math.round(Math.abs(Number(a)) * 100) === Math.round(Math.abs(Number(b)) * 100);

function existingSlots(transactions) {
  return (transactions || []).map(t => ({ key: dedupeKey(t), legacyKey: t.dedupeKey, used: false }));
}

const MATCH_WINDOW_DAYS = 7;

export function dayOffset(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86400000);
}

// A purchase is entered in Splitwise around the day it happens and the card
// posts it a few days either side, so the two sides of a pair sit within a
// week of each other. Further apart they are two different purchases that
// happen to carry the same total — the very case a years-old export would
// otherwise match onto a fresh statement.
export function matchGap(bankDate, splitwiseDate) {
  const offset = dayOffset(bankDate, splitwiseDate);
  if (offset === null || Math.abs(offset) > MATCH_WINDOW_DAYS) return null;
  return Math.abs(offset);
}

// One expense pays for one line and one line answers to one expense, so the
// closest pairs are made first: made in file order, an expense five days out
// would take the line its neighbour needed on the day itself.
function assignClosestFirst(pairs) {
  const chosen = new Map();
  const taken = new Set();
  for (const pair of [...pairs].sort((a, b) => a.gap - b.gap)) {
    if (chosen.has(pair.expense) || taken.has(pair.line)) continue;
    chosen.set(pair.expense, pair.line);
    taken.add(pair.line);
  }
  return chosen;
}

const alreadyJoined = sources => (sources || []).some(source => source !== 'splitwise');

// Every pair an import can make with what is already stored, since the two
// files rarely arrive in the same session. Read from whichever side is coming
// in: a Splitwise expense looks for the bank line that paid it, a bank line
// for the expense that reported it.
export function planMatches(items, transactions) {
  const pairs = [];
  for (const item of items) {
    const total = item.source === 'splitwise' ? item.matchHint?.amount : null;
    for (const stored of transactions || []) {
      const storedIsSplitwise = (stored.sources || []).includes('splitwise');
      const gap = total != null
        ? (!storedIsSplitwise && sameMoney(stored.amount, total) ? matchGap(stored.date, item.matchHint.date) : null)
        : (item.source !== 'splitwise' && storedIsSplitwise && !alreadyJoined(stored.sources)
          && stored.matchAmount != null && sameMoney(stored.matchAmount, item.amount)
          ? matchGap(item.date, stored.date) : null);
      if (gap !== null) pairs.push({ expense: item, line: stored, gap });
    }
  }
  return assignClosestFirst(pairs);
}

// A Splitwise expense reports the total paid on the bank statement in
// `matchHint`. The total must be exact — never merchant-name guessing — but
// the two sides may fall on different days, within the window above.
function joinSplitwise(items) {
  const pairs = [];
  for (const splitwise of items) {
    if (splitwise.source !== 'splitwise' || !splitwise.matchHint || splitwise.status !== 'ok') continue;
    for (const bank of items) {
      if (bank === splitwise || bank.status !== 'ok' || bank.source === 'splitwise') continue;
      if (!sameMoney(bank.amount, splitwise.matchHint.amount)) continue;
      const gap = matchGap(bank.date, splitwise.matchHint.date);
      if (gap !== null) pairs.push({ expense: splitwise, line: bank, gap });
    }
  }
  for (const [splitwise, bank] of assignClosestFirst(pairs)) {
    bank.matchedSource = 'splitwise';
    // The row keeps the bank line's day, name and file, but what it owes is
    // the share Splitwise gives the user, not the total that left the account.
    // That total is kept aside in matchAmount.
    bank.amount = splitwise.amount;
    bank.matchAmount = splitwise.matchHint.amount;
    bank.matchDescription = splitwise.description;
    bank.matchCategory = splitwise.suggestedCategory || '';
    bank.matchGroup = splitwise.splitwiseGroup || '';
    bank.matchDate = splitwise.matchHint.date !== bank.date ? splitwise.matchHint.date : null;
    bank.matchedRaw = { source: splitwise.source, file: splitwise.fileLabel || '', header: splitwise.rawHeader || '', line: splitwise.rawLine || '' };
    splitwise.status = 'merged';
    splitwise.included = false;
    splitwise.mergedInto = bank.id;
  }
}

export function buildPreview(candidates, existingTransactions) {
  const slots = existingSlots(existingTransactions);
  const items = candidates.map(c => ({
    ...c,
    dedupeKey: c.error ? null : dedupeKey(c),
    status: c.error ? 'error' : 'ok',
    reason: c.error?.reason || null,
    included: !c.error,
  }));

  for (const item of items) {
    if (item.status !== 'ok') continue;
    const slot = slots.find(s => !s.used && (s.key === item.dedupeKey || s.legacyKey === item.dedupeKey));
    if (!slot) continue;
    slot.used = true;
    item.status = 'duplicate';
    item.included = false;
    item.reason = 'Déjà importée précédemment';
  }
  joinSplitwise(items);
  return items;
}

// Files do not have to be imported in the same session: when the counterpart
// arrives later, it enriches the stored row instead of adding a second line.
// The bank statement is the truth about the day the money moved and the name
// it moved under — a Splitwise expense is typed by hand, often days before the
// card posts it. Splitwise is the truth about how much of that total the user
// actually owes. The Splitwise day is kept aside when the two differ.
export function mergeMatched(stored, item, incoming) {
  const fromSplitwise = item.source === 'splitwise';
  const bankDate = fromSplitwise ? stored.date : incoming.date;
  const splitwiseDate = fromSplitwise ? item.matchHint.date : stored.date;
  return {
    ...stored,
    ...(fromSplitwise ? {} : {
      date: incoming.date, description: incoming.description,
      dedupeKey: incoming.dedupeKey, file: incoming.file,
    }),
    amount: fromSplitwise ? incoming.amount : stored.amount,
    // The bank line takes over the description, so the Splitwise wording is
    // the one that steps aside — whichever of the two arrived first.
    matchDescription: (fromSplitwise ? incoming.description : stored.description) || stored.matchDescription || '',
    swCategory: (fromSplitwise ? incoming.swCategory : '') || stored.swCategory || '',
    swGroup: (fromSplitwise ? incoming.swGroup : '') || stored.swGroup || '',
    sources: [...new Set([...(stored.sources || []), item.source])],
    matchAmount: (fromSplitwise ? item.matchHint.amount : null) || stored.matchAmount,
    matchDate: splitwiseDate !== bankDate ? splitwiseDate : null,
    rawEntries: [...(stored.rawEntries || []), ...(incoming.rawEntries || [])],
  };
}

export function toStoredTransaction(item, importBatchId) {
  const rawEntries = [{ source: item.source, file: item.fileLabel || '', header: item.rawHeader || '', line: item.rawLine || '' }];
  if (item.matchedRaw) rawEntries.push(item.matchedRaw);
  return {
    id: item.id, dedupeKey: item.dedupeKey, kind: item.kind || 'reel',
    date: item.date || '', description: item.description, amount: item.amount,
    note: item.note || '', sources: [item.source, item.matchedSource].filter(Boolean),
    matchAmount: item.matchAmount || item.matchHint?.amount || null,
    // The day of the other source's line, kept only when the two sides of a
    // match fall on different days: the row then says so instead of quietly
    // showing one of the two dates.
    matchDate: item.matchDate || null,
    // What the other source called the same purchase. A statement names the
    // merchant it was billed by; Splitwise names what was actually bought, and
    // a matched row is worth more with both.
    matchDescription: item.matchDescription || '',
    // How Splitwise itself filed the expense. Only that side of a match can
    // answer for it: a bank parser puts its own guess in `suggestedCategory`.
    swCategory: (item.source === 'splitwise' ? item.suggestedCategory : item.matchCategory) || '',
    // Which Splitwise group the expense was shared in. The reader keeps
    // several at once, so the row has to say which one it belongs to.
    swGroup: (item.source === 'splitwise' ? item.splitwiseGroup : item.matchGroup) || '',
    rawEntries,
    file: item.fileLabel || '', importBatchId, status: 'active',
    // Kept empty for backwards-compatible CSVs; no screen uses these fields.
    category: '', group: '', freq: null, month: null, linkedId: null,
  };
}
