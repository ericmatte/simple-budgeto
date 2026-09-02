import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteGroupMessage, deleteCategoryMessage, deleteTransactionsMessage,
} from '../js/lib/confirmDialog.js';

// What the dialog says is the whole point of asking: it has to name what is
// about to happen, and get the French right while doing it.

describe('deleteGroupMessage', () => {
  test('says where a single category will end up', () => {
    const { title, body } = deleteGroupMessage('Finances', 1);
    assert.match(title, /Supprimer le groupe « Finances » \?/);
    assert.match(body, /^Sa catégorie sera déplacée/);
  });

  test('pluralises from two', () => {
    assert.match(deleteGroupMessage('Finances', 2).body, /2 catégories<\/b> seront déplacées/);
  });

  test('an empty group has nothing to move', () => {
    assert.equal(deleteGroupMessage('Finances', 0).body, 'Ce groupe est vide.');
  });

  test('escapes a group name so it cannot inject markup', () => {
    assert.match(deleteGroupMessage('<b>x</b>', 0).title, /&lt;b&gt;x&lt;\/b&gt;/);
  });
});

describe('deleteCategoryMessage', () => {
  test('promises the transactions survive, and warns the plan does not', () => {
    const { body } = deleteCategoryMessage('Dons', 3);
    assert.match(body, /3 transactions<\/b> seront reclassées/);
    assert.match(body, /budget planifié/);
  });

  test('a single transaction stays singular', () => {
    assert.match(deleteCategoryMessage('Dons', 1).body, /^Sa transaction sera reclassée/);
  });

  test('an unused category says so instead of threatening nothing', () => {
    assert.match(deleteCategoryMessage('Dons', 0).body, /aucune transaction/);
  });
});

describe('deleteTransactionsMessage', () => {
  test('counts in the title once there are several', () => {
    const { title, body } = deleteTransactionsMessage(4);
    assert.equal(title, 'Supprimer 4 transactions ?');
    assert.match(body, /Elles disparaissent/);
  });

  test('a lone transaction is named, not counted', () => {
    const { title, body } = deleteTransactionsMessage(1);
    assert.equal(title, 'Supprimer cette transaction ?');
    assert.match(body, /Elle disparaît/);
  });
});
