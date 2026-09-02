// Rules that exclude a row from the import by description. These ship with
// the app; configs written by older versions can also carry `learned: true`
// rules, which still apply — matching doesn't care where a rule came from.
export function defaultSkipRules() {
  return [
    { id: 'seed-cc-payment-fr', pattern: 'paiement.*(re[cç]u|merci)', flags: 'i',
      reason: 'Paiement de carte de crédit', learned: false },
    { id: 'seed-cc-payment-en', pattern: 'payment.*(received|thank ?you)', flags: 'i',
      reason: 'Paiement de carte de crédit', learned: false },
  ];
}

export function matchSkipRule(description, rules) {
  const desc = String(description || '');
  for (const rule of rules) {
    try {
      if (new RegExp(rule.pattern, rule.flags || 'i').test(desc)) return rule;
    } catch {
      // a malformed learned pattern shouldn't break import — just skip it
    }
  }
  return null;
}
