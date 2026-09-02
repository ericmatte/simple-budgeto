import { escapeHtml, plural } from '../lib/format.js';
import { resolveEmoji, PROTECTED_GROUPS, groupOf, slotKey, splitwiseGroupConfig } from '../storage/config.js';
import { pickProject, pickCategory, groupEmojiHTML } from './categoryPalette.js';
import { openEmojiPicker, closeEmojiPicker } from '../lib/emojiPicker.js';
import { openInlineEdit, closeInlineEdit } from '../lib/inlineEdit.js';
import { confirmDialog, deleteGroupMessage, deleteCategoryMessage } from '../lib/confirmDialog.js';
import { icon } from '../lib/icons.js';

// Manages the shape of the budget itself — which groups exist, which
// categories live in them — rather than the money in it. Ordering stays a
// drag-and-drop gesture on the dashboard, where the numbers that justify an
// order are visible; this page is for adding, renaming and removing.
export function createCategoriesView(store) {
  let newGroupOpen = false;
  let addingTo = null; // group name whose "new category" field is open

  function render(container) {
    closeEmojiPicker();
    closeInlineEdit();
    const { config, transactions } = store.state;
    const groups = config.categoryGroups || [];
    const usage = countByCategory(transactions, config);

    container.innerHTML = `
      <div class="card" style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
          <div>
            <div style="font-size:18px; font-weight:800;">Catégories</div>
            <div style="font-size:13px; color:var(--sub); font-weight:600; margin-top:3px;">
              ${plural(groups.length, 'groupe')} · ${plural(groups.reduce((a, g) => a + g.subcategories.length, 0), 'catégorie')}.
              L'ordre se change en glissant les lignes du tableau de bord.
            </div>
          </div>
          ${newGroupOpen ? '' : `<button class="btn btn-chip btn-sm btn-icon" data-action="new-group">${icon('plus', { size: 14 })}Nouveau groupe</button>`}
        </div>

        ${newGroupOpen ? `
          <div class="cat-admin-new">
            <input type="text" id="new-group-name" placeholder="Nom du groupe (ex. Animaux)" autocomplete="off">
            <button class="btn btn-primary btn-sm" data-action="create-group">Créer</button>
            <button class="btn btn-ghost btn-sm" data-action="cancel-group">Annuler</button>
          </div>
        ` : ''}

        <div style="display:flex; flex-direction:column; gap:14px;">
          ${groups.map(g => renderGroup(g, config, usage, groups)).join('')}
        </div>
      </div>

      ${renderLearned(config, transactions)}
    `;

    wireEvents(container);
  }

  // What the app has been told, in the one place it can be taken back.
  // Without this the answers given during an import would be invisible and
  // permanent — and the trip a Splitwise group belongs to could only be set
  // while an import happened to be open.
  // Every Splitwise category this group has ever brought in, answered or not,
  // so an unanswered one can be set up from here rather than staying invisible
  // until the next import surfaces it.
  function splitwiseCategoriesSeen(group, settings, transactions) {
    const seen = transactions.filter(t => t.swGroup === group && t.swCategory).map(t => t.swCategory);
    const answered = Object.keys(settings.categoryMap || {});
    return [...new Set([...seen, ...answered])].sort((a, b) => a.localeCompare(b));
  }

  function renderLearned(config, transactions) {
    // Every Splitwise group the budget has ever seen, not only those with a
    // saved answer: a group whose rows are all still unclassified has nothing
    // in the config yet, and is exactly the one worth pointing at a trip.
    const names = [...new Set([
      ...Object.keys(config.splitwiseGroups || {}),
      ...transactions.map(t => t.swGroup).filter(Boolean),
    ])].sort();
    const groups = names.map(n => [n, splitwiseGroupConfig(config, n)]);
    const merchants = Object.entries(config.merchantRules || {}).sort((a, b) => a[0].localeCompare(b[0]));
    if (!groups.length && !merchants.length) return '';

    return `
      <div class="card" style="display:flex; flex-direction:column; gap:16px; margin-top:18px;">
        <div>
          <div style="font-size:18px; font-weight:800;">Ce que l'app a appris</div>
          <div style="font-size:13px; color:var(--sub); font-weight:600; margin-top:3px;">
            Ces réponses évitent qu'une question déjà posée revienne au prochain import. Oublier une règle
            ne touche à aucune transaction déjà classée.
          </div>
        </div>

        ${groups.map(([group, settings]) => `
          <div class="cat-admin-group">
            <div class="cat-admin-group-head">
              <span class="cat-admin-title">${icon('handshake', { size: 14, className: 'icon-lead' })}${escapeHtml(group)}</span>
              <span class="cat-admin-count">${plural(Object.keys(settings.categoryMap || {}).length, 'correspondance')}</span>
              <span style="flex:1;"></span>
              <div style="width:230px;">
                <button class="cat-trigger ${settings.superCategory ? '' : 'empty'}" data-action="pick-super" data-group="${escapeHtml(group)}">
                  ${settings.superCategory ? `<span class="cat-trigger-emoji">${groupEmojiHTML(config, settings.superCategory, { size: 14 })}</span>` : ''}
                  <span class="cat-trigger-label">${escapeHtml(settings.superCategory || 'Aucun groupe')}</span>
                  <span class="cat-trigger-caret">${icon('chevronDown', { size: 13 })}</span>
                </button>
              </div>
            </div>
            ${splitwiseCategoriesSeen(group, settings, transactions).map(from => {
              const to = (settings.categoryMap || {})[from];
              return `
                <div class="cat-admin-row">
                  <span class="cat-admin-title">${escapeHtml(from)}</span>
                  <span class="map-arrow">${icon('arrowRight', { size: 13 })}</span>
                  <span class="cat-admin-title ${to ? '' : 'unset'}">${to
                    ? `${resolveEmoji(config, to)} ${escapeHtml(to)}`
                    : 'à classer'}</span>
                  <span style="flex:1;"></span>
                  <button class="icon-btn" data-action="map-splitwise" data-group="${escapeHtml(group)}" data-from="${escapeHtml(from)}"
                    title="Choisir la catégorie de « ${escapeHtml(from)} »">${icon('pencil', { size: 14 })}</button>
                </div>
              `;
            }).join('') || '<div class="cat-admin-empty">Aucune catégorie vue dans ce groupe pour l\'instant.</div>'}
          </div>
        `).join('')}

        ${merchants.length ? `
          <div class="cat-admin-group">
            <div class="cat-admin-group-head">
              <span class="cat-admin-title">${icon('store', { size: 14, className: 'icon-lead' })}Marchands</span>
              <span class="cat-admin-count">${plural(merchants.length, 'règle')}</span>
            </div>
            ${merchants.map(([key, to]) => `
              <div class="cat-admin-row">
                <span class="cat-admin-title">${escapeHtml(key)}</span>
                <span class="map-arrow">${icon('arrowRight', { size: 13 })}</span>
                <span class="cat-admin-title">${resolveEmoji(config, to)} ${escapeHtml(to)}</span>
                <span style="flex:1;"></span>
                <button class="map-forget" data-action="forget-merchant" data-key="${escapeHtml(key)}">oublier</button>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  // Counted per (group, category): the same name in two groups is two lines
  // of the budget, and showing one of them the other's total would be a lie
  // right next to a delete button.
  function countByCategory(transactions, config) {
    const out = {};
    for (const t of transactions) {
      if (t.status === 'deleted' || t.kind === 'planifie') continue;
      const key = slotKey(groupOf(config, t), t.category);
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }

  function renderGroup(group, config, usage, allGroups) {
    const locked = PROTECTED_GROUPS.includes(group.name);
    return `
      <div class="cat-admin-group">
        <div class="cat-admin-group-head">
          <span class="tbl-emoji-btn" data-group-emoji-edit="${escapeHtml(group.name)}" title="Changer l'emoji">${groupEmojiHTML(config, group)}</span>
          <span class="cat-admin-title" data-rename-type="group" data-name="${escapeHtml(group.name)}" title="Cliquer pour renommer">${escapeHtml(group.name)}</span>
          ${locked ? '<span class="badge" title="Ce groupe est utilisé par le tableau de bord">requis</span>' : ''}
          ${group.project ? `<span class="badge" title="Projet ou voyage — alimenté par un groupe Splitwise">${icon('luggage', { size: 11 })}projet</span>` : ''}
          <span class="cat-admin-count">${group.subcategories.length}</span>
          <span style="flex:1;"></span>
          <button class="btn btn-ghost btn-sm btn-icon" data-action="add-category" data-group="${escapeHtml(group.name)}">${icon('plus', { size: 13 })}Catégorie</button>
          ${locked ? '' : `<button class="icon-btn" data-action="delete-group" data-group="${escapeHtml(group.name)}" title="Supprimer le groupe">${icon('trash', { size: 15 })}</button>`}
        </div>

        ${addingTo === group.name ? `
          <div class="cat-admin-new">
            <input type="text" id="new-category-name" placeholder="Nom de la catégorie" autocomplete="off">
            <button class="btn btn-primary btn-sm" data-action="create-category" data-group="${escapeHtml(group.name)}">Ajouter</button>
            <button class="btn btn-ghost btn-sm" data-action="cancel-category">Annuler</button>
          </div>
        ` : ''}

        ${group.subcategories.length === 0 && addingTo !== group.name
          ? '<div class="cat-admin-empty">Aucune catégorie dans ce groupe.</div>'
          : group.subcategories.map(name => renderCategory(name, group, config, usage, allGroups)).join('')}
      </div>
    `;
  }

  function renderCategory(name, group, config, usage, allGroups) {
    const count = usage[slotKey(group.name, name)] || 0;
    return `
      <div class="cat-admin-row">
        <span class="tbl-emoji-btn" data-emoji-edit="${escapeHtml(name)}" title="Changer l'emoji">${resolveEmoji(config, name)}</span>
        <span class="cat-admin-title" data-rename-type="category" data-name="${escapeHtml(name)}" data-group="${escapeHtml(group.name)}" title="Cliquer pour renommer">${escapeHtml(name)}</span>
        <span class="cat-admin-count">${count ? `${count} transaction${count > 1 ? 's' : ''}` : 'inutilisée'}</span>
        <span style="flex:1;"></span>
        <select class="cat-admin-move" data-move-category="${escapeHtml(name)}" data-group="${escapeHtml(group.name)}" title="Déplacer vers un autre groupe">
          ${allGroups.map(g => `<option value="${escapeHtml(g.name)}" ${g.name === group.name ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
        <button class="icon-btn" data-action="delete-category" data-name="${escapeHtml(name)}" data-group="${escapeHtml(group.name)}" data-count="${count}" title="Supprimer la catégorie">${icon('trash', { size: 15 })}</button>
      </div>
    `;
  }

  function editTitle(span) {
    const { renameType: type, name } = span.dataset;
    const host = span.parentElement;
    const box = span.getBoundingClientRect();
    openInlineEdit(host, { left: box.left - 4, top: box.top - 3, width: Math.max(140, box.width + 40), height: box.height + 6 }, {
      value: name,
      className: 'inline-rename',
      onCommit: async (raw) => {
        const val = raw.trim();
        if (!val || val === name) return;
        if (type === 'group') await store.renameCategoryGroup(name, val);
        else await store.renameCategory(name, val, span.dataset.group);
      },
    });
  }

  function wireEvents(container) {
    container.querySelectorAll('[data-rename-type]').forEach(span => {
      span.addEventListener('click', () => editTitle(span));
    });

    container.querySelectorAll('[data-emoji-edit]').forEach(span => {
      span.addEventListener('click', () => {
        const name = span.dataset.emojiEdit;
        openEmojiPicker(span, { onSelect: (emoji) => store.setCategoryEmoji(name, emoji) });
      });
    });
    container.querySelectorAll('[data-group-emoji-edit]').forEach(span => {
      span.addEventListener('click', () => {
        const name = span.dataset.groupEmojiEdit;
        openEmojiPicker(span, { onSelect: (emoji) => store.setGroupEmoji(name, emoji) });
      });
    });

    container.querySelectorAll('[data-move-category]').forEach(select => {
      select.addEventListener('change', () => {
        store.moveCategory(select.dataset.moveCategory, select.value, null, select.dataset.group);
      });
    });

    for (const input of container.querySelectorAll('#new-group-name, #new-category-name')) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.id === 'new-group-name' ? createGroup(container) : createCategory(container); }
        if (e.key === 'Escape') { newGroupOpen = false; addingTo = null; render(container); }
      });
      input.focus();
    }

    // Guarded like the other views: `render(container)` is called directly on
    // this same node whenever a field opens or closes, so an unguarded
    // delegated listener would fire once per render that has ever happened.
    if (container.__catAdminWired) return;
    container.__catAdminWired = true;

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'new-group') { newGroupOpen = true; render(container); }
      else if (action === 'cancel-group') { newGroupOpen = false; render(container); }
      else if (action === 'create-group') createGroup(container);
      else if (action === 'pick-super') {
        const group = btn.dataset.group;
        pickProject({
          config: store.state.config,
          current: splitwiseGroupConfig(store.state.config, group).superCategory,
          title: `Groupe du budget pour l'export Splitwise <b>${escapeHtml(group)}</b>`,
          onPick: (name) => store.setSplitwiseSuperCategory(group, name || null),
        });
      }
      else if (action === 'map-splitwise') {
        const { group, from } = btn.dataset;
        const current = splitwiseGroupConfig(store.state.config, group).categoryMap[from];
        pickCategory({
          config: store.state.config,
          group: splitwiseGroupConfig(store.state.config, group).superCategory || null,
          title: `<b>${escapeHtml(from)}</b> — catégorie Splitwise du groupe « ${escapeHtml(group)} »`,
          clearLabel: current ? 'Ne pas associer — laisser à classer' : null,
          onPick: async (name, created) => {
            if (created) await store.addManualCategory(name, created.group);
            await store.mapSplitwiseCategory(group, from, name || null);
          },
        });
      }
      else if (action === 'forget-merchant') store.forgetMerchantRule(btn.dataset.key);
      else if (action === 'add-category') { addingTo = btn.dataset.group; render(container); }
      else if (action === 'cancel-category') { addingTo = null; render(container); }
      else if (action === 'create-category') createCategory(container);
      else if (action === 'delete-group') {
        const name = btn.dataset.group;
        const group = (store.state.config.categoryGroups || []).find(g => g.name === name);
        confirmDialog(deleteGroupMessage(name, group ? group.subcategories.length : 0))
          .then(yes => yes && store.deleteCategoryGroup(name));
      } else if (action === 'delete-category') {
        const { name, group } = btn.dataset;
        confirmDialog(deleteCategoryMessage(name, Number(btn.dataset.count)))
          .then(yes => yes && store.deleteCategory(name, group));
      }
    });
  }

  async function createGroup(container) {
    const input = container.querySelector('#new-group-name');
    const name = input?.value.trim();
    if (!name) return;
    newGroupOpen = false;
    await store.addCategoryGroup(name);
    render(container);
  }

  async function createCategory(container) {
    const input = container.querySelector('#new-category-name');
    const name = input?.value.trim();
    const group = addingTo;
    if (!name || !group) return;
    addingTo = null;
    await store.addManualCategory(name, group);
    render(container);
  }

  return { render };
}
