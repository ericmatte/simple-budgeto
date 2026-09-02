import { escapeHtml, money, plural, shortDate } from '../lib/format.js';
import { resolveEmoji } from '../storage/config.js';
import { buildClusters } from '../matching/clusters.js';
import { asideLabel } from '../matching/reconcile.js';
import { sourceLogoHTML } from '../lib/sourceLogos.js';
import { pickCategory, groupEmojiHTML } from './categoryPalette.js';
import { toast } from '../lib/toast.js';
import { icon } from '../lib/icons.js';

// Where the import stopped asking questions.
//
// Everything lands in the budget first; what nobody has decided yet waits
// here, grouped into the decisions that settle it — one merchant, one
// Splitwise category — biggest amount first, so stopping halfway leaves the
// small change behind rather than the rent. Each answer is remembered, so the
// list gets shorter every month instead of starting over.

export function createInboxView(store) {
  let cursor = 0;
  let recent = [];   // clusters classified in this sitting, newest last
  let remember = true;

  function clusters() {
    return buildClusters(store.state.transactions, store.state.config);
  }

  function render(container) {
    const list = clusters();
    cursor = Math.max(0, Math.min(cursor, list.length - 1));
    // "Rien à classer" would be a lie while a set-aside review is still
    // waiting, so the celebration keeps until there is genuinely nothing left.
    const aside = renderAside();
    container.innerHTML = list.length ? renderInbox(list) + aside : (aside || renderDone());
    wire(container);
    scrollToCursor(container, false);
  }

  function renderInbox(list) {
    const { config } = store.state;
    const rows = list.reduce((s, c) => s + c.n, 0);
    const left = list.reduce((s, c) => s + Math.abs(c.total), 0);
    const done = recent.reduce((s, c) => s + Math.abs(c.total), 0);
    const pct = left + done ? Math.round((done / (left + done)) * 100) : 0;
    const swLeft = list.filter(c => c.kind === 'splitwise' && c.guesses.length);

    return `
      <div class="card inbox">
        <div class="inbox-head">
          <div class="inbox-head-top">
            <div style="flex:1 1 220px;">
              <div class="inbox-title">À classer <span class="import-pill pill-todo">${rows}</span></div>
              <div class="inbox-sub">${plural(list.length, 'groupe')} restant${list.length >= 2 ? 's' : ''} · triés par montant</div>
            </div>
            <div class="inbox-head-actions">
              ${swLeft.length ? `<button class="btn btn-chip btn-sm" data-action="accept-splitwise">Associer les ${swLeft.length} catégories Splitwise</button>` : ''}
              <button class="btn btn-ghost btn-sm btn-icon" data-action="toggle-remember" aria-pressed="${remember}">
                ${remember ? `${icon('check', { size: 14 })}Mémoriser les règles` : 'Ne rien mémoriser'}
              </button>
            </div>
          </div>
          <div class="meter-row">
            <div class="meter"><div class="meter-fill" style="width:${pct}%"></div></div>
            <div class="meter-label">${money(done, 2)} sur ${money(done + left, 2)}</div>
          </div>
          <div class="kbd-hint">
            <span><span class="kbd">↑</span><span class="kbd">↓</span> naviguer</span>
            <span><span class="kbd">1</span><span class="kbd">2</span><span class="kbd">3</span> catégorie suggérée</span>
            <span><span class="kbd">C</span> toutes les catégories</span>
            <span><span class="kbd">E</span> passer</span>
          </div>
          ${renderSelectedRows(list[cursor])}
        </div>

        <div class="clusters">
          ${list.map((c, i) => renderCluster(c, config, i === cursor)).join('')}
          ${recent.map(c => renderDoneCluster(c, config)).join('')}
        </div>
      </div>
    `;
  }

  // The lines behind the decision under the cursor, in a slot of their own.
  //
  // A merchant key hides what it stands for — "RESTO PONANT" could be four
  // coffees or one catering bill — and the answer is in the dates, the real
  // descriptions and the file each line came from. Keeping the slot in the
  // sticky header rather than inside the card means it costs neither a click
  // nor a trip to the mouse, and that nothing below it ever moves: the slot is
  // the same size whether the cluster holds three lines or forty.
  function renderSelectedRows(cluster) {
    if (!cluster) return '';
    return `
      <div class="inbox-detail">
        <table>
          ${cluster.rows.map(r => `
            <tr>
              <td class="cluster-row-date">${escapeHtml(shortDate(r.date))}</td>
              <td class="cluster-row-desc">${escapeHtml(r.description)}</td>
              <td class="cluster-row-file">${escapeHtml(r.file || '')}</td>
              <td class="cluster-row-amount ${r.amount < 0 ? 'neg' : 'pos'}">${money(r.amount, 2)}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  }

  // Settled clusters stay in the list rather than vanishing: they turn green
  // and sink to the end, so the answer stays visible — and reversible — while
  // the next undecided one takes the cursor's place.
  function renderDoneCluster(c, config) {
    return `
      <div class="cluster done" data-cluster="${escapeHtml(c.key)}">
        <div class="cluster-name">
          ${c.kind === 'splitwise' ? sourceLogoHTML('splitwise') : (c.sources[0] ? sourceLogoHTML(c.sources[0]) : '')}
          <span class="cluster-label">${escapeHtml(c.label)}</span>
          ${icon('arrowRight', { size: 13 })}
          <span class="cluster-done-cat">${resolveEmoji(config, c.category)} ${c.superCategory ? escapeHtml(c.superCategory) + ' / ' : ''}${escapeHtml(c.category)}</span>
        </div>
        <div class="cluster-amount ${c.total < 0 ? 'neg' : 'pos'}">${money(c.total, 2)}</div>
        <div class="cluster-meta">
          ${plural(c.n, 'ligne')} classée${c.n >= 2 ? 's' : ''}${remember ? ' · règle mémorisée' : ''}
        </div>
        <div class="cluster-actions">
          <button class="chip-suggest chip-more" data-action="undo" data-key="${escapeHtml(c.key)}">
            ${icon('x', { size: 13 })}Annuler
          </button>
        </div>
      </div>
    `;
  }

  function renderCluster(c, config, focused) {
    return `
      <div class="cluster ${focused ? 'on' : ''}" data-cluster="${escapeHtml(c.key)}">
        <div class="cluster-name">
          ${c.kind === 'splitwise' ? sourceLogoHTML('splitwise') : (c.sources[0] ? sourceLogoHTML(c.sources[0]) : '')}
          <span class="cluster-label">${escapeHtml(c.label)}</span>
          ${c.superCategory ? `<span class="super-badge">${groupEmojiHTML(config, c.superCategory, { size: 11 })}${escapeHtml(c.superCategory)}</span>` : ''}
        </div>
        <div class="cluster-amount ${c.total < 0 ? 'neg' : 'pos'}">${money(c.total, 2)}</div>
        <div class="cluster-meta">
          ${plural(c.n, 'ligne')}${c.kind === 'splitwise' ? ` · catégorie Splitwise du groupe « ${escapeHtml(c.splitwiseGroup || '—')} »` : ' · marchand'}
          ${remember ? ' · la réponse sera mémorisée' : ''}
        </div>
        <div class="cluster-actions">
          ${c.guesses.map((g, i) => `
            <button class="chip-suggest" data-action="quick" data-cluster="${escapeHtml(c.key)}" data-category="${escapeHtml(g)}">
              <span>${resolveEmoji(config, g)}</span>${escapeHtml(g)}${focused ? `<span class="chip-key">${i + 1}</span>` : ''}
            </button>`).join('')}
          <button class="chip-suggest chip-more" data-action="pick" data-cluster="${escapeHtml(c.key)}">
            Autre…${focused ? ' <span class="chip-key">C</span>' : ''}
          </button>
        </div>
      </div>
    `;
  }

  // What the last import left out, to be confirmed in one gesture per reason.
  //
  // Reviewing two thousand set-aside lines one by one was never the point —
  // the question is "was it right to leave out the duplicates?", asked once.
  // It lands here rather than on the import screen because that screen should
  // ask nothing at all, and because this is where unfinished business lives.
  function renderAside() {
    const review = store.state.asideReview;
    if (!review) return '';
    const total = review.groups.reduce((s, g) => s + g.items.length, 0);

    return `
      <div class="card inbox-aside">
        <div>
          <div class="inbox-title">Mises de côté <span class="import-pill">${total}</span></div>
          <div class="inbox-sub">
            Écartées au dernier import, et pas encore confirmées. Une réponse par motif suffit.
          </div>
        </div>
        <div class="aside-groups">
          ${review.groups.map(g => `
            <div class="aside-group">
              <div class="aside-group-main">
                <div class="aside-group-title">${escapeHtml(asideLabel(g))}</div>
                <div class="aside-group-why">${escapeHtml(g.why)}</div>
              </div>
              <div class="aside-group-actions">
                <button class="btn btn-chip btn-sm btn-icon" data-action="aside-ok" data-key="${escapeHtml(g.key)}">
                  ${icon('check', { size: 14 })}C'est bon
                </button>
                ${g.key === 'error' ? '' : `
                  <button class="btn btn-ghost btn-sm" data-action="aside-import" data-key="${escapeHtml(g.key)}">
                    Importer quand même
                  </button>`}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderDone() {
    return `
      <div class="card">
        <div class="empty-state" style="padding:40px 20px;">
          <div class="empty-icon">${icon('sparkles', { size: 34 })}</div>
          <div class="empty-title" style="margin-top:8px;">Rien à classer</div>
          <div class="empty-body">
            Chaque transaction a sa catégorie. Les règles apprises ici classeront d'elles-mêmes
            les prochains imports — un marchand déjà vu ne sera plus jamais demandé.
          </div>
          <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
            <button class="btn btn-chip" data-action="go-transactions">Voir les transactions</button>
            <button class="btn btn-ghost" data-action="go-importer">Importer d'autres fichiers</button>
          </div>
        </div>
      </div>
    `;
  }

  // Classifying advances on its own: the cluster leaves the list, the one that
  // takes its place inherits the cursor, and the page scrolls to it. Sorting a
  // long tail otherwise means reaching for the mouse between each decision.
  async function classify(cluster, category) {
    if (!cluster || !category) return;
    // Recorded before the store is told: saving triggers the re-render, and a
    // recap updated afterwards would only appear on the *next* one.
    recent = [...recent, { ...cluster, category }];
    const n = await store.classifyCluster(cluster, category, { remember });
    toast(`${plural(n, 'transaction')} → ${category}${remember ? ' · règle mémorisée' : ''}`);
  }

  async function undo(key) {
    const entry = recent.find(c => c.key === key);
    if (!entry) return;
    recent = recent.filter(c => c.key !== key);
    await store.unclassifyCluster(entry);
  }

  function scrollToCursor(container, smooth) {
    const el = container.querySelector('.cluster.on');
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }

  // Delegated once on the container, which survives every re-render: the
  // clusters themselves are rebuilt from the store on each click, so a handler
  // bound to one render's list can never act on a stale one.
  function wire(container) {
    if (container.__inboxKeys) document.removeEventListener('keydown', container.__inboxKeys);
    container.__inboxKeys = (e) => onKeydown(e, container);
    document.addEventListener('keydown', container.__inboxKeys);

    if (container.__inboxWired) return;
    container.__inboxWired = true;

    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const list = clusters();
      const at = list.findIndex(c => c.key === btn.dataset.cluster);
      const cluster = list[at];

      if (action === 'quick' && cluster) {
        cursor = Math.max(0, at);
        await classify(cluster, btn.dataset.category);
      } else if (action === 'pick' && cluster) {
        cursor = Math.max(0, at);
        openPicker(cluster);
      } else if (action === 'undo') {
        await undo(btn.dataset.key);
      } else if (action === 'toggle-remember') {
        remember = !remember;
        render(container);
      } else if (action === 'accept-splitwise') {
        // Splitwise has already categorized its own expenses, so its first
        // guess is nearly always right — and each one is worth dozens of rows.
        const targets = list.filter(c => c.kind === 'splitwise' && c.guesses.length);
        recent = [...recent, ...targets.map(c => ({ ...c, category: c.guesses[0] }))];
        const n = await store.classifyClusters(
          targets.map(c => ({ cluster: c, category: c.guesses[0] })), { remember });
        toast(`${plural(targets.length, 'catégorie')} Splitwise associée${targets.length >= 2 ? 's' : ''} · ${plural(n, 'transaction')}`);
      } else if (action === 'aside-ok') {
        store.dismissAside(btn.dataset.key);
      } else if (action === 'aside-import') {
        const n = await store.importAside(btn.dataset.key);
        toast(`${plural(n, 'transaction')} importée${n >= 2 ? 's' : ''} finalement`);
      } else if (action === 'go-transactions') store.setView('transactions');
      else if (action === 'go-importer') store.setView('importer');
    });
  }

  function openPicker(cluster) {
    pickCategory({
      config: store.state.config,
      // A cluster filed under a trip already knows where a new category goes.
      group: cluster.superCategory || null,
      title: `<b>${escapeHtml(cluster.label)}</b> — ${plural(cluster.n, 'ligne')} · ${money(cluster.total, 2)}`
        + (cluster.superCategory ? ` · sous ${escapeHtml(cluster.superCategory)}` : ''),
      onPick: async (name, created) => {
        if (created) await store.addManualCategory(name, created.group);
        await classify(cluster, name);
      },
    });
  }

  function onKeydown(e, container) {
    if (store.state.view !== 'inbox' || !container.isConnected) return;
    if (document.querySelector('.palette-overlay:not([hidden])')) return;
    if (e.target.matches('input, textarea, select')) return;

    const list = clusters();
    const cluster = list[cursor];
    if (!cluster) return;

    const move = (delta) => {
      cursor = Math.max(0, Math.min(cursor + delta, list.length - 1));
      render(container);
      scrollToCursor(container, true);
    };

    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(-1); }
    else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); move(1); }
    else if (e.key === 'c' || e.key === 'C' || e.key === 'Enter') { e.preventDefault(); openPicker(cluster); }
    else if (['1', '2', '3'].includes(e.key) && cluster.guesses[Number(e.key) - 1]) {
      e.preventDefault();
      classify(cluster, cluster.guesses[Number(e.key) - 1]);
    }
  }

  return { render };
}
