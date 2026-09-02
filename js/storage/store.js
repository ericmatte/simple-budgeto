import {
  decodeConfig, addCategory as addCategoryToConfig,
  reorderCategoryGroups as reorderCategoryGroupsInConfig,
  moveCategory as moveCategoryInConfig,
  renameCategoryGroup as renameCategoryGroupInConfig,
  renameCategory as renameCategoryInConfig,
  setCategoryEmoji as setCategoryEmojiInConfig,
  setGroupEmoji as setGroupEmojiInConfig,
  addCategoryGroup as addCategoryGroupInConfig,
  addProjectGroup as addProjectGroupInConfig,
  deleteCategoryGroup as deleteCategoryGroupInConfig,
  deleteCategory as deleteCategoryInConfig,
  setSplitwiseSuperCategory as setSplitwiseSuperCategoryInConfig,
  setSplitwiseCategory as setSplitwiseCategoryInConfig,
  setMerchantRule as setMerchantRuleInConfig,
  categoryGroupOf, groupOf, PROTECTED_GROUPS,
} from './config.js';
import { toast } from '../lib/toast.js';
import { clampWindowEnd, isBeforeBudgetStart } from '../lib/budgetStart.js';
import { ymLabel, plural } from '../lib/format.js';
import { parseText } from '../parsers/index.js';
import { commonMembers } from '../parsers/splitwise.js';
import { buildPreview, mergeMatched, planMatches, toStoredTransaction } from '../matching/reconcile.js';
import { stableHash } from '../lib/normalize.js';

export function createStore() {
  const state = {
    // This is intentionally a session-only store. No folder is opened and no
    // CSV or JSON is read or written by the app.
    supported: true,
    loading: false,
    transactions: [],
    config: decodeConfig(''),
    view: 'transactions',
    pendingImport: null, // { items, fileReports }
    // What the last confirmed import set aside, waiting to be confirmed in
    // bulk on the "à classer" screen. Deliberately in memory only: these rows
    // were not kept, and storing thousands of them — most of them copies of
    // rows already in the budget — to support one review would be a poor
    // trade. Losing the review costs nothing; the rows stay out either way.
    asideReview: null, // { groups: [{ key, label, why, items }] }
  };
  const listeners = new Set();

  function notify() { for (const fn of listeners) fn(state); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  async function persistTransactions() {}
  async function persistConfig() {}
  function init() { notify(); }

  function setView(view) { state.view = view; notify(); }

  function startDemo(transactions) {
    state.demo = true;
    state.transactions = transactions;
    state.config = decodeConfig('');
    state.loading = false;
    notify();
  }

  // --- import pipeline ---

  // Every name the user has claimed as their own across Splitwise exports.
  // `myName` is what older configs (and the app before multi-file imports)
  // wrote, so it still counts as one of them.
  function splitwiseMyNames() {
    const { myName, myNames } = state.config.splitwise || {};
    return [...new Set([...(myNames || []), ...(myName ? [myName] : [])])];
  }

  function runImport(files) {
    // files: [{ text, label, splitwiseGroup? }] — `splitwiseGroup` overrides
    // the guess made from the file name, so a re-export named differently can
    // be pointed at the group whose categories the budget already knows.
    const candidates = [];
    const fileReports = [];
    files.forEach((f, fileIndex) => {
      const result = parseText(f.text, f.label, {
        splitwiseMyNames: splitwiseMyNames(),
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
    const items = buildPreview(candidates, active, state.config);
    state.pendingImport = { items, fileReports, rawFiles: files };
    notify();
    return state.pendingImport;
  }

  function setSplitwiseMyName(name) {
    setSplitwiseMyNames([name]);
  }

  // Adds rather than replaces: one import can carry several Splitwise exports
  // (one CSV per friend, one per group) and the same person shows up under a
  // different column name in each.
  function setSplitwiseMyNames(names, { silent = false } = {}) {
    const added = (names || []).map(n => String(n || '').trim()).filter(Boolean);
    if (!added.length) return;
    const myNames = [...new Set([...splitwiseMyNames(), ...added])];
    state.config = {
      ...state.config,
      splitwise: { ...state.config.splitwise, myNames, myName: added[added.length - 1] },
    };
    if (!silent) notify();
  }

  async function setDashboardWindow(winEnd) {
    state.config = { ...state.config, winEnd: clampWindowEnd(winEnd, state.config.startMonth) };
    await persistConfig();
    notify();
  }

  // The first month this budget covers. Existing rows are left on disk rather
  // than deleted — the limit only hides them, so raising and then lowering it
  // brings the same history back instead of destroying it.
  async function setStartMonth(startMonth) {
    const month = startMonth || null;
    if (month === (state.config.startMonth || null)) return;
    const hidden = state.transactions.filter(t => isBeforeBudgetStart(t, month)).length;
    state.config = { ...state.config, startMonth: month, winEnd: clampWindowEnd(state.config.winEnd, month) };
    await persistConfig();
    notify();
    if (!month) toast('Aucune limite de date — tout l\'historique est affiché');
    else if (hidden) toast(`${plural(hidden, 'transaction')} antérieure${hidden >= 2 ? 's' : ''} à ${ymLabel(month)} ${hidden >= 2 ? 'sont' : 'est'} maintenant masquée${hidden >= 2 ? 's' : ''}`);
  }

  function updatePendingItem(id, patch, options) {
    updatePendingItems([id], patch, options);
  }

  // `silent` skips the re-render: the importer patches the handful of cells a
  // tick affects itself, and rebuilding several hundred preview rows on every
  // checkbox would flash the table and steal the focus back.
  function updatePendingItems(ids, patch, { silent = false } = {}) {
    if (!state.pendingImport) return;
    const idSet = new Set(ids);
    state.pendingImport.items = state.pendingImport.items.map(it => idSet.has(it.id) ? { ...it, ...patch } : it);
    if (!silent) notify();
  }

  function cancelImport() {
    state.pendingImport = null;
    notify();
  }

  async function confirmImport() {
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
    const sources = [...new Set(state.pendingImport.fileReports.map(r => r.sourceLabel).filter(Boolean))];
    state.transactions = [...state.transactions, ...toAdd];
    state.asideReview = null;
    state.pendingImport = null;
    state.config = {
      ...state.config,
      lastImportAt: new Date().toISOString(),
      lastImportCount: importedCount,
      lastImportSources: sources,
    };
    await persistTransactions();
    notify();
    return importedCount;
  }

  // "Yes, those were right to leave out" — the whole group at once.
  function dismissAside(key) {
    if (!state.asideReview) return;
    const groups = state.asideReview.groups.filter(g => g.key !== key);
    state.asideReview = groups.length ? { groups } : null;
    notify();
  }

  // "Actually, import them after all" — the same, the other way.
  async function importAside(key) {
    const group = state.asideReview?.groups.find(g => g.key === key);
    if (!group) return 0;
    const batchId = 'batch' + Date.now().toString(36);
    const toAdd = group.items.filter(i => i.status !== 'error').map(i => toStoredTransaction(i, batchId));
    state.transactions = [...state.transactions, ...toAdd];
    dismissAside(key);
    await persistTransactions();
    notify();
    return toAdd.length;
  }

  // --- transaction editing ---

  async function updateTransaction(id, patch) {
    state.transactions = state.transactions.map(t => t.id === id ? { ...t, ...patch } : t);
    await persistTransactions();
    notify();
  }

  async function deleteTransaction(id) {
    state.transactions = state.transactions.filter(t => t.id !== id);
    await persistTransactions();
    notify();
  }

  async function updateTransactions(ids, patch) {
    const idSet = new Set(ids);
    state.transactions = state.transactions.map(t => idSet.has(t.id) ? { ...t, ...patch } : t);
    await persistTransactions();
    notify();
  }

  async function deleteTransactions(ids) {
    const idSet = new Set(ids);
    state.transactions = state.transactions.filter(t => !idSet.has(t.id));
    await persistTransactions();
    notify();
  }

  async function addManualCategory(name, groupName) {
    state.config = addCategoryToConfig(state.config, name, groupName);
    await persistConfig();
    notify();
    return name;
  }

  async function reorderCategoryGroups(orderedNames) {
    state.config = reorderCategoryGroupsInConfig(state.config, orderedNames);
    await persistConfig();
    notify();
  }

  // Moving a category between groups moves the rows filed under it too, or
  // the money would stay behind in a group the category has just left.
  async function moveCategory(categoryName, targetGroupName, beforeName, fromGroup) {
    const source = fromGroup || categoryGroupOf(state.config, categoryName);
    const affected = new Set(state.transactions
      .filter(t => t.category === categoryName && groupOf(state.config, t) === source)
      .map(t => t.id));
    state.config = moveCategoryInConfig(state.config, categoryName, targetGroupName, beforeName, source);
    state.transactions = state.transactions.map(t =>
      affected.has(t.id) ? { ...t, group: targetGroupName } : t);
    await persistTransactions();
    notify();
  }

  // Every one of these used to fail silently when the config layer refused
  // the change (a name already taken, a protected group): the click simply
  // did nothing and the user was left guessing.
  async function renameCategoryGroup(oldName, newName) {
    const trimmed = String(newName || '').trim();
    if (!trimmed || trimmed === oldName) return;
    if ((state.config.categoryGroups || []).some(g => g.name === trimmed)) {
      toast(`Un groupe s'appelle déjà « ${trimmed} »`);
      return;
    }
    state.config = renameCategoryGroupInConfig(state.config, oldName, trimmed);
    await persistConfig();
    notify();
  }

  // Scoped to one group, like the config layer: renaming the "Restaurants" of
  // a trip must not touch the everyday one, so only the rows filed under that
  // exact group are repointed.
  async function renameCategory(oldName, newName, groupName) {
    const trimmed = String(newName || '').trim();
    if (!trimmed || trimmed === oldName) return;
    const group = groupName || categoryGroupOf(state.config, oldName);
    const merged = (state.config.categoryGroups || [])
      .find(g => g.name === group)?.subcategories.includes(trimmed);
    // Which rows are affected has to be decided against the config as it still
    // stands — once the rename lands, `oldName` no longer resolves to a group.
    const affected = new Set(state.transactions
      .filter(t => t.category === oldName && groupOf(state.config, t) === group)
      .map(t => t.id));
    state.config = renameCategoryInConfig(state.config, oldName, trimmed, group);
    state.transactions = state.transactions.map(t =>
      affected.has(t.id) ? { ...t, category: trimmed } : t);
    await persistTransactions(); // writes the config alongside it
    notify();
    if (merged) toast(`« ${oldName} » a été fusionnée avec « ${trimmed} »`);
  }

  async function setCategoryEmoji(name, emoji) {
    const next = setCategoryEmojiInConfig(state.config, name, emoji);
    if (next === state.config) {
      toast('Emoji invalide — rien n\'a été changé');
      return;
    }
    state.config = next;
    await persistConfig();
    notify();
  }

  async function setGroupEmoji(name, emoji) {
    const next = setGroupEmojiInConfig(state.config, name, emoji);
    if (next === state.config) {
      toast('Emoji invalide — rien n\'a été changé');
      return;
    }
    state.config = next;
    await persistConfig();
    notify();
  }

  async function addCategoryGroup(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const next = addCategoryGroupInConfig(state.config, trimmed);
    if (next === state.config) {
      toast(`Un groupe s'appelle déjà « ${trimmed} »`);
      return;
    }
    state.config = next;
    await persistConfig();
    notify();
  }

  async function deleteCategoryGroup(name) {
    if (PROTECTED_GROUPS.includes(name)) {
      toast(`« ${name} » ne peut pas être supprimé`);
      return;
    }
    state.config = deleteCategoryGroupInConfig(state.config, name);
    await persistConfig();
    notify();
  }

  // The transactions filed under a deleted category are kept and re-filed
  // under "Non classé" — losing a category must never mean losing money.
  // Its planned amounts go, though: a budget for a category that no longer
  // exists would keep inflating the "planifié" totals forever.
  async function deleteCategory(name, groupName) {
    const group = groupName || categoryGroupOf(state.config, name);
    const affected = new Set(state.transactions
      .filter(t => t.category === name && groupOf(state.config, t) === group)
      .map(t => t.id));
    state.config = deleteCategoryInConfig(state.config, name, group);
    state.transactions = state.transactions
      .filter(t => !(t.kind === 'planifie' && affected.has(t.id)))
      .map(t => affected.has(t.id) ? { ...t, category: 'Non classé', group: '' } : t);
    await persistTransactions(); // writes the config alongside it
    notify();
  }

  // --- ce que l'app apprend --------------------------------------------------

  // Files a whole cluster at once and, unless asked not to, remembers the
  // answer: the same merchant or the same Splitwise category never has to be
  // decided twice. `cluster` comes from matching/clusters.js.
  async function classifyCluster(cluster, category, options) {
    return classifyClusters([{ cluster, category }], options);
  }

  // Batched: accepting a whole batch of Splitwise suggestions at once must
  // write the file and repaint the screen once, not once per category.
  async function classifyClusters(entries, { remember = true } = {}) {
    let config = state.config;
    const patch = new Map(); // id -> { category, group }
    let count = 0;

    for (const { cluster, category } of entries) {
      const trimmed = String(category || '').trim();
      if (!trimmed || !cluster) continue;
      if (remember) {
        config = cluster.kind === 'splitwise'
          ? setSplitwiseCategoryInConfig(config, cluster.splitwiseGroup, cluster.splitwiseCategory, trimmed)
          : setMerchantRuleInConfig(config, cluster.merchantKey, trimmed);
      }
      // A cluster from a Splitwise group filed under a trip carries its rows
      // into that trip's section, and the trip has to hold the category.
      const group = cluster.superCategory || categoryGroupOf(config, trimmed) || 'Non classé';
      if (cluster.superCategory) config = addCategoryToConfig(config, trimmed, cluster.superCategory);
      for (const id of cluster.ids) patch.set(id, { category: trimmed, group });
      count += cluster.ids.length;
    }
    if (!patch.size) return 0;

    state.config = config;
    state.transactions = state.transactions.map(t => patch.has(t.id) ? { ...t, ...patch.get(t.id) } : t);
    await persistTransactions();
    notify();
    return count;
  }

  // Undoing a decision has to undo the rule with it, or the next import would
  // silently re-apply the answer the user just took back.
  async function unclassifyCluster(cluster) {
    if (!cluster) return;
    state.config = cluster.kind === 'splitwise'
      ? setSplitwiseCategoryInConfig(state.config, cluster.splitwiseGroup, cluster.splitwiseCategory, null)
      : setMerchantRuleInConfig(state.config, cluster.merchantKey, null);
    const ids = new Set(cluster.ids);
    state.transactions = state.transactions.map(t =>
      ids.has(t.id) ? { ...t, category: 'Non classé', group: '' } : t);
    await persistTransactions();
    notify();
  }

  // The trip or project a Splitwise group's rows belong to. Every row already
  // imported from that group moves with it — the answer is about the group,
  // not about one import.
  async function setSplitwiseSuperCategory(group, superCategory) {
    if (!group) return;
    const moving = state.transactions.filter(t => t.kind === 'reel' && t.swGroup === group);
    let config = setSplitwiseSuperCategoryInConfig(state.config, group, superCategory);
    if (superCategory) {
      config = addProjectGroupInConfig(config, superCategory);
      // The project group has to hold the categories its rows are filed under,
      // or the dashboard would show a section with nothing to put in it.
      for (const name of new Set(moving.map(t => t.category))) {
        if (name && name !== 'Non classé') config = addCategoryToConfig(config, name, superCategory);
      }
    }
    state.config = config;
    const ids = new Set(moving.map(t => t.id));
    state.transactions = state.transactions.map(t =>
      ids.has(t.id) ? { ...t, group: superCategory || '' } : t);
    await persistTransactions();
    notify();
  }

  // Answers "what is this Splitwise category, in my budget?" — or takes the
  // answer back when `category` is empty.
  async function mapSplitwiseCategory(group, splitwiseCategory, category) {
    state.config = setSplitwiseCategoryInConfig(state.config, group, splitwiseCategory, category || null);
    await persistConfig();
    notify();
  }

  async function forgetSplitwiseCategory(group, splitwiseCategory) {
    return mapSplitwiseCategory(group, splitwiseCategory, null);
  }

  async function forgetMerchantRule(key) {
    state.config = setMerchantRuleInConfig(state.config, key, null);
    await persistConfig();
    notify();
  }

  // Sets (or clears, when amount is null/0) one or more per-cell planned-budget
  // overrides typed directly into the 12-month table — each targets one exact
  // category+month (freq 'exact'), independent of that category's recurring
  // plans. Batched into a single persist/notify so a multi-cell drag-fill
  // doesn't re-render the app once per cell.
  async function setPlannedCells(entries) {
    let txs = state.transactions;
    for (const { group, category, month, amount } of entries) {
      // Addressed by the (group, category) pair: two categories sharing a
      // name are two lines of the budget and must not overwrite each other.
      const belongs = (t) => t.kind === 'planifie' && t.freq === 'exact'
        && t.category === category && t.month === month
        && groupOf(state.config, t) === (group || groupOf(state.config, { category, group: '' }));
      const existing = txs.find(belongs);
      if (amount == null || amount === 0) {
        if (existing) txs = txs.filter(t => t.id !== existing.id);
      } else if (existing) {
        txs = txs.map(t => t.id === existing.id ? { ...t, amount: Math.abs(amount) } : t);
      } else {
        txs = [...txs, {
          id: 'plan_' + stableHash(group || '', category, month), dedupeKey: '', kind: 'planifie', date: '',
          description: category, amount: Math.abs(amount), category, group: group || '',
          freq: 'exact', month, note: '', sources: [], linkedId: null, importBatchId: null, status: 'active',
        }];
      }
    }
    state.transactions = txs;
    await persistTransactions();
    notify();
  }

  // `group` is optional: without it the budget lands on the category's home
  // group, which is where a category that isn't part of a project lives.
  async function setPlannedCell(category, month, amount, group) {
    return setPlannedCells([{ category, month, amount, group }]);
  }

  return {
    state, subscribe, init,
    setView,
    runImport, setSplitwiseMyName, setSplitwiseMyNames, setDashboardWindow, setStartMonth,
    updatePendingItem, updatePendingItems, cancelImport, confirmImport,
    updateTransaction, deleteTransaction, updateTransactions, deleteTransactions, addManualCategory,
    reorderCategoryGroups, moveCategory, renameCategoryGroup, renameCategory, setCategoryEmoji, setGroupEmoji,
    addCategoryGroup, deleteCategoryGroup, deleteCategory, startDemo,
    setPlannedCell, setPlannedCells,
    classifyCluster, classifyClusters, unclassifyCluster, setSplitwiseSuperCategory,
    dismissAside, importAside,
    mapSplitwiseCategory, forgetSplitwiseCategory, forgetMerchantRule,
  };
}
