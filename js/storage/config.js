import { defaultSkipRules } from '../matching/skipRules.js';
import { emojiFor } from '../categories.js';
import { merchantRuleFor } from '../lib/merchants.js';

export const DEFAULT_CATEGORY_GROUPS = [
  { name: 'Revenus', subcategories: ['Revenus'] },
  { name: 'Vie quotidienne', subcategories: ['Épicerie', 'Restaurants', 'Vêtements', 'Cadeaux'] },
  { name: 'Logement', subcategories: ['Logement', 'Services'] },
  { name: 'Transport', subcategories: ['Transport'] },
  { name: 'Santé & assurance', subcategories: ['Santé', 'Assurance'] },
  { name: 'Loisirs & voyages', subcategories: ['Loisirs', 'Voyage'] },
  { name: 'Famille', subcategories: ['Enfants'] },
  { name: 'Finances', subcategories: ['Placements', 'Dons'] },
  { name: 'Non classé', subcategories: ['Non classé'] },
];

export function defaultConfig() {
  return {
    version: 2,
    categoryGroups: DEFAULT_CATEGORY_GROUPS.map(g => ({ name: g.name, subcategories: [...g.subcategories] })),
    categoryEmoji: {},
    // Groups have no automatic guess to fall back on: unset means "no emoji",
    // and the view draws its folder/luggage mark instead.
    groupEmoji: {},
    skipRules: defaultSkipRules(),
    // `myNames`: one column name per Splitwise export the user has identified
    // themselves in (a friend CSV and a group CSV can spell it differently).
    // `myName` is the last one chosen, kept for configs written before this.
    splitwise: { myName: null, myNames: [] },
    // What the app has learned, so it never asks the same question twice.
    //
    // `splitwiseGroups` is keyed by the Splitwise *group* ("Groupe Alpha",
    // "Escapade 2026") rather than by file name: the same group is re-exported every
    // month under a different name, and "Dining out" of the roommates is not
    // "Dining out" of a trip.
    //   { [group]: { superCategory: string|null, categoryMap: { [swCat]: category } } }
    splitwiseGroups: {},
    // { [merchantKey]: category } — see lib/merchants.js for the key.
    merchantRules: {},
    winEnd: null,
    sel: null,
    // 'YYYY-MM' — the first month this budget covers. Movements dated before
    // it are refused at import and hidden from every view. Null = no limit.
    startMonth: null,
    // ISO timestamps, stamped on every save / on each confirmed import.
    updatedAt: null,
    lastImportAt: null,
    lastImportCount: 0,
    lastImportSources: [],
  };
}

// Emoji shown for a category: a user-picked override if one was set,
// otherwise the automatic keyword-based guess.
export function resolveEmoji(config, name) {
  return (config?.categoryEmoji && config.categoryEmoji[name]) || emojiFor(name);
}

export function setCategoryEmoji(config, name, emoji) {
  const trimmed = String(emoji || '').trim();
  if (!name || !trimmed) return config;
  return { ...config, categoryEmoji: { ...(config.categoryEmoji || {}), [name]: trimmed } };
}

// Null when the user hasn't picked one — there is no keyword guess for a
// group name, so the caller decides what mark to draw instead.
export function resolveGroupEmoji(config, name) {
  return (config?.groupEmoji && config.groupEmoji[name]) || null;
}

export function setGroupEmoji(config, name, emoji) {
  const trimmed = String(emoji || '').trim();
  if (!name || !trimmed) return config;
  return { ...config, groupEmoji: { ...(config.groupEmoji || {}), [name]: trimmed } };
}

export function decodeConfig(text) {
  if (!text || !text.trim()) return defaultConfig();
  try {
    const parsed = JSON.parse(text);
    const config = { ...defaultConfig(), ...parsed };
    return { ...config, skipRules: refreshSeedRules(config.skipRules) };
  } catch {
    return defaultConfig();
  }
}

// Seed rules belong to the app, not to the budget: their pattern and the
// wording of their reason are re-read from the code on every load, so a
// config written by an older version doesn't freeze an outdated label on
// screen. Learned rules are the user's and are kept untouched.
function refreshSeedRules(stored) {
  const seeds = defaultSkipRules();
  const seedIds = new Set(seeds.map(r => r.id));
  return [...seeds, ...(stored || []).filter(r => !seedIds.has(r.id))];
}

export function encodeConfig(config) {
  return JSON.stringify(config, null, 2) + '\n';
}

// Every category name in the budget, deduplicated: the same name can now sit
// in several groups at once (see `categoryGroupOf`), and a flat list of names
// is what a picker offers.
export function allCategories(config) {
  return [...new Set((config.categoryGroups || []).flatMap(g => g.subcategories))];
}

// The one pair that identifies a line of the budget. A category name is no
// longer unique on its own: "Restaurants" can be an everyday expense and, at
// the same time, a line of the "Escapade 2026" trip. Anything that adds up money
// has to key on this, not on the name.
export const SLOT_SEP = '\u001f';
export const slotKey = (group, category) => `${group || ''}${SLOT_SEP}${category || ''}`;
export function parseSlotKey(key) {
  const at = String(key).indexOf(SLOT_SEP);
  return at === -1
    ? { group: '', category: String(key) }
    : { group: key.slice(0, at), category: key.slice(at + SLOT_SEP.length) };
}

// Where a category lives when nothing else says otherwise — the first group
// holding that name. A transaction filed under a project carries its own
// group and doesn't go through here.
export function categoryGroupOf(config, categoryName) {
  const group = (config.categoryGroups || []).find(g => g.subcategories.includes(categoryName));
  return group ? group.name : null;
}

// The group a stored row belongs to. `group` is written at import for rows
// that belong to a project or trip; everything else — and every row written
// before the column existed — falls back to its category's home group.
export function groupOf(config, transaction) {
  const explicit = String(transaction?.group || '').trim();
  if (explicit && (config.categoryGroups || []).some(g => g.name === explicit)) return explicit;
  return categoryGroupOf(config, transaction?.category) || FALLBACK_GROUP;
}

// A group standing for a trip or a project rather than a kind of spending.
// It holds ordinary category names — the same ones the rest of the budget
// uses — and is what a Splitwise group's `superCategory` points at.
export function projectGroups(config) {
  return (config.categoryGroups || []).filter(g => g.project);
}

export function addProjectGroup(config, name) {
  const trimmed = String(name || '').trim();
  const groups = config.categoryGroups || [];
  if (!trimmed) return config;
  const existing = groups.find(g => g.name === trimmed);
  if (existing) {
    return existing.project
      ? config
      : { ...config, categoryGroups: groups.map(g => g.name === trimmed ? { ...g, project: true } : g) };
  }
  const at = groups.findIndex(g => g.name === FALLBACK_GROUP);
  const entry = { name: trimmed, subcategories: [], project: true };
  const categoryGroups = at === -1 ? [...groups, entry] : [...groups.slice(0, at), entry, ...groups.slice(at)];
  return { ...config, categoryGroups };
}

// Refuses only a name the target group already holds: the same name living in
// two different groups is the whole point of a project group.
export function addCategory(config, name, groupName = FALLBACK_GROUP) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return config;
  const groups = config.categoryGroups || [];
  const idx = groups.findIndex(g => g.name === groupName);
  if (idx === -1) {
    return { ...config, categoryGroups: [...groups, { name: groupName, subcategories: [trimmed] }] };
  }
  if (groups[idx].subcategories.includes(trimmed)) return config;
  const categoryGroups = groups.map((g, i) => i === idx ? { ...g, subcategories: [...g.subcategories, trimmed] } : g);
  return { ...config, categoryGroups };
}

// "Revenus" drives the income section of the dashboard and "Non classé" is
// where orphaned categories land, so neither can be deleted out from under
// the rest of the app.
export const PROTECTED_GROUPS = ['Revenus', 'Non classé'];
const FALLBACK_GROUP = 'Non classé';

export function addCategoryGroup(config, name) {
  const trimmed = String(name || '').trim();
  const groups = config.categoryGroups || [];
  if (!trimmed || groups.some(g => g.name === trimmed)) return config;
  // Inserted before the fallback group so freshly created groups don't pile
  // up underneath "Non classé", which reads as the end of the budget.
  const at = groups.findIndex(g => g.name === FALLBACK_GROUP);
  const entry = { name: trimmed, subcategories: [] };
  const categoryGroups = at === -1 ? [...groups, entry] : [...groups.slice(0, at), entry, ...groups.slice(at)];
  return { ...config, categoryGroups };
}

// Deleting a group keeps its categories — they move to "Non classé" rather
// than silently taking every transaction filed under them down with it.
export function deleteCategoryGroup(config, name) {
  const groups = config.categoryGroups || [];
  const target = groups.find(g => g.name === name);
  if (!target || PROTECTED_GROUPS.includes(name)) return config;
  const orphans = target.subcategories;
  let categoryGroups = groups.filter(g => g.name !== name);
  if (orphans.length) {
    const at = categoryGroups.findIndex(g => g.name === FALLBACK_GROUP);
    if (at === -1) {
      categoryGroups = [...categoryGroups, { name: FALLBACK_GROUP, subcategories: [...orphans] }];
    } else {
      categoryGroups = categoryGroups.map((g, i) => i === at
        ? { ...g, subcategories: [...g.subcategories, ...orphans.filter(c => !g.subcategories.includes(c))] }
        : g);
    }
  }
  const groupEmoji = { ...(config.groupEmoji || {}) };
  delete groupEmoji[name];
  return { ...config, categoryGroups, groupEmoji };
}

// Scoped to one group: deleting "Restaurants" from the "Escapade 2026" trip must
// leave the everyday "Restaurants" — and its history — alone. The emoji is
// shared by every group holding the name, so it only goes with the last one.
export function deleteCategory(config, name, groupName) {
  const groups = config.categoryGroups || [];
  const target = groupName ? groups.find(g => g.name === groupName) : groups.find(g => g.subcategories.includes(name));
  if (!target || !target.subcategories.includes(name)) return config;

  const categoryGroups = groups.map(g => g.name === target.name
    ? { ...g, subcategories: g.subcategories.filter(c => c !== name) }
    : g);
  const stillUsed = categoryGroups.some(g => g.subcategories.includes(name));
  const categoryEmoji = { ...(config.categoryEmoji || {}) };
  if (!stillUsed) delete categoryEmoji[name];
  return { ...config, categoryGroups, categoryEmoji };
}

// --- ce que l'app a appris -------------------------------------------------

export function splitwiseGroupConfig(config, group) {
  return (config.splitwiseGroups || {})[group] || { superCategory: null, categoryMap: {} };
}

function withSplitwiseGroup(config, group, patch) {
  const current = splitwiseGroupConfig(config, group);
  return {
    ...config,
    splitwiseGroups: { ...(config.splitwiseGroups || {}), [group]: { ...current, ...patch } },
  };
}

// The trip or project every row of a Splitwise group belongs to — null puts
// them back among the everyday categories.
export function setSplitwiseSuperCategory(config, group, superCategory) {
  if (!group) return config;
  return withSplitwiseGroup(config, group, { superCategory: superCategory || null });
}

// "Groceries" (as Splitwise spells it) → "Épicerie" (as this budget does).
export function setSplitwiseCategory(config, group, splitwiseCategory, category) {
  if (!group || !splitwiseCategory) return config;
  const map = { ...splitwiseGroupConfig(config, group).categoryMap };
  if (category) map[splitwiseCategory] = category;
  else delete map[splitwiseCategory];
  return withSplitwiseGroup(config, group, { categoryMap: map });
}

export function setMerchantRule(config, key, category) {
  if (!key) return config;
  const rules = { ...(config.merchantRules || {}) };
  if (category) rules[key] = category;
  else delete rules[key];
  return { ...config, merchantRules: rules };
}

// The category a row lands in without anyone being asked. `splitwiseGroup` and
// `merchantKey` come off the parsed candidate; a row that matches nothing has
// no rule and goes to the inbox.
export function ruleFor(config, { source, splitwiseGroup, splitwiseCategory, merchantKey }) {
  if (source === 'splitwise' && splitwiseGroup && splitwiseCategory) {
    return splitwiseGroupConfig(config, splitwiseGroup).categoryMap[splitwiseCategory] || null;
  }
  return merchantRuleFor(config.merchantRules || {}, merchantKey);
}

// Moves `moved` to just before (or just after) `target` in a list, keeping
// every other item's relative order — the shared "drop a row here" rule for
// both group and category reordering.
export function moveInList(list, moved, target, placeBefore) {
  const rest = list.filter(x => x !== moved);
  const at = rest.indexOf(target);
  if (at === -1) return [...rest, moved];
  const pos = placeBefore ? at : at + 1;
  return [...rest.slice(0, pos), moved, ...rest.slice(pos)];
}

// Reorders the top-level groups to match `orderedNames` (drag-and-drop of
// section headers). Any group not mentioned keeps its relative position at
// the end, so a stale/partial list never silently drops a group.
export function reorderCategoryGroups(config, orderedNames) {
  const groups = config.categoryGroups || [];
  const byName = new Map(groups.map(g => [g.name, g]));
  const reordered = orderedNames.map(n => byName.get(n)).filter(Boolean);
  const remaining = groups.filter(g => !orderedNames.includes(g.name));
  return { ...config, categoryGroups: [...reordered, ...remaining] };
}

// Moves a subcategory to a new group and/or position (drag-and-drop of a
// category row). `beforeName` is the subcategory it should land just
// before within the target group; omit/null to append at the end.
// `fromGroup` says which of the (possibly several) groups holding this name
// is the one being dragged — without it, moving the trip's "Restaurants"
// would take the everyday one along with it.
export function moveCategory(config, categoryName, targetGroupName, beforeName, fromGroup) {
  const groups = config.categoryGroups || [];
  const source = fromGroup || categoryGroupOf(config, categoryName);
  const withoutMoved = groups.map(g => g.name === source || g.name === targetGroupName
    ? { ...g, subcategories: g.subcategories.filter(c => c !== categoryName) }
    : g);
  const idx = withoutMoved.findIndex(g => g.name === targetGroupName);
  if (idx === -1) return config;
  const target = withoutMoved[idx].subcategories;
  const at = beforeName ? target.indexOf(beforeName) : -1;
  const pos = at === -1 ? target.length : at;
  const categoryGroups = withoutMoved.map((g, i) => i === idx
    ? { ...g, subcategories: [...target.slice(0, pos), categoryName, ...target.slice(pos)] }
    : g);
  return { ...config, categoryGroups };
}

export function renameCategoryGroup(config, oldName, newName) {
  const trimmed = String(newName || '').trim();
  if (!trimmed || trimmed === oldName) return config;
  const groups = config.categoryGroups || [];
  if (groups.some(g => g.name === trimmed)) return config; // name collision — leave for the user to resolve
  const groupEmoji = { ...(config.groupEmoji || {}) };
  if (groupEmoji[oldName]) {
    groupEmoji[trimmed] = groupEmoji[oldName];
    delete groupEmoji[oldName];
  }
  return {
    ...config,
    categoryGroups: groups.map(g => g.name === oldName ? { ...g, name: trimmed } : g),
    groupEmoji,
  };
}

// Renames a subcategory in place. If the new name already exists elsewhere,
// the old name is simply dropped (its transactions get repointed to the
// existing one by the caller) rather than creating a duplicate entry.
// Renames one category inside one group. If that group already holds the new
// name, the two merge; the same name in *other* groups is a different line of
// the budget and is left where it is.
export function renameCategory(config, oldName, newName, groupName) {
  const trimmed = String(newName || '').trim();
  if (!trimmed || trimmed === oldName) return config;
  const groups = config.categoryGroups || [];
  const target = groupName ? groups.find(g => g.name === groupName) : groups.find(g => g.subcategories.includes(oldName));
  if (!target || !target.subcategories.includes(oldName)) return config;

  const merges = target.subcategories.includes(trimmed);
  const categoryGroups = groups.map(g => g.name !== target.name ? g : {
    ...g,
    subcategories: g.subcategories
      .map(c => (c === oldName && !merges) ? trimmed : c)
      .filter(c => !(c === oldName && merges)),
  });

  const stillUsed = categoryGroups.some(g => g.subcategories.includes(oldName));
  const categoryEmoji = { ...(config.categoryEmoji || {}) };
  if (categoryEmoji[oldName] && !categoryEmoji[trimmed]) categoryEmoji[trimmed] = categoryEmoji[oldName];
  if (!stillUsed) delete categoryEmoji[oldName];
  return { ...config, categoryGroups, categoryEmoji };
}
