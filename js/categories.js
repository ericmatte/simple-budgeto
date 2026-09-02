// Emoji lookup for categories, ported from the original Budget.dc.html design
// and expanded to cover common recurring-budget line items.
const EMOJI = [
  [/[ée]picer|aliment|grocer|march[eé]|entrep[oô]t/, '🛒'], [/resto|restaur|caf[eé]|bar$|d[eé]jeuner|livraison de repas/, '🍽️'],
  [/essence|gaz(?!on)|stm|bus|taxi|m[eé]tro|stationnement|immatriculation|permis de conduire|saaq/i, '⛽'],
  [/transport|auto(?!cross)|voiture|pneu|huile|filtre|upgrade/i, '🚗'],
  [/assurance/, '🛡️'],
  [/loyer|logement|hypoth|maison|condo/, '🏠'], [/piscine|spa/, '🏊'], [/d[eé]neig/, '❄️'], [/r[eé]paration/, '🔧'],
  [/chauffe-?eau|propane|hydro|[eé]lectric/, '🔌'], [/cellulaire|t[eé]l[eé]phone|forfait/, '📱'], [/internet|domotique|wifi/i, '📶'],
  [/service|abonnement|streaming|mots? de passe|courriel|musique/i, '💡'],
  [/loisir|cin[eé]ma|livre|librairie|escalade|sortie|amis/, '🎬'], [/sport|autocross|snow|downhill|ski/i, '🏂'], [/danse/, '💃'],
  [/sant[eé]|pharma|m[eé]dic|clinique/, '💊'], [/dentiste/, '🦷'], [/coiffeu/, '💇'],
  [/revenu|salaire|paie|d[eé]p[oô]t/, '💰'], [/placement|investis|rendement|[eé]pargne|reer|celi/i, '📈'],
  [/cadeau|f[eê]te|no[eë]l|anniversaire/, '🎁'], [/colis|livraison|achat en ligne/i, '📦'], [/v[eê]tement|mode|shopping|achats? divers/, '👕'],
  [/animal|v[eé]t[eé]rinaire|chien|chat/, '🐾'], [/bienvenue|imp[oô]t|taxe|frais bancaire|banque/, '🏦'],
  [/enfant|garderie|[eé]cole/, '🧸'],
  [/voyage|vacance|h[oô]tel|avion/, '✈️'],
  [/carte de cr[eé]dit|visa|mastercard/i, '💳'], [/splitwise/i, '🤝'], [/rallye|circuit|projet auto/i, '🏎️'],
  [/don|charit/, '❤️'], [/ajustement/, '⚖️'], [/virement|transfer/i, '🔁'], [/dette|remboursement/i, '🧾'],
];

export function emojiFor(name) {
  const s = (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [re, emoji] of EMOJI) if (re.test(s)) return emoji;
  return '•';
}
