import { stableHash } from './lib/normalize.js';

// Seed data for the demo mode: three months of transactions, one file per
// supported format, generated relative to today so the list always opens on
// something. Fed to the real store, which keeps it in memory.
//
// Every row carries the raw CSV line it would have arrived on, built from its
// own date and amount — opening a row in the demo shows the same source-line
// panel a real import does, and the two never disagree.

const MONTHS = 3;
const ME = 'Alix N.';
const ROOMMATES = 'Colocs Sainte-Brise';
const TRIP = 'Escapade 2026';

const FILES = {
  cibc: 'cibc-visa-releve.csv',
  tangerine: 'tangerine-mastercard.csv',
  wealthsimple: 'wealthsimple-activities.csv',
  generic: 'budget-2026.csv',
  [ROOMMATES]: 'colocs-sainte-brise_export.csv',
  [TRIP]: 'escapade-2026_export.csv',
};

// The header each export actually ships. CIBC has none — its columns are
// named by the view's own fallback list.
const HEADERS = {
  cibc: '',
  tangerine: 'Transaction date,Transaction,Name,Memo,Amount',
  wealthsimple: 'effective_at,settlement_date,account_id,account_type,activity_type,activity_sub_type,description,direction,symbol,name,currency,quantity,unit_price,commission,net_cash_amount',
  generic: 'date;type;description;montant;categorie',
  splitwise: `Date,Description,Category,Cost,Currency,${ME},Bruno L.`,
};

const money2 = (n) => Math.abs(n).toFixed(2);
const mdy = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const quote = (s) => (s.includes(',') ? `"${s}"` : s);

const RAW_LINE = {
  cibc: (date, label, amount) =>
    `${date},${quote(label)},${amount < 0 ? money2(amount) : ''},${amount > 0 ? money2(amount) : ''},4506******1234`,
  tangerine: (date, label, amount, memo = '') =>
    `${mdy(date)},${amount < 0 ? 'DEBIT' : 'CREDIT'},${quote(label)},${quote(memo)},${amount.toFixed(2)}`,
  wealthsimple: (date, label, amount, subType) =>
    `${date}T20:00:00-04:00,,DEMO,Chequing,MoneyMovement,${subType},${quote(label)},,,,CAD,${amount.toFixed(2)},,,${amount.toFixed(2)}`,
  generic: (date, label, amount, category) => `${date};reel;${label};${amount.toFixed(2)};${category}`,
  // Splitwise states the full cost and then what each member's share of it is.
  splitwise: (date, label, category, cost, myShare) =>
    `${date},${quote(label)},${category},${cost.toFixed(2)},CAD,${myShare.toFixed(2)},${(-myShare).toFixed(2)}`,
};

// Deterministic pseudo-random, so the demo looks the same on every reload —
// a list whose numbers dance around on refresh is impossible to reason about.
function jitter(seed, spread) {
  if (!spread) return 0;
  const h = [...String(seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100000, 7);
  return ((h % 1000) / 1000 - 0.5) * spread;
}

function monthKey(offset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function vary(seed, base, spread) {
  return Math.round((base + jitter(seed, spread)) * 100) / 100;
}

function row(fields) {
  return {
    id: fields.id, dedupeKey: fields.dedupeKey || fields.id, kind: 'reel',
    date: '', description: '', amount: 0, note: '',
    sources: [], matchAmount: null, matchDate: null, matchDescription: '',
    swCategory: '', swGroup: '', rawEntries: [], file: '',
    importBatchId: 'demo', status: 'active',
    category: '', group: '', freq: null, month: null, linkedId: null,
    ...fields,
  };
}

// A line that arrived from one file and nothing else.
function plain(key, day, { source, label, amount, spread = 0, memo, subType, category }) {
  const seed = `${key}-${label}-${day}`;
  const date = `${key}-${day}`;
  const value = vary(seed, amount, spread);
  const line = RAW_LINE[source](date, label, value, memo ?? subType ?? category);
  return row({
    id: `demo-${stableHash(seed)}`,
    date, description: label, amount: value, sources: [source], file: FILES[source],
    rawEntries: [{ source, file: FILES[source], header: HEADERS[source], line }],
  });
}

// A bank line and the Splitwise expense it settled, already reconciled — the
// shape confirmImport() leaves behind. `swDay` is the day Splitwise recorded
// the expense on: when it differs from the bank's, the row says so.
function shared(key, day, { source, label, amount, spread = 0, group, swLabel, swCategory, swDay, cost }) {
  const seed = `${key}-${swLabel}-${day}`;
  const date = `${key}-${day}`;
  const myShare = vary(seed, amount, spread);
  const swDate = `${key}-${swDay || day}`;
  const fullCost = cost || Math.round(myShare * -2 * 100) / 100;
  return row({
    id: `demo-${stableHash(seed)}`,
    date, description: label, amount: myShare,
    sources: [source, 'splitwise'],
    matchDescription: swLabel, matchAmount: fullCost,
    matchDate: swDate === date ? null : swDate,
    swCategory, swGroup: group, file: FILES[source],
    rawEntries: [
      { source, file: FILES[source], header: HEADERS[source], line: RAW_LINE[source](date, label, -fullCost, `Category: ${swCategory}`) },
      // I paid the whole thing, so my Splitwise column is what comes back to
      // me — the opposite sign of the share the row settles on.
      { source: 'splitwise', file: FILES[group], header: HEADERS.splitwise, line: RAW_LINE.splitwise(swDate, swLabel, swCategory, fullCost, -myShare) },
    ],
  });
}

// A Splitwise expense somebody else paid: there is no bank line to pair it
// with, so it stands on its own.
function owed(key, day, { group, swLabel, swCategory, amount, spread = 0 }) {
  const seed = `${key}-owed-${swLabel}-${day}`;
  const date = `${key}-${day}`;
  const myShare = vary(seed, amount, spread);
  const fullCost = Math.round(myShare * -2 * 100) / 100;
  return row({
    id: `demo-${stableHash(seed)}`,
    date, description: swLabel, amount: myShare,
    sources: ['splitwise'], matchAmount: fullCost,
    swCategory, swGroup: group, file: FILES[group],
    rawEntries: [{
      source: 'splitwise', file: FILES[group], header: HEADERS.splitwise,
      line: RAW_LINE.splitwise(date, swLabel, swCategory, fullCost, myShare),
    }],
  });
}

export function demoTransactions() {
  const out = [];

  for (let back = MONTHS - 1; back >= 0; back--) {
    const key = monthKey(back);

    out.push(plain(key, '01', { source: 'wealthsimple', label: 'Dépôt de paie', amount: 2190, spread: 140, subType: 'AFT_IN' }));
    out.push(plain(key, '15', { source: 'wealthsimple', label: 'Dépôt de paie', amount: 2190, spread: 140, subType: 'AFT_IN' }));
    out.push(plain(key, '02', { source: 'tangerine', label: 'LOYER SAINTE-BRISE', amount: -1450, memo: 'Category: Housing' }));
    out.push(plain(key, '05', { source: 'tangerine', label: 'ASSURANCE AUTO MISTRAL', amount: -162, memo: 'Category: Insurance' }));
    out.push(plain(key, '09', { source: 'cibc', label: 'ESSENCE PONANT W13 SAINTE-BRISE, QC', amount: -78, spread: 24 }));
    out.push(plain(key, '11', { source: 'cibc', label: 'PHARMACIE ZENITH #204', amount: -46, spread: 30 }));
    out.push(plain(key, '17', { source: 'cibc', label: 'SQ *CAFE ALIZE', amount: -12.25, spread: 5 }));
    out.push(plain(key, '22', { source: 'cibc', label: 'BOUTIQUE MISTRAL', amount: -88, spread: 55 }));
    out.push(plain(key, '24', { source: 'generic', label: 'Abonnement transport', amount: -97, category: 'Transport' }));

    // Money that moves without being a purchase: the list keeps it but steps
    // it back, and the cashback total in the header counts it.
    out.push(plain(key, '27', { source: 'cibc', label: 'CASHBACK/REMISE EN ARGENT', amount: 14.4, spread: 9 }));
    out.push(plain(key, '28', { source: 'cibc', label: 'PAIEMENT RECU - MERCI', amount: 1240, spread: 320 }));

    // Splitwise, both ways round: the groceries land on the day the card was
    // charged, so there is nothing to warn about; the internet bill was
    // entered in Splitwise days after the card posted it, and the row carries
    // the gap.
    out.push(shared(key, '07', {
      source: 'cibc', label: 'MARCHE NORDET #8 SAINTE-BRISE, QC', amount: -59.2, spread: 18,
      group: ROOMMATES, swLabel: 'Épicerie de la semaine', swCategory: 'Groceries',
    }));
    out.push(shared(key, '13', {
      source: 'tangerine', label: 'INTERNET LEVANT', amount: -47.25,
      group: ROOMMATES, swLabel: 'Facture Internet', swCategory: 'TV/Phone/Internet',
      swDay: '17', memo: 'Category: Utilities',
    }));
    out.push(shared(key, '19', {
      source: 'cibc', label: 'RESTO PONANT', amount: -34.5, spread: 16,
      group: TRIP, swLabel: 'Souper du vendredi', swCategory: 'Dining out',
      swDay: '21',
    }));

    out.push(owed(key, '20', { group: TRIP, swLabel: 'Location du chalet', swCategory: 'Housing', amount: -128, spread: 40 }));
    out.push(owed(key, '25', { group: ROOMMATES, swLabel: 'Produits ménagers', swCategory: 'Household supplies', amount: -19.47, spread: 8 }));
  }

  return out;
}
