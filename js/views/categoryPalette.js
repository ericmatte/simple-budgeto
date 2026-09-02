import { escapeHtml } from '../lib/format.js';
import { resolveEmoji, resolveGroupEmoji, projectGroups, categoryGroupOf } from '../storage/config.js';
import { icon } from '../lib/icons.js';
import { openEmojiPicker, isEmojiPickerOpen } from '../lib/emojiPicker.js';

// One way to pick a category, everywhere.
//
// The dropdown this replaces was anchored to its row: in a table of six
// hundred lines it opened at a different place every time, as wide as
// whatever cell it hung off, and half of it fell off the bottom of the
// window. This opens in the same place at the same size no matter what asked
// for it, searches without caring about accents, and creates a category
// without handing the page over to a browser prompt().

let el = null;      // the overlay, mounted once and reused
let session = null; // the question currently on screen
let store = null;   // set once at boot; without it the rows are read-only

// The palette is opened from half a dozen views, all of which already hold the
// store — but renaming from inside it would mean threading four callbacks
// through every one of those call sites. It is handed the store once instead.
export function usePaletteStore(s) {
  store = s;
}

// Rows are rebuilt on every draw, so a rename made from inside the palette
// has to be read back from the store rather than from the config captured
// when it opened.
function liveConfig(fallback) {
  return store?.state?.config || fallback;
}

function mount() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'palette-overlay';
  el.hidden = true;
  el.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true">
      <div class="palette-title"></div>
      <input type="text" class="palette-search" autocomplete="off" spellcheck="false">
      <div class="palette-list" role="listbox"></div>
      <div class="palette-foot">
        <span><span class="kbd">↑↓</span> naviguer</span>
        <span><span class="kbd">↵</span> choisir</span>
        <span class="palette-foot-edit"><span class="kbd">${editChord()}</span> renommer</span>
        <span><span class="kbd">esc</span> fermer</span>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  el.addEventListener('mousedown', (e) => { if (e.target === el) closePalette(); });
  el.querySelector('.palette-search').addEventListener('input', () => {
    session.editing = null;
    session.index = firstSelectable(rowsFor(session));
    draw();
  });
  el.querySelector('.palette-list').addEventListener('click', (e) => {
    if (e.target.closest('[data-edit]')) { startEdit(Number(e.target.closest('[data-edit]').dataset.edit)); return; }
    if (e.target.closest('[data-edit-emoji]')) { pickEmoji(e.target.closest('[data-edit-emoji]')); return; }
    if (e.target.closest('[data-edit-save]')) { commitEdit(); return; }
    if (e.target.closest('[data-edit-cancel]')) { session.editing = null; draw(); return; }
    if (e.target.closest('.palette-item.editing')) return;
    const item = e.target.closest('.palette-item');
    if (item) choose(Number(item.dataset.i));
  });
  document.addEventListener('keydown', onKeydown);
  return el;
}

// The search box takes every letter key, so the shortcut that opens the
// rename row has to be a chord.
function editChord() {
  return navigator.platform?.startsWith('Mac') ? '⌘E' : 'ctrl E';
}

// `options`:
//   title        html shown above the search box
//   placeholder  search box placeholder
//   sections     [{ label, items: [{ value, label, emoji, hint, pinned }] }],
//                or a function returning that — use the function form when the
//                list can change under the palette (a rename made from inside)
//   createLabel  (query) => string | null — offers "+ create" when it returns one
//   onPick(value) / onCreate(query)
//   onRename(item, name) / onEmoji(item, emoji) — editing the row in place
export function openPalette(options) {
  mount();
  session = { ...options, index: 0, editing: null };
  el.querySelector('.palette').classList.toggle('has-edit', Boolean(options.onRename || options.onEmoji));
  el.querySelector('.palette-title').innerHTML = options.title || '';
  const search = el.querySelector('.palette-search');
  search.value = '';
  search.placeholder = options.placeholder || 'Chercher…';
  el.hidden = false;
  session.index = firstSelectable(rowsFor(session));
  draw();
  setTimeout(() => search.focus(), 0);
}

export function closePalette() {
  if (!el) return;
  el.hidden = true;
  session = null;
}

function query() {
  return el.querySelector('.palette-search').value.trim();
}

// Accent- and case-insensitive: "epic" has to find "Épicerie", or the search
// box is a trap for anybody typing quickly.
function fold(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function rowsFor(s) {
  const q = query();
  const rows = [];
  const sections = typeof s.sections === 'function' ? s.sections() : (s.sections || []);
  for (const section of sections) {
    const items = (section.items || []).filter(i => i.pinned || !q || fold(i.label).includes(fold(q)));
    if (!items.length) continue;
    rows.push({ heading: section.label });
    for (const item of items) rows.push({ ...item });
  }
  const createLabel = q && s.createLabel ? s.createLabel(q) : null;
  if (createLabel) {
    rows.push({ heading: 'Créer' });
    rows.push({ create: true, value: q, label: createLabel, emoji: icon('plus') });
  }
  return rows;
}

// A typed search must land on a real result, not on a pinned entry like
// "toutes les catégories" that no search ever filters out.
function firstSelectable(rows) {
  const at = rows.findIndex(r => !r.heading && (!query() || !r.pinned));
  return at === -1 ? rows.findIndex(r => !r.heading) : at;
}

function draw() {
  const rows = rowsFor(session);
  const list = el.querySelector('.palette-list');
  if (session.index >= rows.length || rows[session.index]?.heading) session.index = firstSelectable(rows);

  list.innerHTML = rows.map((r, i) => r.heading
    ? `<div class="palette-heading">${escapeHtml(r.heading)}</div>`
    : (isEditing(r) ? editRowHTML(r, i) : itemHTML(r, i))).join('')
    || '<div class="palette-heading">Aucun résultat</div>';
  list.querySelector('[data-on="1"]')?.scrollIntoView({ block: 'nearest' });
  session.rows = rows;
  const rename = list.querySelector('[data-edit-name]');
  if (rename) { rename.focus(); rename.select(); }
}

function itemHTML(r, i) {
  const on = i === session.index;
  return `<button type="button" class="palette-item ${r.create ? 'create' : ''}" data-i="${i}"
       role="option" aria-selected="${on}" data-on="${on ? 1 : 0}">
       <span class="palette-emoji">${r.emoji || '•'}</span>
       <span class="palette-label">${escapeHtml(r.label)}</span>
       ${r.hint ? `<span class="palette-hint">${escapeHtml(r.hint)}</span>` : ''}
       ${canEdit(r) ? `<span class="palette-edit" data-edit="${i}" title="Renommer · changer l'emoji">${icon('pencil', { size: 13 })}</span>` : ''}
       ${on ? '<span class="palette-enter">↵</span>' : ''}
     </button>`;
}

// The row turns into its own little form: the emoji is a button (it opens the
// same picker as the categories page) and the name an input. Nothing else on
// screen moves, so the list keeps its place.
function editRowHTML(r, i) {
  return `<div class="palette-item editing" data-i="${i}">
      ${session.onEmoji
        ? `<button type="button" class="palette-emoji palette-emoji-btn" data-edit-emoji title="Changer l'emoji">${r.emoji || '•'}</button>`
        : `<span class="palette-emoji">${r.emoji || '•'}</span>`}
      <input type="text" class="palette-rename" data-edit-name value="${escapeHtml(r.label)}"
        ${session.onRename ? '' : 'disabled'} autocomplete="off" spellcheck="false">
      ${session.onRename ? '<button type="button" class="btn btn-sm" data-edit-save>Enregistrer</button>' : ''}
      <button type="button" class="btn btn-ghost btn-sm" data-edit-cancel>Fermer</button>
    </div>`;
}

function canEdit(r) {
  return Boolean((session.onRename || session.onEmoji) && !r.create && !r.pinned && r.value);
}

function isEditing(r) {
  return session.editing != null && !r.create && r.value === session.editing;
}

function startEdit(i) {
  const row = (session.rows || [])[i];
  if (!row || !canEdit(row)) return;
  session.editing = row.value;
  draw();
}

function editedRow() {
  return (session.rows || []).find(r => isEditing(r));
}

async function pickEmoji(anchor) {
  const row = editedRow();
  if (!row) return;
  openEmojiPicker(anchor, {
    onSelect: async (emoji) => {
      await session.onEmoji(row, emoji);
      if (session) draw();
    },
  });
}

async function commitEdit() {
  const row = editedRow();
  const input = el.querySelector('[data-edit-name]');
  if (!row || !input) return;
  const name = input.value.trim();
  session.editing = null;
  if (name && name !== row.label) await session.onRename(row, name);
  if (session) draw();
}

function move(delta) {
  const rows = session.rows || [];
  let i = session.index;
  for (let step = 0; step < rows.length; step++) {
    i = Math.min(rows.length - 1, Math.max(0, i + delta));
    if (!rows[i]?.heading) break;
    if (i === 0 || i === rows.length - 1) break;
  }
  session.index = i;
  draw();
}

function choose(i) {
  const row = (session.rows || [])[i];
  if (!row || row.heading) return;
  const { onPick, onCreate } = session;
  if (row.create) {
    closePalette();
    onCreate?.(row.value);
    return;
  }
  closePalette();
  onPick?.(row.value);
}

function onKeydown(e) {
  if (!session || el.hidden) return;
  // The emoji picker handles its own keys, Escape included.
  if (isEmojiPickerOpen()) return;
  if (e.target.closest?.('.palette-item.editing')) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); session.editing = null; draw(); el.querySelector('.palette-search').focus(); }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); startEdit(session.index); return; }
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); choose(session.index); }
}

// --- the two questions the app actually asks -------------------------------

// Pick (or create) a category. `group` pins the group a newly created category
// lands in — a cluster filed under a trip already knows where it belongs, so
// it never asks the second question.
export function pickCategory({ config, title, group, clearLabel, onPick }) {
  openPalette({
    title,
    placeholder: 'Chercher ou créer une catégorie…',
    // A pinned way out, for the questions where "none" is a real answer.
    sections: () => {
      const sections = categorySections(liveConfig(config));
      return clearLabel
        ? [{ label: 'Aucune', items: [{ value: '', label: clearLabel, emoji: icon('minus'), pinned: true }] }, ...sections]
        : sections;
    },
    createLabel: (q) => categoryExists(liveConfig(config), q, group) ? null : `Créer « ${q} »`,
    onPick,
    onCreate: (name) => group
      ? onPick(name, { create: true, group })
      : pickGroupFor(liveConfig(config), name, onPick),
    // A category name is only unique inside its group, so the rename has to
    // say which of them is being renamed.
    ...(store ? {
      onRename: (row, name) => store.renameCategory(row.value, name, row.group),
      onEmoji: (row, emoji) => store.setCategoryEmoji(row.value, emoji),
    } : {}),
  });
}

function categoryExists(config, name, group) {
  const groups = config.categoryGroups || [];
  const scope = group ? groups.filter(g => g.name === group) : groups;
  return scope.some(g => g.subcategories.some(c => fold(c) === fold(name)));
}

// Same look, second question: a brand-new category has to land somewhere, and
// asking here beats the blocking prompt() this used to open.
function pickGroupFor(config, name, onPick) {
  openPalette({
    title: `Nouvelle catégorie <b>${escapeHtml(name)}</b>`,
    placeholder: 'Ranger dans quel groupe…',
    sections: [{
      label: 'Ranger dans quel groupe ?',
      items: (config.categoryGroups || []).map(g => ({
        value: g.name, label: g.name, emoji: groupEmojiHTML(config, g),
        hint: g.project ? 'projet' : '',
      })),
    }],
    onPick: (groupName) => onPick(name, { create: true, group: groupName }),
  });
}

// Pick (or create) the budget group a Splitwise group's rows are filed
// under — a trip or a project. Called a super-category in the code (see
// config.js `superCategory`); on screen it is simply a group, because that is
// what it becomes on the dashboard.
export function pickProject({ config, title, current, onPick }) {
  openPalette({
    title,
    placeholder: 'Chercher ou créer un groupe (projet, voyage…)',
    sections: () => [{
      label: 'Groupe du budget',
      items: [
        { value: '', label: 'Aucun — catégories courantes', emoji: icon('minus'), pinned: true },
        ...projectGroups(liveConfig(config)).map(g => ({
          value: g.name, label: g.name, emoji: groupEmojiHTML(liveConfig(config), g),
          hint: g.name === current ? 'actuelle' : '',
        })),
      ],
    }],
    createLabel: (q) => projectGroups(liveConfig(config)).some(g => fold(g.name) === fold(q)) ? null : `Créer « ${q} »`,
    onPick,
    onCreate: (name) => onPick(name),
    ...(store ? {
      onRename: (row, name) => store.renameCategoryGroup(row.value, name),
      onEmoji: (row, emoji) => store.setGroupEmoji(row.value, emoji),
    } : {}),
  });
}

// A group only has an emoji once someone picks one; until then it wears the
// mark that says what kind of group it is. Takes the group itself or just its
// name — callers often hold only the name a Splitwise group points at.
export function groupEmojiHTML(config, group, { size = 16 } = {}) {
  const name = typeof group === 'string' ? group : group.name;
  const def = typeof group === 'string'
    ? (config.categoryGroups || []).find(g => g.name === name) || { project: true }
    : group;
  return resolveGroupEmoji(config, name) || icon(def.project ? 'luggage' : 'folder', { size });
}

// The button that opens the category palette — the same control on every
// screen, so a category always reads the same way.
export function categoryTriggerHTML(value, config, { placeholder = 'Choisir…', attrs = '', group = null } = {}) {
  const home = value ? categoryGroupOf(config, value) : null;
  const elsewhere = group && home && group !== home;
  return `
    <button type="button" class="cat-trigger ${value ? '' : 'empty'}" ${attrs}>
      ${value ? `<span class="cat-trigger-emoji">${resolveEmoji(config, value)}</span>` : ''}
      <span class="cat-trigger-label">${escapeHtml(value || placeholder)}</span>
      ${elsewhere ? `<span class="cat-trigger-group">${escapeHtml(group)}</span>` : ''}
      <span class="cat-trigger-caret">▾</span>
    </button>
  `;
}

function categorySections(config) {
  return (config.categoryGroups || [])
    .filter(g => g.subcategories.length)
    .map(g => ({
      label: g.project ? `${g.name} · projet` : g.name,
      items: g.subcategories.map(c => ({ value: c, label: c, group: g.name, emoji: resolveEmoji(config, c) })),
    }));
}
