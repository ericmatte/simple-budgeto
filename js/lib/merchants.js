// Turning a statement line into the merchant behind it.
//
// A bank writes the same merchant a different way on every row — a store
// number, a terminal id, a payment processor's prefix — so classifying "one
// row" would mean classifying the same shop twenty times. The key computed
// here is what a rule is filed under, and what groups rows together in the
// "à classer" inbox.

// "SQ *CAFE ALIZE" / "PP *JEUX EN LIGNE": a processor's own tag, followed
// by the merchant that actually took the money. Anchored, so the star inside
// "BOUTIQUE EN LIGNE *4XK2" (a reference number, not a prefix) isn't touched here.
const PROCESSOR_PREFIX = /^[a-z0-9]{2,8}\s*\*\s*/i;

export function merchantKey(description) {
  let s = String(description || '').trim();
  s = s.replace(PROCESSOR_PREFIX, '');
  // Everything past a star is a reference number: "BOUTIQUE EN LIGNE *4XK2".
  s = s.split('*')[0];
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    // Store and terminal numbers vary from one visit to the next, and the
    // merchant does not: "RESTO PONANT #12" and "RESTO PONANT #9902" are one
    // decision, not two.
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// What the inbox shows as the name of a merchant cluster: the raw description
// of one of its rows reads better than the stripped key ("RESTO PONANT #12"
// rather than "RESTO PONANT"), and the shortest one is the least polluted by
// reference numbers.
export function merchantLabel(descriptions) {
  const sorted = [...descriptions].filter(Boolean).sort((a, b) => a.length - b.length || a.localeCompare(b));
  return sorted[0] || '';
}

// The same shop, with the branch spelled out: a statement writes "RESTO PONANT
// #12" one month and "RESTO PONANT #12 SAINTE-BRISE" the next. One key being
// the start of the other, word for word, is the tell.
//
// Two words are the minimum, because a single one is a family and not a
// merchant — "UBER" must not swallow "UBER EATS".
const MIN_PREFIX_WORDS = 2;

export function isMerchantPrefix(prefix, key) {
  if (!prefix || prefix === key) return false;
  if (prefix.split(' ').length < MIN_PREFIX_WORDS) return false;
  return key.startsWith(prefix + ' ');
}

// The shortest key that every longer spelling of the same merchant folds into,
// so one answer covers all of them.
export function canonicalMerchantKey(key, keys) {
  let best = key;
  for (const candidate of keys) {
    if (isMerchantPrefix(candidate, best)) best = candidate;
  }
  return best;
}

// The rule that applies to a merchant: its own, or failing that the most
// specific rule written for a shorter spelling of the same name. Classifying
// "RESTO PONANT" once is meant to settle every branch of it.
export function merchantRuleFor(rules, key) {
  if (!key) return null;
  if (rules[key]) return rules[key];
  let match = null;
  for (const candidate of Object.keys(rules)) {
    if (!isMerchantPrefix(candidate, key)) continue;
    if (!match || candidate.length > match.length) match = candidate;
  }
  return match ? rules[match] : null;
}
