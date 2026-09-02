import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isAnchorOffscreen } from '../js/lib/anchor.js';

const VIEWPORT = 800;
const rect = (top, height = 30) => ({ top, bottom: top + height });

describe('isAnchorOffscreen', () => {
  test('a row in the middle of the window keeps its popup open', () => {
    assert.equal(isAnchorOffscreen(rect(400), VIEWPORT), false);
  });

  test('a row scrolled past the top of the window drops its popup', () => {
    assert.equal(isAnchorOffscreen(rect(-30), VIEWPORT), true);
  });

  test('a row scrolled past the bottom of the window drops its popup', () => {
    assert.equal(isAnchorOffscreen(rect(800), VIEWPORT), true);
  });

  test('a row half out of the window still has something to anchor to', () => {
    assert.equal(isAnchorOffscreen(rect(-15), VIEWPORT), false);
    assert.equal(isAnchorOffscreen(rect(790), VIEWPORT), false);
  });
});
