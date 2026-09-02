import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupColors, sourceLabel, sourceLogoHTML } from '../js/lib/sourceLogos.js';

// The reader keeps several Splitwise groups at once. The logo says the export
// came from Splitwise; the dot says which group it came from, so no two
// groups on screen may wear the same colour or two neighbouring ones.
describe('groupColors', () => {
  const hue = colour => Number(/^hsl\((\d+)/.exec(colour)[1]);

  test('deals every group a colour of its own', () => {
    const palette = groupColors(['Groupe Alpha', 'Escapade 2026', 'Groupe Bravo']);
    assert.equal(new Set(palette.values()).size, 3);
  });

  test('keeps the colours far enough apart to tell at a glance', () => {
    const hues = [...groupColors(['Groupe Alpha', 'Escapade 2026', 'Groupe Bravo']).values()].map(hue);
    for (const a of hues) for (const b of hues) if (a !== b) assert.ok(Math.abs(a - b) >= 45);
  });

  test('a group keeps its colour however often it is named', () => {
    const once = groupColors(['Groupe Alpha', 'Groupe Charlie']);
    const many = groupColors(['Groupe Charlie', 'Groupe Alpha', 'Groupe Alpha', 'Groupe Charlie', 'Groupe Alpha']);
    assert.equal(once.get('Groupe Alpha'), many.get('Groupe Alpha'));
    assert.equal(once.get('Groupe Charlie'), many.get('Groupe Charlie'));
  });

  test('only the hue moves, so every dot carries the same weight', () => {
    for (const colour of groupColors(['Groupe Alpha', 'Escapade 2026', 'Groupe Charlie']).values()) {
      assert.match(colour, /^hsl\(\d{1,3} 70% 50%\)$/);
    }
  });

  test('rows that belong to no group leave the palette empty', () => {
    assert.equal(groupColors(['', null, '   ']).size, 0);
    assert.equal(groupColors([]).size, 0);
    assert.equal(groupColors().size, 0);
  });

  test('more groups than hues starts the wheel again rather than running dry', () => {
    const many = groupColors(Array.from({ length: 10 }, (_, i) => `Groupe ${i}`));
    assert.equal(many.size, 10);
    assert.equal(new Set(many.values()).size, 8);
  });
});

describe('sourceLogoHTML', () => {
  test('a mark with no group is the tile alone', () => {
    const html = sourceLogoHTML('splitwise');
    assert.equal(html.includes('src-dot'), false);
    assert.equal(html.includes('src-mark'), false);
  });

  test('a group wraps the tile and pins its colour to the corner', () => {
    const html = sourceLogoHTML('splitwise', '', 'hsl(45 70% 50%)');
    assert.ok(html.includes('class="src-mark"'));
    assert.ok(html.includes('background:hsl(45 70% 50%)'));
  });

  test('a source with no logo still takes a dot', () => {
    const html = sourceLogoHTML('banque-x', '', 'hsl(45 70% 50%)');
    assert.ok(html.includes('src-logo-empty'));
    assert.ok(html.includes('src-dot'));
  });

  test('names a source the app has a mark for, and one it has not', () => {
    assert.equal(sourceLabel('splitwise'), 'Splitwise');
    assert.equal(sourceLabel(''), 'Source inconnue');
  });
});
