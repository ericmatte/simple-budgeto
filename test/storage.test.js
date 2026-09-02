import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTransactions, encodeTransactions } from '../js/storage/csvSchema.js';
import {
  defaultConfig, decodeConfig, encodeConfig, addCategory, allCategories, categoryGroupOf,
  reorderCategoryGroups, moveCategory, renameCategoryGroup, renameCategory,
  resolveEmoji, setCategoryEmoji, resolveGroupEmoji, setGroupEmoji, moveInList,
  addCategoryGroup, deleteCategoryGroup, deleteCategory, PROTECTED_GROUPS,
} from '../js/storage/config.js';

describe('transactions CSV schema', () => {
  test('round-trips a transaction through encode/decode', () => {
    const tx = {
      id: 'a1', dedupeKey: 'd1', kind: 'reel', date: '2026-08-04',
      description: 'Marché Nordet', amount: -51.01, category: 'Épicerie',
      freq: null, month: null, note: 'part de groupe', sources: ['cibc', 'splitwise'],
      linkedId: 'bank1', importBatchId: 'batch1', status: 'active', matchAmount: 102.02,
      group: 'Escapade 2026', swGroup: 'Escapade 2026', swCategory: 'Dining out', file: 'escapade.csv',
      matchDate: '2026-08-02', matchDescription: 'Épicerie partagée',
    };
    const decoded = decodeTransactions(encodeTransactions([tx]));
    assert.deepEqual(decoded, [tx]);
  });

  test('a match that fell on one day writes no second date', () => {
    const csv = encodeTransactions([{ id: 'a1', date: '2026-08-04', amount: -51.01, matchDate: null }]);
    assert.equal(decodeTransactions(csv)[0].matchDate, null);
  });

  test('reads a file written before the matchDate column existed', () => {
    const csv = 'id,kind,date,description,amount,category,status\na1,reel,2026-08-04,IGA,-51.01,Épicerie,active';
    assert.equal(decodeTransactions(csv)[0].matchDate, null);
  });

  test('reads a file written before the matchAmount column existed', () => {
    const csv = 'id,dedupeKey,kind,date,description,amount,category,status\na1,d1,reel,2026-08-04,IGA,-51.01,Épicerie,active';
    const decoded = decodeTransactions(csv);
    assert.equal(decoded[0].matchAmount, null);
    assert.equal(decoded[0].amount, -51.01);
  });

  test('reads a file written before rows could belong to a project group', () => {
    const csv = 'id,kind,date,description,amount,category,status\na1,reel,2026-08-04,IGA,-51.01,Épicerie,active';
    const decoded = decodeTransactions(csv);
    assert.equal(decoded[0].group, '');
    assert.equal(decoded[0].swGroup, '');
    assert.equal(decoded[0].swCategory, '');
    assert.equal(decoded[0].file, '');
  });

  test('decodes an empty file to an empty list', () => {
    assert.deepEqual(decodeTransactions(''), []);
  });

  test('is tolerant of column reordering (reads by header name)', () => {
    const csv = 'date,id,amount\n2026-08-04,a1,-10';
    const decoded = decodeTransactions(csv);
    assert.equal(decoded[0].id, 'a1');
    assert.equal(decoded[0].amount, -10);
    assert.equal(decoded[0].category, 'Non classé');
  });
});

describe('config', () => {
  test('decodeConfig falls back to defaults for empty/invalid content', () => {
    assert.deepEqual(decodeConfig(''), defaultConfig());
    assert.deepEqual(decodeConfig('not json'), defaultConfig());
  });

  test('decodeConfig merges saved fields onto the defaults', () => {
    const saved = encodeConfig({ splitwise: { myName: 'Alix' } });
    const cfg = decodeConfig(saved);
    assert.equal(cfg.splitwise.myName, 'Alix');
    assert.deepEqual(cfg.categoryGroups, defaultConfig().categoryGroups);
  });

  // Seed rules belong to the app: a budget saved by an older version must not
  // keep showing that version's wording in the import preview.
  test('decodeConfig re-reads the seed skip rules over the saved ones', () => {
    const saved = encodeConfig({
      skipRules: [
        { id: 'seed-cc-payment-fr', pattern: 'paiement.*(re[cç]u|merci)', flags: 'i', reason: 'Vieux libellé', learned: false },
        { id: 'learned-1', pattern: 'gym', flags: 'i', reason: 'Abonnement annulé', learned: true },
      ],
    });
    const cfg = decodeConfig(saved);
    const seed = cfg.skipRules.find(r => r.id === 'seed-cc-payment-fr');
    assert.equal(seed.reason, 'Paiement de carte de crédit');
    assert.equal(cfg.skipRules.filter(r => r.id === 'seed-cc-payment-fr').length, 1);
    assert.ok(cfg.skipRules.some(r => r.id === 'learned-1' && r.reason === 'Abonnement annulé'));
  });

  test('addCategory appends a new subcategory to an existing group and is idempotent', () => {
    let cfg = defaultConfig();
    cfg = addCategory(cfg, 'Abonnements', 'Logement');
    assert.ok(allCategories(cfg).includes('Abonnements'));
    assert.equal(categoryGroupOf(cfg, 'Abonnements'), 'Logement');
    const before = allCategories(cfg).length;
    cfg = addCategory(cfg, 'Abonnements', 'Logement');
    assert.equal(allCategories(cfg).length, before);
  });

  test('addCategory creates a new group when the named one does not exist yet', () => {
    const cfg = addCategory(defaultConfig(), 'Autocross', 'Activités');
    assert.equal(categoryGroupOf(cfg, 'Autocross'), 'Activités');
  });

  test('addCategory defaults to "Non classé" when no group is given', () => {
    const cfg = addCategory(defaultConfig(), 'Mystère');
    assert.equal(categoryGroupOf(cfg, 'Mystère'), 'Non classé');
  });

  test('addCategory ignores blank input', () => {
    const cfg = addCategory(defaultConfig(), '   ');
    assert.equal(allCategories(cfg).length, allCategories(defaultConfig()).length);
  });

  test('categoryGroupOf returns null for an unknown category', () => {
    assert.equal(categoryGroupOf(defaultConfig(), 'Inconnu'), null);
  });
});

describe('addCategoryGroup / deleteCategoryGroup / deleteCategory', () => {
  test('adds a new empty group just above the fallback group', () => {
    const cfg = addCategoryGroup(defaultConfig(), 'Animaux');
    const names = cfg.categoryGroups.map(g => g.name);
    assert.deepEqual(cfg.categoryGroups.find(g => g.name === 'Animaux').subcategories, []);
    assert.equal(names[names.indexOf('Animaux') + 1], 'Non classé');
  });

  test('adding a group is idempotent and ignores blank names', () => {
    const once = addCategoryGroup(defaultConfig(), 'Animaux');
    assert.equal(addCategoryGroup(once, 'Animaux').categoryGroups.length, once.categoryGroups.length);
    assert.deepEqual(addCategoryGroup(defaultConfig(), '   '), defaultConfig());
  });

  test('deleting a group re-homes its categories into "Non classé" instead of dropping them', () => {
    const cfg = deleteCategoryGroup(defaultConfig(), 'Transport');
    assert.equal(cfg.categoryGroups.some(g => g.name === 'Transport'), false);
    assert.equal(categoryGroupOf(cfg, 'Transport'), 'Non classé');
  });

  test('refuses to delete the groups the rest of the app depends on', () => {
    for (const name of PROTECTED_GROUPS) {
      assert.deepEqual(deleteCategoryGroup(defaultConfig(), name), defaultConfig());
    }
  });

  test('deleting an unknown group is a no-op', () => {
    assert.deepEqual(deleteCategoryGroup(defaultConfig(), 'Nope'), defaultConfig());
  });

  test('deleting a category removes it from its group and drops its emoji override', () => {
    const withEmoji = setCategoryEmoji(defaultConfig(), 'Épicerie', '🥑');
    const cfg = deleteCategory(withEmoji, 'Épicerie');
    assert.equal(allCategories(cfg).includes('Épicerie'), false);
    assert.equal(cfg.categoryEmoji.Épicerie, undefined);
    assert.equal(allCategories(cfg).includes('Restaurants'), true);
  });
});

describe('moveInList (shared drag-and-drop reordering rule)', () => {
  const list = ['a', 'b', 'c', 'd'];

  test('drops an item before the row it was dropped on', () => {
    assert.deepEqual(moveInList(list, 'd', 'b', true), ['a', 'd', 'b', 'c']);
  });

  test('drops an item after the row it was dropped on', () => {
    assert.deepEqual(moveInList(list, 'a', 'c', false), ['b', 'c', 'a', 'd']);
  });

  test('moving an item one slot down lands it one slot down, not at the end', () => {
    assert.deepEqual(moveInList(list, 'a', 'b', false), ['b', 'a', 'c', 'd']);
  });

  test('leaves the list unchanged when dropped back onto its own position', () => {
    assert.deepEqual(moveInList(list, 'b', 'a', false), list);
    assert.deepEqual(moveInList(list, 'b', 'c', true), list);
  });

  test('appends when the target is not in the list', () => {
    assert.deepEqual(moveInList(list, 'b', 'zzz', true), ['a', 'c', 'd', 'b']);
  });

  test('reordering two visible groups preserves the position of every other group', () => {
    // The dashboard only renders groups that have a category to show; feeding
    // reorderCategoryGroups a list built from the visible rows used to shove
    // every hidden group to the end of the budget.
    const all = defaultConfig().categoryGroups.map(g => g.name);
    const reordered = moveInList(all, 'Transport', 'Logement', true);
    const cfg = reorderCategoryGroups(defaultConfig(), reordered);
    const names = cfg.categoryGroups.map(g => g.name);
    assert.deepEqual(names, reordered);
    assert.equal(names.length, all.length);
    assert.equal(names[names.length - 1], 'Non classé');
  });
});

describe('reorderCategoryGroups', () => {
  test('reorders groups to match the given name order', () => {
    const cfg = reorderCategoryGroups(defaultConfig(), ['Non classé', 'Revenus']);
    const names = cfg.categoryGroups.map(g => g.name);
    assert.equal(names[0], 'Non classé');
    assert.equal(names[1], 'Revenus');
  });

  test('groups omitted from the order keep their relative position at the end', () => {
    const before = defaultConfig().categoryGroups.map(g => g.name);
    const cfg = reorderCategoryGroups(defaultConfig(), ['Non classé']);
    const names = cfg.categoryGroups.map(g => g.name);
    assert.equal(names[0], 'Non classé');
    assert.deepEqual(names.slice(1), before.filter(n => n !== 'Non classé'));
  });
});

describe('moveCategory', () => {
  test('moves a subcategory into a different group, before a given one', () => {
    const cfg = moveCategory(defaultConfig(), 'Épicerie', 'Finances', 'Placements');
    assert.equal(categoryGroupOf(cfg, 'Épicerie'), 'Finances');
    const fin = cfg.categoryGroups.find(g => g.name === 'Finances');
    assert.deepEqual(fin.subcategories, ['Épicerie', 'Placements', 'Dons']);
  });

  test('reorders within the same group when the target group is unchanged', () => {
    const cfg = moveCategory(defaultConfig(), 'Cadeaux', 'Vie quotidienne', 'Épicerie');
    const g = cfg.categoryGroups.find(x => x.name === 'Vie quotidienne');
    assert.deepEqual(g.subcategories, ['Cadeaux', 'Épicerie', 'Restaurants', 'Vêtements']);
  });

  test('appends at the end when no "before" target is given', () => {
    const cfg = moveCategory(defaultConfig(), 'Épicerie', 'Finances', null);
    const fin = cfg.categoryGroups.find(g => g.name === 'Finances');
    assert.deepEqual(fin.subcategories, ['Placements', 'Dons', 'Épicerie']);
  });

  test('is a no-op if the target group does not exist', () => {
    const cfg = moveCategory(defaultConfig(), 'Épicerie', 'Groupe fantôme', null);
    assert.deepEqual(cfg, defaultConfig());
  });
});

describe('renameCategoryGroup', () => {
  test('renames a group in place', () => {
    const cfg = renameCategoryGroup(defaultConfig(), 'Non classé', 'Divers');
    assert.ok(cfg.categoryGroups.some(g => g.name === 'Divers'));
    assert.ok(!cfg.categoryGroups.some(g => g.name === 'Non classé'));
  });

  test('refuses to rename onto an existing group name', () => {
    const cfg = renameCategoryGroup(defaultConfig(), 'Non classé', 'Revenus');
    assert.ok(cfg.categoryGroups.some(g => g.name === 'Non classé'));
  });
});

describe('renameCategory', () => {
  test('renames a subcategory in place, keeping its group', () => {
    const cfg = renameCategory(defaultConfig(), 'Épicerie', 'Groceries');
    assert.equal(categoryGroupOf(cfg, 'Groceries'), 'Vie quotidienne');
    assert.equal(categoryGroupOf(cfg, 'Épicerie'), null);
  });

  test('renaming onto an existing category merges instead of duplicating', () => {
    const cfg = renameCategory(defaultConfig(), 'Épicerie', 'Restaurants');
    assert.equal(allCategories(cfg).filter(c => c === 'Restaurants').length, 1);
    assert.equal(categoryGroupOf(cfg, 'Épicerie'), null);
  });

  test('carries over a custom emoji from the old name to the new one', () => {
    let cfg = setCategoryEmoji(defaultConfig(), 'Épicerie', '🥕');
    cfg = renameCategory(cfg, 'Épicerie', 'Groceries');
    assert.equal(cfg.categoryEmoji['Groceries'], '🥕');
    assert.equal(cfg.categoryEmoji['Épicerie'], undefined);
  });
});

describe('resolveGroupEmoji / setGroupEmoji', () => {
  test('a group has no emoji until one is picked', () => {
    assert.equal(resolveGroupEmoji(defaultConfig(), 'Transport'), null);
  });

  test('the picked emoji follows the group through a rename', () => {
    let cfg = setGroupEmoji(defaultConfig(), 'Transport', '🚗');
    cfg = renameCategoryGroup(cfg, 'Transport', 'Bagnole');
    assert.equal(resolveGroupEmoji(cfg, 'Bagnole'), '🚗');
    assert.equal(resolveGroupEmoji(cfg, 'Transport'), null);
  });

  test('deleting a group drops its emoji', () => {
    let cfg = setGroupEmoji(defaultConfig(), 'Transport', '🚗');
    cfg = deleteCategoryGroup(cfg, 'Transport');
    assert.equal(resolveGroupEmoji(cfg, 'Transport'), null);
  });

  test('setGroupEmoji ignores blank input', () => {
    const before = defaultConfig();
    const after = setGroupEmoji(before, 'Transport', '  ');
    assert.equal(after, before);
    assert.equal(resolveGroupEmoji(after, 'Transport'), null);
  });
});

describe('resolveEmoji / setCategoryEmoji', () => {
  test('falls back to the keyword-based guess with no override', () => {
    assert.equal(resolveEmoji(defaultConfig(), 'Épicerie'), '🛒');
  });

  test('a stored override wins over the keyword guess', () => {
    const cfg = setCategoryEmoji(defaultConfig(), 'Épicerie', '🥕');
    assert.equal(resolveEmoji(cfg, 'Épicerie'), '🥕');
  });

  test('setCategoryEmoji ignores blank input', () => {
    const cfg = setCategoryEmoji(defaultConfig(), 'Épicerie', '  ');
    assert.equal(resolveEmoji(cfg, 'Épicerie'), '🛒');
  });
});
