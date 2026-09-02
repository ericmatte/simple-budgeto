import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { money, num0, compact, ym, ymLabel, dateLabel, shift, monthEnd, relativeTime, absoluteTime, plural, titleCase } from '../js/lib/format.js';

describe('format helpers', () => {
  test('money formats with the sign outside and a trailing $ (non-breaking spaces)', () => {
    assert.equal(money(1234), `1${' '}234${' '}$`);
    assert.equal(money(-1234), `−1${' '}234${' '}$`);
    assert.equal(money(45.5, 2), `45,50${' '}$`);
  });

  test('num0 rounds to the nearest integer', () => {
    assert.equal(num0(45.6), '46');
    assert.equal(num0(-45.6), '−46');
    assert.equal(num0(1234), `1${' '}234`);
  });

  test('compact abbreviates thousands', () => {
    assert.equal(compact(2500), '2.5k');
    assert.equal(compact(25000), '25k');
    assert.equal(compact(250), '250');
  });

  test('shift moves a YYYY-MM key across year boundaries', () => {
    assert.equal(shift('2026-01', -1), '2025-12');
    assert.equal(shift('2025-12', 1), '2026-01');
    assert.equal(shift('2026-06', 3), '2026-09');
  });

  test('monthEnd finds the last calendar day, including leap Februaries', () => {
    assert.equal(monthEnd('2026-02'), '2026-02-28');
    assert.equal(monthEnd('2024-02'), '2024-02-29');
    assert.equal(monthEnd('2026-04'), '2026-04-30');
  });

  test('ym/ymLabel round-trip a Date into a French short month label', () => {
    const key = ym(new Date(2026, 7, 10));
    assert.equal(key, '2026-08');
    assert.equal(ymLabel(key), 'août 2026');
  });
});

describe('relativeTime / absoluteTime', () => {
  const now = new Date('2026-08-10T14:30:00');
  const ago = (ms) => new Date(now - ms).toISOString();

  test('collapses anything under a minute to "à l\'instant"', () => {
    assert.equal(relativeTime(ago(3000), now), 'à l\'instant');
  });

  test('counts minutes, then hours', () => {
    assert.equal(relativeTime(ago(5 * 60000), now), 'il y a 5 min');
    assert.equal(relativeTime(ago(3 * 3600000), now), 'il y a 3 h');
  });

  test('names yesterday, then counts days up to a week', () => {
    assert.equal(relativeTime(ago(26 * 3600000), now), 'hier');
    assert.equal(relativeTime(ago(4 * 86400000), now), 'il y a 4 jours');
  });

  test('falls back to a date once "il y a N jours" stops being useful', () => {
    assert.equal(relativeTime(ago(40 * 86400000), now), 'le 1 juillet');
  });

  test('spells out the year only when it is not the current one', () => {
    assert.equal(relativeTime('2025-03-08T10:00:00', now), 'le 8 mars 2025');
  });

  test('a clock skewed into the future never reads as negative', () => {
    assert.equal(relativeTime(new Date(+now + 60000).toISOString(), now), 'à l\'instant');
  });

  test('returns null for missing or unparsable input', () => {
    assert.equal(relativeTime(null), null);
    assert.equal(relativeTime('pas une date'), null);
    assert.equal(absoluteTime(null), '');
  });

  test('absoluteTime spells out the full moment', () => {
    assert.equal(absoluteTime('2026-08-10T14:05:00'), '10 août 2026 à 14:05');
  });
});

describe('dateLabel', () => {
  test('spells out the weekday and month in French', () => {
    assert.equal(dateLabel('2026-08-11'), 'mardi 11 août 2026');
    assert.equal(dateLabel('2026-01-01'), 'jeudi 1 janvier 2026');
  });

  test('reads the day as a local calendar date, not as UTC midnight', () => {
    assert.equal(dateLabel('2026-03-01'), 'dimanche 1 mars 2026');
  });

  test('says so rather than inventing a day when there is no date', () => {
    assert.equal(dateLabel(''), 'Date inconnue');
    assert.equal(dateLabel(null), 'Date inconnue');
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
