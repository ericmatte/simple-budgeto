import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as cibc from '../js/parsers/cibc.js';
import * as tangerine from '../js/parsers/tangerine.js';
import * as wealthsimple from '../js/parsers/wealthsimple.js';
import * as splitwise from '../js/parsers/splitwise.js';
import * as generic from '../js/parsers/generic.js';
import { detectAdapter, parseText } from '../js/parsers/index.js';

const CIBC_SAMPLE = [
  '2026-08-07,"GARAGE SUROIT INC SAINTE-BRISE, QC",500.87,,1234******5678',
  '2026-08-04,"MARCHÉ NORDET #8 SAINTE-BRISE, QC",51.01,,1234******5679',
  '2026-07-31,PAIEMENT RECU - MERCI,,1856.08,1234******5681',
  '2026-07-30,CASHBACK/REMISE EN ARGENT,,17.30,1234******5683',
].join('\n');

describe('cibc parser', () => {
  test('detects the headerless 5-column format', () => {
    assert.ok(cibc.detect(CIBC_SAMPLE));
  });

  test('parses debit as negative and credit as positive', () => {
    const { candidates, fileError } = cibc.parse(CIBC_SAMPLE);
    assert.equal(fileError, null);
    assert.equal(candidates.length, 4);
    assert.equal(candidates[0].amount, -500.87);
    assert.equal(candidates[0].date, '2026-08-07');
    assert.equal(candidates[0].description, 'GARAGE SUROIT INC SAINTE-BRISE, QC');
    assert.equal(candidates[2].amount, 1856.08);
    assert.equal(candidates[2].description, 'PAIEMENT RECU - MERCI');
  });

  test('flags rows with an unparsable date as errors, not silent drops', () => {
    const { candidates } = cibc.parse('notadate,Some desc,10,,1234******0000');
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].error.reason.includes('Date invalide'), true);
  });

  test('flags rows missing both debit and credit as errors', () => {
    const { candidates } = cibc.parse('2026-08-07,Desc,,,1234******0000');
    assert.equal(candidates[0].error.reason.includes('Montant introuvable'), true);
  });
});

const TANGERINE_SAMPLE = [
  'Transaction date,Transaction,Name,Memo,Amount',
  '08/06/2026,CREDIT,PAIEMENT - MERCI,,302.37',
  '07/28/2026,DEBIT,ESSENCE PONANT W13 SAINTE-BRISE,Rewards earned: 1.47 ~ Category: Gas,-73.71',
].join('\n');

describe('tangerine parser', () => {
  test('detects its header', () => {
    assert.ok(tangerine.detect(TANGERINE_SAMPLE));
  });

  test('parses dates and signed amounts, extracting Category from the memo', () => {
    const { candidates, fileError } = tangerine.parse(TANGERINE_SAMPLE);
    assert.equal(fileError, null);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].date, '2026-08-06');
    assert.equal(candidates[0].amount, 302.37);
    assert.equal(candidates[1].date, '2026-07-28');
    assert.equal(candidates[1].amount, -73.71);
    assert.equal(candidates[1].suggestedCategory, 'Gas');
  });
});

const WEALTHSIMPLE_SAMPLE = [
  'activities-export-2026-08-10',
  'effective_at,settlement_date,account_id,account_type,activity_type,activity_sub_type,description,direction,symbol,name,currency,quantity,unit_price,commission,net_cash_amount',
  '2026-07-15T20:00:00-04:00,,TEST,Chequing,MoneyMovement,AFT_OUT,Pre-authorized Debit,,,,CAD,-87.86,,,-87.86',
  '2026-07-24T20:00:00-04:00,,TEST,Chequing,MoneyMovement,E_TRFIN,Interac e-Transfer® Received,,,,CAD,20.57,,,20.57',
  ',,,,,,,,,,,,,,',
  'As of 2026-08-10 12:41 GMT-04:00,,,,,,,,,,,,,,',
].join('\n');

describe('wealthsimple parser', () => {
  test('detects its header even after a title line', () => {
    assert.ok(wealthsimple.detect(WEALTHSIMPLE_SAMPLE));
  });

  test('skips the title and footer rows, extracts date/amount and a category hint', () => {
    const { candidates, fileError } = wealthsimple.parse(WEALTHSIMPLE_SAMPLE);
    assert.equal(fileError, null);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].date, '2026-07-15');
    assert.equal(candidates[0].amount, -87.86);
    assert.equal(candidates[0].suggestedCategory, 'Paiement préautorisé');
  });

  test('flags transfer rows distinctly so they can be excluded by default', () => {
    const { candidates } = wealthsimple.parse(WEALTHSIMPLE_SAMPLE);
    const transfer = candidates.find(c => c.description.includes('Interac e-Transfer'));
    assert.equal(transfer.suggestedCategory, null);
    assert.equal(transfer.isTransfer, true);
  });
});

const SPLITWISE_SAMPLE = [
  'user1-and-user2_2026-08-10_export',
  'Note: does not include group expenses',
  '',
  'Date,Description,Category,Cost,Currency,User1,User2',
  '',
  '2026-06-26,Première facture Internet,TV/Phone/Internet,205.00,CAD,102.50,-102.50',
  '2026-06-26,User1 paid User2,Payment,102.50,CAD,-102.50,102.50',
  '2026-06-27,Marché Nordet,Household supplies,38.94,CAD,19.47,-19.47',
  '2026-06-30,Bazar Levant,Household supplies,24.13,CAD,-12.06,12.06',
  '',
  '2026-08-10,Total balance, , ,CAD,-493.61,493.61',
].join('\n');

describe('splitwise parser', () => {
  test('detects its header', () => {
    assert.ok(splitwise.detect(SPLITWISE_SAMPLE));
  });

  test('inspect() surfaces the two member column names without needing to know who "me" is', () => {
    const { memberColumns, fileError } = splitwise.inspect(SPLITWISE_SAMPLE);
    assert.equal(fileError, null);
    assert.deepEqual(memberColumns, ['User1', 'User2']);
  });

  test('commonMembers() keeps only the names present in every export', () => {
    assert.deepEqual(
      splitwise.commonMembers([['Alix N.', 'Bruno L.'], ['Alix N.', 'Camille S.', 'Sam P.']]),
      ['Alix N.'],
    );
  });

  test('commonMembers() of a single export is that export\'s members', () => {
    assert.deepEqual(splitwise.commonMembers([['User1', 'User2']]), ['User1', 'User2']);
  });

  test('commonMembers() falls back to every name when the exports share none', () => {
    assert.deepEqual(
      splitwise.commonMembers([['Alix N.', 'Bruno L.'], ['Alix Nordet', 'Camille S.']]),
      ['Alix N.', 'Bruno L.', 'Alix Nordet', 'Camille S.'],
    );
  });

  test('commonMembers() of nothing is nothing', () => {
    assert.deepEqual(splitwise.commonMembers([]), []);
    assert.deepEqual(splitwise.commonMembers([[], []]), []);
  });

  test('parse() without a valid member name asks for one instead of guessing', () => {
    const result = splitwise.parse(SPLITWISE_SAMPLE, 'Nobody');
    assert.equal(result.needsMemberSelection, true);
  });

  test('computes my share: I paid in full → net cost is mine minus what I get back', () => {
    const { candidates } = splitwise.parse(SPLITWISE_SAMPLE, 'User1');
    const internet = candidates.find(c => c.description === 'Première facture Internet');
    assert.equal(internet.amount, 102.50 - 205.00);
    assert.equal(internet.suggestedCategory, 'TV/Phone/Internet');
    assert.deepEqual(internet.matchHint, { date: '2026-06-26', amount: 205.00 });
  });

  test('computes my share: I did not pay → net cost is exactly what I owe', () => {
    const { candidates } = splitwise.parse(SPLITWISE_SAMPLE, 'User1');
    const dunant = candidates.find(c => c.description === 'Bazar Levant');
    assert.equal(dunant.amount, -12.06);
  });

  // 0 for every member: either I paid the whole thing and all of it was my
  // share, or someone else did — the export can't tell the two apart, so the
  // line must not claim the bank row of that day.
  test('a row where nobody owes anybody claims neither a share nor a bank row', () => {
    const csv = [
      'Date,Description,Category,Cost,Currency,User1,User2',
      '2026-02-28,Lampes connectées,Furniture,1085.00,CAD,0.00,0.00',
    ].join('\n');
    const { candidates } = splitwise.parse(csv, 'User1');
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].amount, 0);
    assert.equal(candidates[0].noBalance, true);
    assert.equal(candidates[0].matchHint, null);
  });

  test('flags settlement ("Payment") rows distinctly so they can be excluded by default', () => {
    const { candidates } = splitwise.parse(SPLITWISE_SAMPLE, 'User1');
    const payment = candidates.find(c => c.description === 'User1 paid User2');
    assert.equal(payment.isSettlement, true);
    assert.equal(payment.matchHint, null);
  });

  test('ignores the trailing "Total balance" running-total row', () => {
    const { candidates } = splitwise.parse(SPLITWISE_SAMPLE, 'User1');
    assert.equal(candidates.some(c => c.description === 'Total balance'), false);
  });
});

const BUDGET_CSV_SAMPLE = [
  'date;type;description;montant;categorie;frequence;mois',
  '2026-01-01;reel;Loyer;-1450;Logement;;',
  ';planifie;Épicerie;-700;Épicerie;mensuel;',
  ';objectif;Mise de fonds;120000;;;',
].join('\n');

describe('generic parser', () => {
  test('parses the planned-budget CSV schema (kind/freq/month)', () => {
    const { candidates, fileError } = generic.parse(BUDGET_CSV_SAMPLE);
    assert.equal(fileError, null);
    assert.equal(candidates.length, 3);
    assert.equal(candidates[0].kind, 'reel');
    assert.equal(candidates[1].kind, 'planifie');
    assert.equal(candidates[1].freq, 'mensuel');
    assert.equal(candidates[2].kind, 'objectif');
    assert.equal(candidates[2].amount, 120000);
  });
});

describe('adapter registry', () => {
  test('detects the right adapter for each real sample', () => {
    assert.equal(detectAdapter(CIBC_SAMPLE).SOURCE, 'cibc');
    assert.equal(detectAdapter(TANGERINE_SAMPLE).SOURCE, 'tangerine');
    assert.equal(detectAdapter(WEALTHSIMPLE_SAMPLE).SOURCE, 'wealthsimple');
    assert.equal(detectAdapter(SPLITWISE_SAMPLE).SOURCE, 'splitwise');
    assert.equal(detectAdapter(BUDGET_CSV_SAMPLE).SOURCE, 'generic');
  });

  test('returns a file-level error for unrecognizable text', () => {
    const result = parseText('this is just some random pasted text\nwith no columns', 'mystery.txt');
    assert.equal(result.candidates.length, 0);
    assert.ok(result.fileError);
  });

  test('parseText requests member selection for Splitwise before myName is known', () => {
    const result = parseText(SPLITWISE_SAMPLE, 'splitwise.csv');
    assert.equal(result.needsMemberSelection, true);
    assert.deepEqual(result.memberColumns, ['User1', 'User2']);
  });

  test('parseText computes amounts once one of my names matches a column', () => {
    const result = parseText(SPLITWISE_SAMPLE, 'splitwise.csv', { splitwiseMyNames: ['Someone Else', 'User1'] });
    assert.ok(result.candidates.length > 0);
  });

  test('parseText still asks when none of my known names appear in this export', () => {
    const result = parseText(SPLITWISE_SAMPLE, 'splitwise.csv', { splitwiseMyNames: ['Alix N.'] });
    assert.equal(result.needsMemberSelection, true);
    assert.deepEqual(result.memberColumns, ['User1', 'User2']);
  });
});
