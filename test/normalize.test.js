import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, isoDate, mdyDate, isoDateTime, stableHash } from '../js/lib/normalize.js';

test('parseAmount handles plain numbers', () => {
  assert.equal(parseAmount('45.67'), 45.67);
  assert.equal(parseAmount('-45.67'), -45.67);
});

test('parseAmount handles $ and currency suffixes', () => {
  assert.equal(parseAmount('$1,234.56'), 1234.56);
  assert.equal(parseAmount('45,00 CAD'), 45);
});

test('parseAmount handles parentheses as negative', () => {
  assert.equal(parseAmount('(45.00)'), -45);
});

test('parseAmount returns NaN for garbage', () => {
  assert.ok(isNaN(parseAmount('')));
  assert.ok(isNaN(parseAmount(undefined)));
  assert.ok(isNaN(parseAmount('n/a')));
});

test('isoDate normalizes YYYY-MM-DD and YYYY/M/D', () => {
  assert.equal(isoDate('2026-08-07'), '2026-08-07');
  assert.equal(isoDate('2026/8/7'), '2026-08-07');
});

test('mdyDate converts MM/DD/YYYY to ISO', () => {
  assert.equal(mdyDate('08/06/2026'), '2026-08-06');
  assert.equal(mdyDate('7/28/2026'), '2026-07-28');
});

test('isoDateTime extracts the date part of an ISO timestamp', () => {
  assert.equal(isoDateTime('2026-07-15T20:00:00-04:00'), '2026-07-15');
});

test('stableHash is deterministic and sensitive to its inputs', () => {
  assert.equal(stableHash('a', 'b', 1), stableHash('a', 'b', 1));
  assert.notEqual(stableHash('a', 'b', 1), stableHash('a', 'b', 2));
});
