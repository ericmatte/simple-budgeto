import { stableHash } from './lib/normalize.js';

// Seed data for the demo mode — a plausible year of budgeting, generated
// relative to today so the dashboard always opens on a populated window
// instead of an empty one. Fed to the real store, which keeps it in memory
// (no folder is picked, so nothing is ever written to disk).

const SPEND = [
  { category: 'Épicerie', base: 620, spread: 120, perMonth: 4, source: 'cibc', label: 'MARCHE NORDET' },
  { category: 'Restaurants', base: 210, spread: 90, perMonth: 3, source: 'cibc', label: 'RESTO PONANT' },
  { category: 'Logement', base: 1450, spread: 0, perMonth: 1, source: 'tangerine', label: 'LOYER' },
  { category: 'Services', base: 185, spread: 40, perMonth: 2, source: 'tangerine', label: 'ELECTRICITE REGIONALE' },
  { category: 'Transport', base: 240, spread: 70, perMonth: 2, source: 'cibc', label: 'ESSENCE PONANT' },
  { category: 'Santé', base: 95, spread: 45, perMonth: 1, source: 'cibc', label: 'PHARMACIE ZENITH' },
  { category: 'Assurance', base: 160, spread: 0, perMonth: 1, source: 'tangerine', label: 'ASSURANCE AUTO' },
  { category: 'Loisirs', base: 175, spread: 80, perMonth: 2, source: 'cibc', label: 'CINEMA ALIZE' },
  { category: 'Voyage', base: 0, spread: 900, perMonth: 1, source: 'cibc', label: 'BILLETS ALIZE' },
  { category: 'Enfants', base: 260, spread: 60, perMonth: 2, source: 'splitwise', label: 'GARDERIE' },
  { category: 'Vêtements', base: 110, spread: 70, perMonth: 1, source: 'cibc', label: 'BOUTIQUE MISTRAL' },
];

// Merchants nobody has told the budget about yet, so the demo opens with the
// "à classer" screen carrying something to do — which is where a real import
// leaves you.
const UNSORTED = [
  { label: 'RESTO PONANT #12', amount: -6.85, per: 4, source: 'cibc' },
  { label: 'BOUTIQUE EN LIGNE *4XK2', amount: -38.4, per: 2, source: 'cibc' },
  { label: 'SQ *CAFE ALIZE', amount: -12.25, per: 3, source: 'cibc' },
  { label: 'BAZAR LEVANT #118', amount: -21.8, per: 1, source: 'tangerine' },
];

// A Splitwise group that is a trip: its categories are Splitwise's own, and
// the group is filed under a project of the same name, so its spending gets a
// section of its own instead of diluting into the everyday categories.
const TRIP_GROUP = 'Escapade 2026';
const TRIP = [
  { swCategory: 'Dining out', amount: -64.2, per: 3 },
  { swCategory: 'Transportation', amount: -41.5, per: 2 },
  { swCategory: 'Entertainment', amount: -55.0, per: 1 },
];

const MONTHS_BACK = 10;

// Deterministic pseudo-random so the demo looks the same on every reload —
// a budget whose numbers dance around on refresh is impossible to reason about.
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

// The export each row would have arrived in — the "à classer" screen shows it
// so a line can be traced back to the file it came from.
const FILES = {
  cibc: 'cibc-releve-aout.csv',
  tangerine: 'tangerine-mastercard.csv',
  wealthsimple: 'wealthsimple-activities.csv',
  splitwise: 'splitwise-export.csv',
};

function row(fields) {
  return {
    id: fields.id, dedupeKey: fields.dedupeKey || fields.id, kind: 'reel', date: '', description: '',
    amount: 0, category: 'Non classé', group: '', freq: null, month: null, note: '', sources: [],
    linkedId: null, importBatchId: 'demo', status: 'active', matchAmount: null,
    swGroup: '', swCategory: '', file: '', ...fields,
  };
}

export function demoTransactions() {
  const out = [];
  const oldest = monthKey(MONTHS_BACK);

  out.push(row({
    id: 'demo-solde', kind: 'solde', date: `${oldest}-01`, amount: 21400,
    description: 'Solde de départ', category: '',
  }));
  out.push(row({
    id: 'demo-objectif', kind: 'objectif', amount: 60000,
    description: 'Mise de fonds maison', category: '',
  }));

  for (let back = MONTHS_BACK; back >= 0; back--) {
    const key = monthKey(back);
    out.push(row({
      id: `demo-paie-${key}`, date: `${key}-01`, amount: 4380 + Math.round(jitter(key, 300)),
      description: 'DEPOT SALAIRE', category: 'Revenus', sources: ['wealthsimple'], file: FILES.wealthsimple,
    }));
    if (back % 3 === 0) {
      out.push(row({
        id: `demo-bonus-${key}`, date: `${key}-15`, amount: 520,
        description: 'REMBOURSEMENT FRAIS', category: 'Revenus', sources: ['wealthsimple'],
      }));
    }

    for (const s of SPEND) {
      for (let n = 0; n < s.perMonth; n++) {
        const seed = `${key}-${s.category}-${n}`;
        const amount = (s.base / s.perMonth) + jitter(seed, s.spread);
        if (amount < 5) continue;
        const day = String(3 + ((n * 9 + s.category.length) % 24)).padStart(2, '0');
        out.push(row({
          id: `demo-${stableHash(seed)}`,
          date: `${key}-${day}`,
          amount: -Math.round(amount * 100) / 100,
          description: s.label,
          category: s.category,
          sources: [s.source],
          file: FILES[s.source] || '',
          note: s.source === 'splitwise' ? 'Part personnelle (Splitwise)' : '',
          matchAmount: s.source === 'splitwise' ? Math.round(amount * 200) / 100 : null,
        }));
      }
    }
  }

  // The last two months' worth of rows nobody has classified yet.
  for (let back = 1; back >= 0; back--) {
    const key = monthKey(back);
    for (const m of UNSORTED) {
      for (let n = 0; n < m.per; n++) {
        const seed = `${key}-${m.label}-${n}`;
        out.push(row({
          id: `demo-${stableHash(seed)}`,
          date: `${key}-${String(4 + ((n * 7) % 22)).padStart(2, '0')}`,
          amount: Math.round((m.amount + jitter(seed, 6)) * 100) / 100,
          description: m.label, sources: [m.source], file: FILES[m.source] || '',
        }));
      }
    }
    for (const t of TRIP) {
      for (let n = 0; n < t.per; n++) {
        const seed = `${key}-${t.swCategory}-${n}`;
        out.push(row({
          id: `demo-${stableHash(seed)}`,
          date: `${key}-${String(6 + ((n * 5) % 20)).padStart(2, '0')}`,
          amount: Math.round((t.amount + jitter(seed, 20)) * 100) / 100,
          description: `${t.swCategory} — ${TRIP_GROUP}`,
          sources: ['splitwise'], swGroup: TRIP_GROUP, swCategory: t.swCategory,
          file: `${TRIP_GROUP.toLowerCase().replace(/\s+/g, '-')}_export.csv`,
        }));
      }
    }
  }

  // Recurring budgets, so the 12-month table opens with real "réel vs prévu"
  // colouring rather than a wall of blank planning cells.
  for (const s of SPEND) {
    if (!s.base) continue;
    out.push(row({
      id: `demo-plan-${stableHash(s.category)}`, kind: 'planifie', freq: 'mensuel',
      amount: s.base, description: s.category, category: s.category,
    }));
  }

  return out;
}
