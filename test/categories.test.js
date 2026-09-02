import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { emojiFor } from '../js/categories.js';

describe('emojiFor', () => {
  // A household budget's own vocabulary, invented for this test: every branch
  // of the emoji table has to answer, so a category never falls back to the
  // bullet in a real budget.
  test('every category a household budget carries resolves to a specific emoji, not the fallback', () => {
    const cats = [
      'Salaire net', 'REER', 'Impôts', 'Investissements', 'Rallye auto', 'Voyages', 'Hypothèque',
      'Assurance Habitation', 'Électricité', 'Internet', 'Taxe municipale', 'Taxe scolaire',
      'Location chauffe-eau', 'Location propane', 'Taxe de bienvenue', 'Réparations (Maison)',
      'Piscine & spa', 'Déneigement', 'Épicerie', 'Vêtements', 'Vétérinaire', 'Achats divers', 'Cadeaux',
      'Restaurants', 'Sorties & amis', 'Dentiste', 'Coiffeuse', 'Cellulaire', 'Entrepôt en gros',
      'Abonnement streaming', 'Achat en ligne', 'Carte de crédit', 'Gestionnaire de mots de passe',
      'Splitwise', 'Boîte courriel', 'Cours de musique', 'Domotique',
      'Assurances Vie Permanente', 'Assurance Vie Temporaire', 'Assurance Auto', 'Gaz',
      'Réparations (Voitures)', "Frais d'immatriculation", 'Permis de conduire - SAAQ', 'Upgrades',
      "Changement d'huile/filtre", 'Autocross', 'Danse', 'Snow', 'Downhill',
    ];
    const missing = cats.filter(c => emojiFor(c) === '•');
    assert.deepEqual(missing, []);
  });

  test('a tax category is not misread as a school/childcare category', () => {
    assert.equal(emojiFor('Taxe scolaire'), '🏦');
    assert.equal(emojiFor('École primaire'), '🧸');
  });

  test('unknown categories fall back to the generic bullet', () => {
    assert.equal(emojiFor('Une catégorie totalement inventée xyz'), '•');
  });
});
