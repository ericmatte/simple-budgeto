import { merchantKey, merchantLabel, canonicalMerchantKey } from '../lib/merchants.js';
import { allCategories, resolveEmoji, splitwiseGroupConfig } from '../storage/config.js';
import { emojiFor } from '../categories.js';

// Grouping unclassified rows into the decisions that actually settle them.
//
// Six hundred lines are not six hundred decisions: they are thirty merchants
// and a handful of Splitwise categories. A cluster is one such decision — it
// carries every row it covers, so classifying it files them all at once and
// leaves a rule behind that spares the next import the same question.

export const UNCLASSIFIED = 'Non classé';

export function isUnclassified(t) {
  return t.kind === 'reel' && t.status !== 'deleted' && (!t.category || t.category === UNCLASSIFIED);
}

// A Splitwise row is grouped by the category Splitwise itself gave it, within
// its own group: "Dining out" among roommates and "Dining out" on a trip are
// two different answers. Everything else is grouped by merchant.
export function clusterKeyOf(t) {
  if (t.swCategory) return ['sw', t.swGroup || '', t.swCategory].join('\u001f');
  return ['m', merchantKey(t.description)].join('\u001f');
}

export function buildClusters(transactions, config) {
  const usage = categoryUsage(transactions);
  const byKey = new Map();
  // Every spelling of one merchant folds into its shortest form first, so a
  // branch that spells out its city doesn't ask the same question twice.
  const waiting = transactions.filter(isUnclassified);
  const merchantKeys = [...new Set(waiting.filter(t => !t.swCategory).map(t => merchantKey(t.description)))];
  const canonical = new Map(merchantKeys.map(k => [k, canonicalMerchantKey(k, merchantKeys)]));
  const keyOf = (t) => t.swCategory
    ? clusterKeyOf(t)
    : ['m', canonical.get(merchantKey(t.description))].join('\u001f');

  for (const t of waiting) {
    const key = keyOf(t);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        kind: t.swCategory ? 'splitwise' : 'merchant',
        splitwiseGroup: t.swGroup || '',
        splitwiseCategory: t.swCategory || '',
        merchantKey: t.swCategory ? '' : canonical.get(merchantKey(t.description)),
        descriptions: [],
        ids: [],
        // The rows themselves, so the inbox can show what a decision is
        // actually about — the dates, the real descriptions and the file each
        // line came from — instead of only their count.
        rows: [],
        total: 0,
        sources: new Set(),
      });
    }
    const cluster = byKey.get(key);
    cluster.descriptions.push(t.description);
    cluster.ids.push(t.id);
    cluster.rows.push({
      id: t.id, date: t.date || '', description: t.description,
      amount: Number(t.amount) || 0, file: t.file || '',
    });
    cluster.total += Number(t.amount) || 0;
    (t.sources || []).forEach(s => cluster.sources.add(s));
  }

  return [...byKey.values()]
    .map(c => ({
      ...c,
      sources: [...c.sources],
      rows: [...c.rows].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      label: c.kind === 'splitwise' ? c.splitwiseCategory : merchantLabel(c.descriptions),
      n: c.ids.length,
      total: Math.round(c.total * 100) / 100,
      superCategory: c.kind === 'splitwise' && c.splitwiseGroup
        ? splitwiseGroupConfig(config, c.splitwiseGroup).superCategory
        : null,
      guesses: guessCategories(c, config, usage),
    }))
    // Biggest amount first: the decisions worth making are at the top, and
    // stopping halfway still leaves the small change behind, not the rent.
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function categoryUsage(transactions) {
  const out = new Map();
  for (const t of transactions) {
    if (t.kind !== 'reel' || t.status === 'deleted') continue;
    if (!t.category || t.category === UNCLASSIFIED) continue;
    out.set(t.category, (out.get(t.category) || 0) + 1);
  }
  return out;
}

// Splitwise ships its own fixed category list, in English. Mapping the common
// ones is what makes the very first Splitwise import a matter of confirming
// rather than typing — a name that isn't in this table simply falls through
// to the generic guesses.
const SPLITWISE_HINTS = {
  'groceries': 'Épicerie', 'dining out': 'Restaurants', 'restaurants': 'Restaurants',
  'liquor': 'Restaurants', 'utilities': 'Services', 'electricity': 'Services',
  'heat/gas': 'Services', 'water': 'Services', 'tv/phone/internet': 'Services',
  'trash': 'Services', 'cleaning': 'Logement', 'rent': 'Logement', 'mortgage': 'Logement',
  'furniture': 'Logement', 'maintenance': 'Logement', 'household supplies': 'Logement',
  'home': 'Logement', 'transportation': 'Transport', 'gas/fuel': 'Transport',
  'parking': 'Transport', 'car': 'Transport', 'bus/train': 'Transport', 'taxi': 'Transport',
  'bicycle': 'Transport', 'plane': 'Voyage', 'hotel': 'Voyage', 'travel': 'Voyage',
  'entertainment': 'Loisirs', 'games': 'Loisirs', 'movies': 'Loisirs', 'music': 'Loisirs',
  'sports': 'Loisirs', 'pets': 'Chats', 'medical expenses': 'Santé', 'insurance': 'Assurance',
  'gifts': 'Cadeaux', 'clothing': 'Vêtements', 'childcare': 'Enfants', 'education': 'Enfants',
  'general': 'Achats divers', 'services': 'Services', 'taxes': 'Finances',
};

// Three plausible answers, best first — enough to settle most clusters with a
// single click and never enough to have to read a list.
export function guessCategories(cluster, config, usage = new Map()) {
  const known = allCategories(config);
  const out = [];
  const take = (name) => {
    if (name && known.includes(name) && !out.includes(name)) out.push(name);
  };

  if (cluster.kind === 'splitwise') take(SPLITWISE_HINTS[String(cluster.splitwiseCategory || '').toLowerCase().trim()]);

  // The app already knows which emoji a piece of wording deserves ("marché"
  // earns the grocery cart). Reading that back through the categories' own
  // emoji turns it into a category guess, without a second vocabulary to keep
  // in sync.
  const text = cluster.kind === 'splitwise' ? cluster.splitwiseCategory : cluster.descriptions.join(' ');
  const emoji = emojiFor(text);
  if (emoji !== '•') known.filter(c => resolveEmoji(config, c) === emoji).forEach(take);

  // A budget's own habits beat any table: the categories it actually uses are
  // the ones a new merchant is most likely to belong to.
  [...usage.entries()].sort((a, b) => b[1] - a[1]).forEach(([name]) => take(name));

  known.forEach(take); // a brand-new budget has no habits yet
  return out.filter(c => c !== UNCLASSIFIED).slice(0, 3);
}
