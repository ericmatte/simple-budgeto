import { parseText } from '../parsers/index.js';
import { buildPreview, mergeMatched, planMatches, toStoredTransaction } from '../matching/reconcile.js';

export function createStore() {
  const state = {
    // This is intentionally a session-only store. No folder is opened and no
    // CSV or JSON is read or written by the app.
    transactions: [],
    // One column name per Splitwise export the user has claimed as their own:
    // a friend CSV and a group CSV can spell the same person differently.
    splitwiseMyNames: [],
    pendingImport: null, // { items, fileReports, rawFiles }
  };
  const listeners = new Set();

  function notify() { for (const fn of listeners) fn(state); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function init() { notify(); }

  function startDemo(transactions) {
    state.demo = true;
    state.transactions = transactions;
    notify();
  }

  // --- import pipeline ---

  function runImport(files) {
    // files: [{ text, label, splitwiseGroup? }] — `splitwiseGroup` overrides
    // the guess made from the file name, so a re-export named differently can
    // be pointed at the group whose categories the budget already knows.
    const candidates = [];
    const fileReports = [];
    files.forEach((f, fileIndex) => {
      const result = parseText(f.text, f.label, {
        splitwiseMyNames: state.splitwiseMyNames,
        splitwiseGroup: f.splitwiseGroup,
      });
      const fileLines = String(f.text || '').split(/\r?\n/);
      // Every supported export with a header labels its date column. Headerless
      // statements (notably CIBC) deliberately get no faux header made from
      // their first transaction line.
      const rawHeader = fileLines.find(line => /\bdate\b/i.test(line)) || '';
      fileReports.push({
        fileIndex,
        label: f.label, source: result.source, sourceLabel: result.sourceLabel, fileError: result.fileError,
        needsMemberSelection: !!result.needsMemberSelection, memberColumns: result.memberColumns || [],
        splitwiseGroup: result.splitwiseGroup || null,
        count: result.candidates.length,
      });
      for (const c of result.candidates) {
        candidates.push({
          ...c,
          splitwiseGroup: result.splitwiseGroup || null,
          // Namespaced per file: the row index that seeds a candidate's hash
          // restarts at every file, so two files of the same format can hand
          // back the same id — and two preview rows sharing an id would move
          // as one under every edit, then collide again in storage.
          id: `f${fileIndex}-${c.id}`,
          sourceLabel: result.sourceLabel,
          fileIndex,
          fileLabel: f.label,
          rawLine: c.lineNo ? (fileLines[c.lineNo - 1] || '') : (c.raw || []).join(', '),
          rawHeader,
        });
      }
    });

    const active = state.transactions.filter(t => t.status !== 'deleted');
    const items = buildPreview(candidates, active);
    state.pendingImport = { items, fileReports, rawFiles: files };
    notify();
    return state.pendingImport;
  }

  // Adds rather than replaces: one import can carry several Splitwise exports
  // (one CSV per friend, one per group) and the same person shows up under a
  // different column name in each.
  function setSplitwiseMyName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed || state.splitwiseMyNames.includes(trimmed)) return;
    state.splitwiseMyNames = [...state.splitwiseMyNames, trimmed];
    notify();
  }

  function cancelImport() {
    state.pendingImport = null;
    notify();
  }

  function confirmImport() {
    if (!state.pendingImport) return;
    const batchId = 'batch' + Date.now().toString(36);
    const toAdd = [];
    let importedCount = 0;
    const keeping = state.pendingImport.items.filter(item => item.status !== 'error' && item.included);
    // Every pair is chosen before a single row is written: the closest pair
    // wins the row, whatever order the files list their lines in.
    const matches = planMatches(keeping, state.transactions);
    for (const item of keeping) {
      const match = matches.get(item);
      if (match) {
        const incoming = toStoredTransaction(item, batchId);
        state.transactions = state.transactions.map(t => t.id !== match.id ? t : mergeMatched(t, item, incoming));
        importedCount++;
        continue;
      }
      toAdd.push(toStoredTransaction(item, batchId));
      importedCount++;
    }
    state.transactions = [...state.transactions, ...toAdd];
    state.pendingImport = null;
    notify();
    return importedCount;
  }

  return {
    state, subscribe, init, startDemo,
    runImport, setSplitwiseMyName, cancelImport, confirmImport,
  };
}
