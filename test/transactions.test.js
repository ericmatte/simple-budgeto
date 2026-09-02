import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cashbackTotal, excelFormula, isMutedRow, matchDateWarning, memberOptions, parseRange, rangeAfterImport, rangeCovering, rawFields, rowDescription, stepSelection } from '../js/views/transactions.js';

// The date range outlives the session, so it has to survive whatever
// localStorage hands back.

describe('parseRange', () => {
  test('reads a range written by a previous session', () => {
    assert.deepEqual(parseRange('{"from":"2026-01-01","to":"2026-03-31"}'), { from: '2026-01-01', to: '2026-03-31' });
  });

  test('nothing stored yet is an open range', () => {
    assert.deepEqual(parseRange(null), { from: '', to: '' });
  });

  test('drops a bound that is not an ISO date', () => {
    assert.deepEqual(parseRange('{"from":"01/01/2026","to":"2026-03-31"}'), { from: '', to: '2026-03-31' });
  });

  test('corrupted storage is an open range, not a crash', () => {
    assert.deepEqual(parseRange('{not json'), { from: '', to: '' });
    assert.deepEqual(parseRange('"a string"'), { from: '', to: '' });
  });
});

describe('rangeCovering', () => {
  test('an open range takes the span of the dates', () => {
    assert.deepEqual(rangeCovering({ from: '', to: '' }, ['2026-02-10', '2026-01-05', '2026-03-01']),
      { from: '2026-01-05', to: '2026-03-01' });
  });

  test('widens on both ends for dates outside the range', () => {
    assert.deepEqual(rangeCovering({ from: '2026-02-01', to: '2026-02-28' }, ['2026-01-05', '2026-03-01']),
      { from: '2026-01-05', to: '2026-03-01' });
  });

  test('leaves a range that already covers the dates alone', () => {
    assert.deepEqual(rangeCovering({ from: '2026-01-01', to: '2026-12-31' }, ['2026-06-06']),
      { from: '2026-01-01', to: '2026-12-31' });
  });

  test('ignores rows with no usable date', () => {
    assert.deepEqual(rangeCovering({ from: '2026-02-01', to: '2026-02-28' }, ['', null, 'plus tard']),
      { from: '2026-02-01', to: '2026-02-28' });
  });

  test('no date at all leaves the range untouched', () => {
    assert.deepEqual(rangeCovering({ from: '', to: '' }, []), { from: '', to: '' });
  });
});

// The raw lines of the selected row open as a table inside the list's own
// table. A rule written for the list that walks down to a bare th or td also
// lands on the nested one — which is how the list's sticky column names once
// slid over the raw values.
const NESTED_TAGS = new Set(['table', 'thead', 'tbody', 'tr', 'th', 'td']);

function reachesNestedTable(selector) {
  const steps = selector.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/);
  if (steps[0] !== '.tx-table') return false;
  const below = steps.slice(1);
  return below.length > 0 && below.every(step => NESTED_TAGS.has(step));
}

describe('transaction list stylesheet', () => {
  test('reachesNestedTable tells a scoped rule from a leaking one', () => {
    assert.equal(reachesNestedTable('.tx-table th'), true);
    assert.equal(reachesNestedTable('.tx-table tbody tr td'), true);
    assert.equal(reachesNestedTable('.tx-table > thead > tr > th'), false);
    assert.equal(reachesNestedTable('.tx-table .tx-month td'), false);
    assert.equal(reachesNestedTable('.tx-table tr.excluded'), false);
    assert.equal(reachesNestedTable('.tx-raw-table th'), false);
  });

  test('no list rule reaches into the raw table', () => {
    const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) || [];
    const leaking = selectors.flatMap(s => s.split(',')).map(s => s.trim()).filter(reachesNestedTable);
    assert.deepEqual(leaking, []);
  });
});

describe('rawFields', () => {
  test('pairs each header name with its value', () => {
    assert.deepEqual(rawFields({ header: 'Date,Description,Montant', line: '2026-01-05,Épicerie,-42.75' }), [
      { name: 'Date', value: '2026-01-05' },
      { name: 'Description', value: 'Épicerie' },
      { name: 'Montant', value: '-42.75' },
    ]);
  });

  test('splits on the delimiter of the header, not of the value line', () => {
    assert.deepEqual(rawFields({ header: 'Date;Description', line: '2026-01-05;Café, thé et cie' }), [
      { name: 'Date', value: '2026-01-05' },
      { name: 'Description', value: 'Café, thé et cie' },
    ]);
  });

  test('a headerless CIBC export gets the column names its parser reads', () => {
    assert.deepEqual(rawFields({ source: 'cibc', header: '', line: '2026-01-05,ÉPICERIE,42.75,,1234' }), [
      { name: 'Date', value: '2026-01-05' },
      { name: 'Description', value: 'ÉPICERIE' },
      { name: 'Débit', value: '42.75' },
      { name: 'Crédit', value: '' },
      { name: 'Carte', value: '1234' },
    ]);
  });

  test('a headerless source nobody knows gets numbered columns', () => {
    assert.deepEqual(rawFields({ source: 'banque-x', header: '', line: '2026-01-05,Épicerie,42.75' }), [
      { name: 'Colonne 1', value: '2026-01-05' },
      { name: 'Colonne 2', value: 'Épicerie' },
      { name: 'Colonne 3', value: '42.75' },
    ]);
  });

  test('a header of its own beats the known column names', () => {
    assert.deepEqual(rawFields({ source: 'cibc', header: 'Jour,Libellé', line: '2026-01-05,Épicerie' }), [
      { name: 'Jour', value: '2026-01-05' },
      { name: 'Libellé', value: 'Épicerie' },
    ]);
  });

  test('numbers the columns past the ones the source is known to have', () => {
    assert.deepEqual(rawFields({ source: 'cibc', header: '', line: 'a,b,c,d,e,f' })[5], { name: 'Colonne 6', value: 'f' });
  });

  test('keeps a column the line leaves empty', () => {
    assert.deepEqual(rawFields({ header: 'Date,Débit,Crédit', line: '2026-01-05,,42.75' }), [
      { name: 'Date', value: '2026-01-05' },
      { name: 'Débit', value: '' },
      { name: 'Crédit', value: '42.75' },
    ]);
  });

  test('keeps a value the header does not name', () => {
    assert.deepEqual(rawFields({ header: 'Date,Montant', line: '2026-01-05,42.75,USD' }), [
      { name: 'Date', value: '2026-01-05' },
      { name: 'Montant', value: '42.75' },
      { name: 'Colonne 3', value: 'USD' },
    ]);
  });

  test('reads a quoted field holding the delimiter', () => {
    assert.deepEqual(rawFields({ header: 'Date,Description', line: '2026-01-05,"Épicerie, rue Principale"' }), [
      { name: 'Date', value: '2026-01-05' },
      { name: 'Description', value: 'Épicerie, rue Principale' },
    ]);
  });

  test('nothing to show is no field at all', () => {
    assert.deepEqual(rawFields({ header: '', line: '' }), []);
    assert.deepEqual(rawFields(), []);
  });
});

describe('isMutedRow', () => {
  test('steps back from a cashback, a payment and a settlement', () => {
    assert.equal(isMutedRow({ description: 'CASHBACK REDEMPTION', amount: -20 }), true);
    assert.equal(isMutedRow({ description: 'PAIEMENT CARTE DE CREDIT', amount: -300 }), true);
    assert.equal(isMutedRow({ description: 'Alix N. paid Bruno L.', amount: -50 }), true);
  });

  test('reads the terms whatever their case', () => {
    assert.equal(isMutedRow({ description: 'Cashback', amount: -20 }), true);
    assert.equal(isMutedRow({ description: 'paiement de facture', amount: -20 }), true);
  });

  test('steps back from a row that rounds to nothing', () => {
    assert.equal(isMutedRow({ description: 'Ajustement', amount: 0 }), true);
    assert.equal(isMutedRow({ description: 'Ajustement', amount: -0.004 }), true);
  });

  test('leaves an ordinary purchase alone', () => {
    assert.equal(isMutedRow({ description: 'MARCHÉ NORDET', amount: -51.01 }), false);
    assert.equal(isMutedRow({ description: 'Lampe de bureau', amount: -0.01 }), false);
  });

  test('a word that merely holds one of the terms is not one', () => {
    assert.equal(isMutedRow({ description: 'UNPAID INVOICE', amount: -10 }), false);
  });

  test('a row that is nothing at all is left alone', () => {
    assert.equal(isMutedRow(null), false);
    assert.equal(isMutedRow({ description: 'Marché Nordet', amount: NaN }), false);
  });
});

describe('rowDescription', () => {
  test('leads with the Splitwise wording and keeps the statement in brackets', () => {
    assert.equal(rowDescription({ description: 'BOUTIQUE EN LIGNE *4XK2 LEVANT, QC', matchDescription: 'Bâche de rangement' }),
      'Bâche De Rangement (Boutique En Ligne *4Xk2 Levant, Qc)');
  });

  test('an unmatched row reads as it always did', () => {
    assert.equal(rowDescription({ description: 'MARCHÉ NORDET', matchDescription: '' }), 'Marché Nordet');
    assert.equal(rowDescription({ description: 'MARCHÉ NORDET' }), 'Marché Nordet');
  });

  test('a statement that named nothing leaves no empty brackets', () => {
    assert.equal(rowDescription({ description: '', matchDescription: 'Bâche de rangement' }), 'Bâche De Rangement');
  });

  test('a row named by nobody says so', () => {
    assert.equal(rowDescription({ description: '', matchDescription: '' }), '—');
    assert.equal(rowDescription(), '—');
  });
});

// A term to append to a sum the reader is already writing: it opens on "+",
// never on "=", and the sheet it lands in decides the sign. N("…") is zero to
// Excel, so the cell adds up as the amount and still says what it stands for.
describe('excelFormula', () => {
  test('carries the amount and the note the row shows', () => {
    assert.equal(excelFormula({ date: '2026-06-05', description: 'BISTRO NORDET', amount: -23 }),
      '+23.00+N("5 juin Bistro Nordet")');
  });

  test('notes a matched row the way the row itself reads', () => {
    assert.equal(excelFormula({ date: '2026-05-05', description: 'BOUTIQUE EN LIGNE *4XK2', matchDescription: 'Bâche de rangement', amount: -80.46 }),
      '+80.46+N("5 mai Bâche De Rangement (Boutique En Ligne *4Xk2)")');
  });

  test('hands over a spend as a positive term', () => {
    assert.equal(excelFormula({ date: '2026-01-05', description: 'Marché Nordet', amount: -5 }), '+5.00+N("5 janv. Marché Nordet")');
    assert.equal(excelFormula({ date: '2026-01-05', description: 'Paie', amount: 5 }), '+5.00+N("5 janv. Paie")');
  });

  test('writes the cents a formula needs, with a dot', () => {
    assert.equal(excelFormula({ date: '2026-06-05', description: 'Marché Nordet', amount: -51.5 }), '+51.50+N("5 juin Marché Nordet")');
    assert.equal(excelFormula({ date: '2026-06-05', description: 'Paie', amount: 1204 }), '+1204.00+N("5 juin Paie")');
  });

  test('doubles a quote in the note, which would end the note early', () => {
    assert.equal(excelFormula({ date: '2026-06-05', description: 'Chez "Bob"', amount: -5 }),
      '+5.00+N("5 juin Chez ""Bob""")');
  });

  test('leaves a date it cannot read out of the note', () => {
    assert.equal(excelFormula({ date: '', description: 'Marché Nordet', amount: -5 }), '+5.00+N("Marché Nordet")');
  });

  test('drops the note when there is nothing to say', () => {
    assert.equal(excelFormula({ date: '', description: '', amount: -5 }), '+5.00');
  });

  test('an amount it cannot read is no formula at all', () => {
    assert.equal(excelFormula({ date: '2026-06-05', description: 'Marché Nordet', amount: NaN }), '');
    assert.equal(excelFormula(null), '');
  });
});

describe('memberOptions', () => {
  test('the first name leads the list, so it is the one already selected', () => {
    const html = memberOptions(['Alix Nordet', 'Bruno Levant']);
    assert.ok(html.startsWith('<option value="Alix Nordet">'));
    assert.equal(html.includes('value=""'), false);
  });

  test('lists every name, in the order given', () => {
    assert.deepEqual(memberOptions(['A', 'B', 'C']).match(/value="(\w)"/g), ['value="A"', 'value="B"', 'value="C"']);
  });

  test('escapes a name that would otherwise break out of the option', () => {
    assert.equal(memberOptions(['A & "B"']), '<option value="A &amp; &quot;B&quot;">A &amp; &quot;B&quot;</option>');
  });

  test('no name to offer leaves the placeholder standing', () => {
    assert.equal(memberOptions([]), '<option value="">Choisir…</option>');
  });
});

describe('matchDateWarning', () => {
  test('counts the days between the expense and the bank line', () => {
    assert.equal(matchDateWarning({ date: '2026-08-06', matchDate: '2026-08-04' }), 'L’entrée Splitwise est à 2 jours de la transaction');
  });

  test('counts a single day in the singular', () => {
    assert.equal(matchDateWarning({ date: '2026-08-06', matchDate: '2026-08-05' }), 'L’entrée Splitwise est à 1 jour de la transaction');
  });

  test('reads the same either side of the bank line', () => {
    assert.equal(matchDateWarning({ date: '2026-08-06', matchDate: '2026-08-08' }), 'L’entrée Splitwise est à 2 jours de la transaction');
  });

  test('a date it cannot read says nothing', () => {
    assert.equal(matchDateWarning({ date: 'inconnue', matchDate: '2026-08-04' }), '');
  });

  test('a match on one single day says nothing', () => {
    assert.equal(matchDateWarning({ date: '2026-08-06', matchDate: '2026-08-06' }), '');
    assert.equal(matchDateWarning({ date: '2026-08-06', matchDate: null }), '');
    assert.equal(matchDateWarning({ date: '2026-08-06' }), '');
  });

  test('a row that is nothing at all says nothing', () => {
    assert.equal(matchDateWarning(null), '');
  });
});

// Nothing but the range survives a reload, so re-importing the same files has
// to land the reader back on the dates they had picked.
describe('rangeAfterImport', () => {
  const stored = '{"from":"2026-01-01","to":"2026-03-31"}';

  test('keeps the range the reader picked before the reload', () => {
    assert.deepEqual(rangeAfterImport(stored, ['2026-05-04', '2025-11-02']), { from: '2026-01-01', to: '2026-03-31' });
  });

  test('keeps a range that is open on one end', () => {
    assert.deepEqual(rangeAfterImport('{"from":"2026-01-01"}', ['2026-05-04']), { from: '2026-01-01', to: '' });
    assert.deepEqual(rangeAfterImport('{"to":"2026-03-31"}', ['2025-05-04']), { from: '', to: '2026-03-31' });
  });

  test('nothing stored yet takes the span of the import', () => {
    assert.deepEqual(rangeAfterImport(null, ['2026-05-04', '2026-05-06']), { from: '2026-05-04', to: '2026-05-06' });
  });

  test('a stored range nobody can read is no range at all', () => {
    assert.deepEqual(rangeAfterImport('{not json', ['2026-05-04']), { from: '2026-05-04', to: '2026-05-04' });
  });

  test('an import of nothing dated leaves an empty range empty', () => {
    assert.deepEqual(rangeAfterImport(null, []), { from: '', to: '' });
  });
});

describe('stepSelection', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  test('moves down and up by one', () => {
    assert.equal(stepSelection(rows, 'a', 1), 'b');
    assert.equal(stepSelection(rows, 'b', -1), 'a');
  });

  test('stops at both ends instead of wrapping around', () => {
    assert.equal(stepSelection(rows, 'a', -1), 'a');
    assert.equal(stepSelection(rows, 'c', 1), 'c');
  });

  test('a selection that is no longer listed falls back to the first row', () => {
    assert.equal(stepSelection(rows, 'gone', 1), 'a');
    assert.equal(stepSelection(rows, null, -1), 'a');
  });

  test('an empty list selects nothing', () => {
    assert.equal(stepSelection([], 'a', 1), null);
  });
});

describe('cashbackTotal', () => {
  const rows = [
    { description: 'CASHBACK/REMISE EN ARGENT', amount: 12.5 },
    { description: 'MARCHÉ NORDET', amount: -51.01 },
    { description: 'Remise en argent annuelle', amount: 30 },
  ];

  test('adds up every cashback the period shows', () => {
    assert.equal(cashbackTotal(rows), 42.5);
  });

  test('counts a row under either name it goes by', () => {
    assert.equal(cashbackTotal([rows[0]]), 12.5);
    assert.equal(cashbackTotal([rows[2]]), 30);
  });

  test('leaves every other row out of the total', () => {
    assert.equal(cashbackTotal([rows[1]]), 0);
  });

  test('a row whose amount cannot be read adds nothing', () => {
    assert.equal(cashbackTotal([{ description: 'Cashback', amount: NaN }, rows[0]]), 12.5);
  });

  test('nothing on screen is nothing to report', () => {
    assert.equal(cashbackTotal([]), 0);
    assert.equal(cashbackTotal(), 0);
  });
});
