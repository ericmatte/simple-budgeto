import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { merchantKey, merchantLabel, canonicalMerchantKey, merchantRuleFor } from '../js/lib/merchants.js';

describe('merchantKey', () => {
  test('folds the store number away, so one merchant is one decision', () => {
    assert.equal(merchantKey('RESTO PONANT #12'), merchantKey('RESTO PONANT #9902'));
    assert.equal(merchantKey('RESTO PONANT #12'), 'RESTO PONANT');
  });

  test('drops a payment processor prefix and keeps who was actually paid', () => {
    assert.equal(merchantKey('SQ *CAFE ALIZE'), 'CAFE ALIZE');
    assert.equal(merchantKey('PP *JEUX EN LIGNE'), 'JEUX EN LIGNE');
  });

  test('cuts a reference number that follows the merchant', () => {
    assert.equal(merchantKey('BOUTIQUE EN LIGNE *4XK2'), 'BOUTIQUE EN LIGNE');
    assert.equal(merchantKey('BOUTIQUE EN LIGNE *7QQ12'), 'BOUTIQUE EN LIGNE');
  });

  test('ignores case and accents', () => {
    assert.equal(merchantKey('Épicerie Métro'), merchantKey('EPICERIE METRO'));
  });

  test('keeps genuinely different merchants apart', () => {
    assert.notEqual(merchantKey('UBER EATS TORONTO'), merchantKey('UBER TRIP HELP.UBER.COM'));
  });

  test('survives an empty or missing description', () => {
    assert.equal(merchantKey(''), '');
    assert.equal(merchantKey(undefined), '');
  });
});

describe('merchantLabel', () => {
  test('shows the least cluttered description of the bunch', () => {
    assert.equal(merchantLabel(['IGA EXTRA MARCHE VAUDREUIL 0034', 'IGA EXTRA']), 'IGA EXTRA');
  });
});

describe('one merchant, several spellings', () => {
  test('a branch that spells out its city folds into the shorter name', () => {
    const keys = ['RESTO PONANT', 'RESTO PONANT SAINTE-BRISE', 'RESTO PONANT LEVANT'];
    assert.equal(canonicalMerchantKey('RESTO PONANT SAINTE-BRISE', keys), 'RESTO PONANT');
    assert.equal(canonicalMerchantKey('RESTO PONANT', keys), 'RESTO PONANT');
  });

  test('a single word is a family, not a merchant — UBER must not swallow UBER EATS', () => {
    assert.equal(canonicalMerchantKey('UBER EATS', ['UBER', 'UBER EATS']), 'UBER EATS');
  });

  test('a rule written for the short name covers the longer ones', () => {
    const rules = { 'RESTO PONANT': 'Restaurants' };
    assert.equal(merchantRuleFor(rules, 'RESTO PONANT SAINTE-BRISE'), 'Restaurants');
    assert.equal(merchantRuleFor(rules, 'RESTO PONANT'), 'Restaurants');
    assert.equal(merchantRuleFor(rules, 'TIMS'), null);
  });

  test('the most specific rule wins over a shorter one', () => {
    const rules = { 'CANADIAN TIRE': 'Achats divers', 'CANADIAN TIRE ESSENCE': 'Transport' };
    assert.equal(merchantRuleFor(rules, 'CANADIAN TIRE ESSENCE LAVAL'), 'Transport');
    assert.equal(merchantRuleFor(rules, 'CANADIAN TIRE LAVAL'), 'Achats divers');
  });
});
