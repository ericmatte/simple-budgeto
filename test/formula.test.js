import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula } from '../js/lib/formula.js';

describe('parseFormula', () => {
  test('parses a plain number with a dot decimal', () => {
    assert.equal(parseFormula('56.32'), 56.32);
  });

  test('parses a plain number with a comma decimal', () => {
    assert.equal(parseFormula('56,32'), 56.32);
  });

  test('evaluates a formula mixing comma and dot decimals', () => {
    assert.equal(parseFormula('=56.32+62,21'), 118.53);
  });

  test('supports subtraction, multiplication, division and parentheses', () => {
    assert.equal(parseFormula('=(10+5)*2'), 30);
    assert.equal(parseFormula('=100-37,5'), 62.5);
    assert.equal(parseFormula('=99/4'), 24.75);
  });

  test('supports a leading unary minus', () => {
    assert.equal(parseFormula('=-12,5+2'), -10.5);
  });

  test('the "=" prefix is optional for formulas too', () => {
    assert.equal(parseFormula('10+5'), 15);
  });

  test('returns null for empty or blank input', () => {
    assert.equal(parseFormula(''), null);
    assert.equal(parseFormula('   '), null);
    assert.equal(parseFormula(null), null);
    assert.equal(parseFormula(undefined), null);
  });

  test('returns null for unparsable input', () => {
    assert.equal(parseFormula('=abc'), null);
    assert.equal(parseFormula('=12+'), null);
    assert.equal(parseFormula('=(12+5'), null);
    assert.equal(parseFormula('=12 5'), null);
  });

  test('returns null for a non-finite result', () => {
    assert.equal(parseFormula('=1/0'), null);
  });

  test('rounds the result to 2 decimals to avoid float artifacts', () => {
    assert.equal(parseFormula('=0.1+0.2'), 0.3);
  });
});
