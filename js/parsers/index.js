import * as cibc from './cibc.js';
import * as tangerine from './tangerine.js';
import * as wealthsimple from './wealthsimple.js';
import * as splitwise from './splitwise.js';
import * as generic from './generic.js';

// Order matters: more specific formats first, generic budget-CSV last.
const ADAPTERS = [cibc, tangerine, wealthsimple, splitwise, generic];

export const LABELS = {
  cibc: 'CIBC Visa',
  tangerine: 'Tangerine Mastercard',
  wealthsimple: 'Wealthsimple',
  splitwise: 'Splitwise',
  generic: 'Budget (CSV générique)',
};

// Splitwise needs a "which column is me?" answer before it can compute
// amounts, so detection surfaces that as a distinct outcome instead of a
// silent parse.
export function detectAdapter(text) {
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.detect(text)) return adapter;
    } catch {
      // detection is best-effort; a throwing detector just isn't a match
    }
  }
  return null;
}

// Parses one pasted/uploaded text blob. `context.splitwiseMyNames` holds every
// name the user has already claimed as their own — one per Splitwise export,
// since a group CSV and a friend CSV can spell the same person differently.
// A file whose member columns match none of them comes back with
// `needsMemberSelection` + `memberColumns` for the UI to ask about that file.
export function parseText(text, label, context = {}) {
  const adapter = detectAdapter(text);
  if (!adapter) {
    return { source: null, sourceLabel: label || 'inconnu', candidates: [], fileError: 'Format non reconnu — aucune colonne date/montant identifiable.' };
  }

  if (adapter === splitwise) {
    // Which Splitwise group the file belongs to decides which learned
    // categories apply to it, so it is carried even by the outcomes that
    // parse nothing — the import screen shows and edits it either way.
    const splitwiseGroup = context.splitwiseGroup || splitwise.groupFromLabel(label);
    const inspected = splitwise.inspect(text);
    if (inspected.fileError) {
      return { source: splitwise.SOURCE, sourceLabel: LABELS.splitwise, splitwiseGroup, candidates: [], fileError: inspected.fileError, memberColumns: [] };
    }
    const known = context.splitwiseMyNames || [];
    const myName = inspected.memberColumns.find(m => known.includes(m)) || null;
    if (!myName) {
      return { source: splitwise.SOURCE, sourceLabel: LABELS.splitwise, splitwiseGroup, candidates: [], fileError: null, needsMemberSelection: true, memberColumns: inspected.memberColumns };
    }
    const result = splitwise.parse(text, myName);
    return { ...result, sourceLabel: LABELS.splitwise, splitwiseGroup };
  }

  const result = adapter.parse(text);
  return { ...result, sourceLabel: LABELS[adapter.SOURCE] || adapter.SOURCE };
}
