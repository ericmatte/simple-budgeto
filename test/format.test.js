import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { money, plural, titleCase } from '../js/lib/format.js';

describe('format helpers', () => {
  test('money formats with the sign outside and a trailing $ (non-breaking spaces)', () => {
    assert.equal(money(1234), `1${' '}234${' '}$`);
    assert.equal(money(-1234), `−1${' '}234${' '}$`);
    assert.equal(money(45.5, 2), `45,50${' '}$`);
  });

});

describe('plural', () => {
  test('French turns the plural on at two, not at one', () => {
    assert.equal(plural(0, 'ligne'), '0 ligne');
    assert.equal(plural(1, 'ligne'), '1 ligne');
    assert.equal(plural(2, 'ligne'), '2 lignes');
    assert.equal(plural(12, 'ligne'), '12 lignes');
  });

  test('an irregular plural can be spelled out', () => {
    assert.equal(plural(3, 'total', 'totaux'), '3 totaux');
  });
});

describe('titleCase', () => {
  test('calms a description a bank export shouts', () => {
    assert.equal(titleCase('BISTRO NORDET SAINTE-BRISE'), 'Bistro Nordet Sainte-Brise');
    assert.equal(titleCase('MARCHÉ NORDET'), 'Marché Nordet');
  });

  test('keeps an apostrophe inside the word it belongs to', () => {
    assert.equal(titleCase("BISTRO D'ALIZE"), "Bistro D'alize");
    assert.equal(titleCase('L’ALIZÉ'), 'L’alizé');
  });

  test('capitalises an accented first letter', () => {
    assert.equal(titleCase('ÉPICERIE DU COIN'), 'Épicerie Du Coin');
  });

  test('leaves numbers and punctuation exactly as written', () => {
    assert.equal(titleCase("BISTRO D'ALIZE #12 A02, QC"), "Bistro D'alize #12 A02, Qc");
  });

  test('lowers a word that was already capitalised in the middle', () => {
    assert.equal(titleCase('Lampe de bureau'), 'Lampe De Bureau');
  });

  test('nothing to case is an empty string', () => {
    assert.equal(titleCase(''), '');
    assert.equal(titleCase(null), '');
    assert.equal(titleCase(undefined), '');
  });
});
