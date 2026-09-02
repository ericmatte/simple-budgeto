import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { icon, ICON_NAMES } from '../js/lib/icons.js';

describe('icon', () => {
  test('every icon is a self-contained monochrome SVG', () => {
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      assert.match(svg, /^<svg class="icon"/, `${name} is missing the shared class`);
      assert.match(svg, /viewBox="0 0 24 24"/, `${name} is not on the shared 24×24 grid`);
      assert.match(svg, /stroke="currentColor"/, `${name} does not inherit the text colour`);
      assert.match(svg, /fill="none"/, `${name} is filled instead of stroked`);
      assert.ok(svg.endsWith('</svg>'), `${name} is not closed`);
      assert.doesNotMatch(svg, /#[0-9a-f]{3,6}|rgb\(/i, `${name} hard-codes a colour`);
    }
  });

  test('sizes both axes so the box never collapses before the SVG loads', () => {
    assert.match(icon('x', { size: 13 }), /width="13" height="13"/);
  });

  test('is hidden from screen readers unless it is given a label of its own', () => {
    assert.match(icon('x'), /aria-hidden="true"/);
    assert.match(icon('x', { label: 'Fermer' }), /role="img" aria-label="Fermer"/);
  });

  test('escapes the label instead of letting it close the tag', () => {
    assert.match(icon('x', { label: '"><script>' }), /aria-label="&quot;&gt;&lt;script&gt;"/);
  });

  test('adds an extra class without dropping the shared one', () => {
    assert.match(icon('x', { className: 'icon-lead' }), /class="icon icon-lead"/);
  });

  test('a typo fails loudly rather than rendering an invisible gap', () => {
    assert.throws(() => icon('definitely-not-an-icon'), /Unknown icon/);
  });
});

// The category emojis are deliberately left alone (js/categories.js owns them,
// and the user picks their own through emoji-mart). Everywhere else the app
// draws its own chrome, and that chrome is SVG only.
describe('app chrome', () => {
  const PICTOGRAPH = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}/u;
  const OWNS_EMOJI = ['js/categories.js', 'js/lib/emojiPicker.js'];

  function sources(dir, found = []) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) sources(path, found);
      else if (entry.endsWith('.js')) found.push(path);
    }
    return found;
  }

  test('carries no emoji of its own', () => {
    const offenders = sources('js')
      .filter(path => !OWNS_EMOJI.includes(path))
      .flatMap(path => readFileSync(path, 'utf8').split('\n')
        .map((line, i) => ({ path, line: i + 1, text: line.trim() }))
        .filter(l => PICTOGRAPH.test(l.text)))
      .map(l => `${l.path}:${l.line} ${l.text}`);
    assert.deepEqual(offenders, [], `use icon() from js/lib/icons.js instead:\n${offenders.join('\n')}`);
  });
});
