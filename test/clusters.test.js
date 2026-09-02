import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildClusters, guessCategories, isUnclassified } from '../js/matching/clusters.js';
import { defaultConfig, setSplitwiseSuperCategory, addProjectGroup } from '../js/storage/config.js';

function tx(overrides) {
  return {
    id: 'x' + Math.random(), kind: 'reel', status: 'active', date: '2026-08-04',
    description: 'Some purchase', amount: -10, category: 'Non classé', group: '',
    swGroup: '', swCategory: '', sources: ['cibc'], ...overrides,
  };
}

describe('isUnclassified', () => {
  test('only real, live, uncategorized rows are waiting to be sorted', () => {
    assert.equal(isUnclassified(tx({})), true);
    assert.equal(isUnclassified(tx({ category: 'Épicerie' })), false);
    assert.equal(isUnclassified(tx({ kind: 'planifie' })), false);
    assert.equal(isUnclassified(tx({ status: 'deleted' })), false);
  });
});

describe('buildClusters', () => {
  const config = defaultConfig();

  test('gathers one merchant written twenty ways into a single decision', () => {
    const rows = [
      tx({ description: 'RESTO PONANT #12', amount: -5 }),
      tx({ description: 'RESTO PONANT #9902', amount: -7 }),
      tx({ description: 'RESTO PONANT #12', amount: -3 }),
    ];
    const clusters = buildClusters(rows, config);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].n, 3);
    assert.equal(clusters[0].total, -15);
    assert.equal(clusters[0].kind, 'merchant');
  });

  test('keeps the same Splitwise category of two different groups apart', () => {
    const rows = [
      tx({ description: 'Souper partagé', swGroup: 'Groupe Alpha', swCategory: 'Dining out', sources: ['splitwise'] }),
      tx({ description: 'Brunch partagé', swGroup: 'Escapade 2026', swCategory: 'Dining out', sources: ['splitwise'] }),
    ];
    const clusters = buildClusters(rows, config);
    assert.equal(clusters.length, 2);
    assert.deepEqual(clusters.map(c => c.splitwiseGroup).sort(), ['Escapade 2026', 'Groupe Alpha']);
  });

  test('sorts by amount, so the decisions that move the budget come first', () => {
    const rows = [
      tx({ description: 'PETIT ACHAT', amount: -4 }),
      tx({ description: 'GROS ACHAT', amount: -900 }),
    ];
    assert.equal(buildClusters(rows, config)[0].label, 'GROS ACHAT');
  });

  test('leaves classified rows out — the inbox only holds what is undecided', () => {
    const rows = [tx({ category: 'Épicerie' }), tx({ description: 'AUTRE' })];
    const clusters = buildClusters(rows, config);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].label, 'AUTRE');
  });

  test('carries the trip a Splitwise group is filed under', () => {
    let config2 = addProjectGroup(defaultConfig(), 'Escapade 2026');
    config2 = setSplitwiseSuperCategory(config2, 'Escapade 2026', 'Escapade 2026');
    const rows = [tx({ swGroup: 'Escapade 2026', swCategory: 'Dining out', sources: ['splitwise'] })];
    assert.equal(buildClusters(rows, config2)[0].superCategory, 'Escapade 2026');
  });
});

describe('guessCategories', () => {
  const config = defaultConfig();

  test('translates the Splitwise category list the budget did not write', () => {
    const cluster = { kind: 'splitwise', splitwiseCategory: 'Groceries', descriptions: [] };
    assert.equal(guessCategories(cluster, config)[0], 'Épicerie');
  });

  test('reads a merchant through the emoji the app already gives its wording', () => {
    const cluster = { kind: 'merchant', descriptions: ['PHARMACIE ZENITH #08'], splitwiseCategory: '' };
    assert.ok(guessCategories(cluster, config).includes('Santé'));
  });

  test("falls back on the budget's own habits for an unrecognizable merchant", () => {
    const usage = new Map([['Achats divers', 40], ['Cadeaux', 2]]);
    let config2 = defaultConfig();
    config2 = { ...config2, categoryGroups: [...config2.categoryGroups, { name: 'Extra', subcategories: ['Achats divers'] }] };
    const cluster = { kind: 'merchant', descriptions: ['ZZQ 4419 LTD'], splitwiseCategory: '' };
    assert.equal(guessCategories(cluster, config2, usage)[0], 'Achats divers');
  });

  test('never offers "Non classé" as an answer', () => {
    const cluster = { kind: 'merchant', descriptions: ['ZZQ 4419 LTD'], splitwiseCategory: '' };
    assert.ok(!guessCategories(cluster, config).includes('Non classé'));
  });
});

describe('one merchant written several ways', () => {
  test('the branch with its city in the name joins the same decision', () => {
    const rows = [
      tx({ description: 'RESTO PONANT #12', amount: -5 }),
      tx({ description: 'RESTO PONANT #12 SAINTE-BRISE', amount: -7 }),
    ];
    const clusters = buildClusters(rows, defaultConfig());
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].merchantKey, 'RESTO PONANT');
    assert.equal(clusters[0].n, 2);
  });
});
