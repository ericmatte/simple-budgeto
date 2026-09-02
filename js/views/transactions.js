import { escapeHtml, money, plural, shortDate, titleCase, ymFull } from '../lib/format.js';
import { sourceLogoHTML, sourceLabel, groupColors } from '../lib/sourceLogos.js';
import { icon } from '../lib/icons.js';
import { toast } from '../lib/toast.js';
import { detectDelimiter, parseCsv } from '../lib/csv.js';
import { dayOffset } from '../matching/reconcile.js';
import { commonMembers } from '../parsers/splitwise.js';

const KNOWN_SOURCES = ['cibc', 'tangerine', 'wealthsimple', 'splitwise'];
const DATE_RANGE_KEY = 'simple-budgeto.transaction-date-range';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseRange(stored) {
  try {
    const range = JSON.parse(stored || '{}') || {};
    return { from: ISO_DATE.test(range.from || '') ? range.from : '', to: ISO_DATE.test(range.to || '') ? range.to : '' };
  } catch { return { from: '', to: '' }; }
}

// A range the user set weeks ago must not swallow a fresh import: whatever was
// just read from a file is widened into rather than filtered away.
export function rangeCovering(range, dates) {
  const known = (dates || []).filter(d => ISO_DATE.test(d || '')).sort();
  if (!known.length) return { ...range };
  const first = known[0];
  const last = known[known.length - 1];
  return {
    from: !range.from || first < range.from ? first : range.from,
    to: !range.to || last > range.to ? last : range.to,
  };
}

// A CIBC export ships no header row at all, so its columns are named from the
// shape its parser reads (see parsers/cibc.js).
const HEADERLESS_COLUMNS = {
  cibc: ['Date', 'Description', 'Débit', 'Crédit', 'Carte'],
};

// The delimiter comes from the header when there is one: a value line alone can
// hold more semicolons than commas and would be split on the wrong character.
export function rawFields(entry) {
  const { source, header, line } = entry || {};
  const delimiter = detectDelimiter(header || line || '');
  const names = parseCsv(header || '', delimiter)[0] || [];
  const values = parseCsv(line || '', delimiter)[0] || [];
  const known = HEADERLESS_COLUMNS[source] || [];
  return Array.from({ length: Math.max(names.length, values.length) }, (_, i) => ({
    name: names[i] || known[i] || `Colonne ${i + 1}`,
    value: values[i] || '',
  }));
}

// A Splitwise expense and the bank line that paid it are matched on their
// total, so the pair can straddle several days. The row carries the bank day;
// the warning says how far the expense sits from it.
export function matchDateWarning(transaction) {
  const other = transaction?.matchDate;
  if (!other || other === transaction.date) return '';
  const gap = dayOffset(transaction.date, other);
  if (gap === null) return '';
  return `L’entrée Splitwise est à ${plural(Math.abs(gap), 'jour')} de la transaction`;
}

// No placeholder ahead of the names: the first one is then the one already
// selected, and one click imports. A placeholder is all that is left to show
// when the files share no member name at all.
export function memberOptions(names) {
  if (!names.length) return '<option value="">Choisir…</option>';
  return names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
}

// A statement names the merchant that billed the purchase; Splitwise names
// what was actually bought. The row leads with the name the reader knows and
// keeps the statement's own wording after it, which is what they will search
// for when they go back to their bank.
export function rowDescription(transaction) {
  const own = titleCase(transaction?.description);
  const other = titleCase(transaction?.matchDescription);
  if (!other) return own || '—';
  return own ? `${other} (${own})` : other;
}

// A term to append to a sum the reader is already writing, not a formula of
// its own: it opens on "+" rather than "=", and the amount is always positive
// because the sheet it lands in decides the sign. Excel reads N("…") as zero,
// which is the one way to carry a note inside a formula — the cell adds up as
// the amount and still says what it stands for. The dot is the decimal
// separator a formula needs, whatever the locale the row is shown in.
export function excelFormula(transaction) {
  const amount = Number(transaction?.amount);
  if (!Number.isFinite(amount)) return '';
  const day = shortDate(transaction.date);
  const described = rowDescription(transaction);
  const note = [day === '—' ? '' : day, described === '—' ? '' : described].filter(Boolean).join(' ').replace(/"/g, '""');
  const term = `+${Math.abs(amount).toFixed(2)}`;
  return note ? `${term}+N("${note}")` : term;
}

// A cashback, a payment or a Splitwise settlement moves money without being a
// purchase, and a row that rounds to nothing weighs nothing. They stay in the
// list — the money did move — but step back from the rows worth reading.
const MUTED_TERMS = ['cashback', 'paiement', ' paid '];

export function isMutedRow(transaction) {
  if (Math.round(Number(transaction?.amount) * 100) === 0) return true;
  const description = String(transaction?.description ?? '').toLowerCase();
  return MUTED_TERMS.some(term => description.includes(term));
}

// A cashback is money the card hands back, and the reader wants it as one
// number for the period on screen rather than a row at a time.
const CASHBACK_TERMS = ['cashback', 'remise en argent'];

export function cashbackTotal(rows) {
  return (rows || [])
    .filter(t => CASHBACK_TERMS.some(term => String(t?.description ?? '').toLowerCase().includes(term)))
    .reduce((total, t) => total + (Number(t.amount) || 0), 0);
}

// The transactions themselves do not survive a reload, so the dates picked
// before it are all that is left of the session: a fresh import fills that
// range in rather than widening it, and the list comes back where it was
// left. Only a session that never stored a range takes the span of the files
// it was just handed.
export function rangeAfterImport(stored, dates) {
  const range = parseRange(stored);
  return range.from || range.to ? range : rangeCovering(range, dates);
}

export function stepSelection(rows, selectedId, offset) {
  if (!rows.length) return null;
  const current = rows.findIndex(t => t.id === selectedId);
  if (current < 0) return rows[0].id;
  return rows[Math.max(0, Math.min(rows.length - 1, current + offset))].id;
}

export function createTransactionsView(store) {
  let search = '';
  let { from, to } = parseRange(localStorage.getItem(DATE_RANGE_KEY));
  let selectedId = null;
  let activeContainer = null;
  // Rows the reader has ticked off while reading. Deliberately nowhere but
  // here: it is a mark for this sitting, not a fact about the transaction.
  const checked = new Set();
  // The Splitwise column is worth its width only once something fills it.
  let showSwCategory = false;
  // The colour each Splitwise group wears, dealt out over the groups the
  // period actually shows.
  let groupPalette = new Map();

  function saveRange() {
    try { localStorage.setItem(DATE_RANGE_KEY, JSON.stringify({ from, to })); } catch { /* session still works in private mode */ }
  }

  function applyRange(range) {
    if (range.from === from && range.to === to) return;
    ({ from, to } = range);
    saveRange();
  }

  function render(container) {
    activeContainer = container;
    const awaitingMembers = (store.state.pendingImport?.fileReports || []).filter(r => r.needsMemberSelection);
    if (awaitingMembers.length) {
      container.innerHTML = memberPicker(awaitingMembers);
      wireImport(container);
      return;
    }
    if (!from && !to) applyRange(rangeCovering({ from, to }, store.state.transactions.map(t => t.date)));
    const rows = visibleRows();
    if (rows.length && !rows.some(t => t.id === selectedId)) selectedId = rows[0].id;
    const hasTransactions = store.state.transactions.length > 0;
    showSwCategory = rows.some(t => t.swCategory);
    groupPalette = groupColors(rows.map(t => t.swGroup));

    container.innerHTML = `<div class="card tx-card">
      <div class="tx-toolbar">
        <div class="tx-titlebar"><div><div style="font-size:18px;font-weight:800;">Transactions</div><div style="color:var(--sub);font-size:13px;">${plural(rows.length, 'transaction')}</div></div>${fileButton()}</div>
        ${hasTransactions ? filters() : ''}
      </div>
      ${rows.length ? `<table class="tx-table"><thead><tr><th></th><th>Source</th><th>Date</th><th>Montant</th><th>Description</th>${showSwCategory ? '<th>Catégorie Splitwise</th>' : ''}</tr></thead><tbody>${monthGroups(rows)}</tbody></table>` : (hasTransactions ? '<div class="tx-no-results">Aucune transaction dans cette période.</div>' : emptyState())}
    </div>`;
    wireList(container, rows);
    wireFilePicker(container);
    syncMetrics();
    showCashback(rows);
  }

  // The period lives in this view, so the header's total is written from here:
  // the toolbar changes the dates without the app around it re-rendering.
  function showCashback(rows) {
    const slot = document.getElementById('app-cashback');
    if (!slot) return;
    const total = cashbackTotal(rows);
    slot.textContent = total ? `Remises en argent sur la période : ${money(total, 2)}` : '';
  }

  // Two measurements the stylesheet cannot take for itself: how far down the
  // pinned toolbar reaches, and how much width the card has to give. Both are
  // read off the toolbar, the one block in the card that never overflows —
  // the table below it does, which is the whole point of the width.
  function syncMetrics() {
    const card = activeContainer?.querySelector('.tx-card');
    const toolbar = card?.querySelector('.tx-toolbar');
    if (!card || !toolbar) return;
    card.style.setProperty('--tx-sticky-top', `${toolbar.offsetHeight}px`);
    card.style.setProperty('--tx-content-width', `${toolbar.offsetWidth}px`);
  }

  function visibleRows() {
    return store.state.transactions
      .filter(t => (!from || t.date >= from) && (!to || t.date <= to))
      .filter(t => !search || `${t.description} ${t.matchDescription || ''} ${(t.sources || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  function filters() {
    return `<div class="tx-filters"><label>Du <input id="tx-from" type="date" value="${from}"></label><label>Au <input id="tx-to" type="date" value="${to}"></label><input id="tx-search" class="tx-search" type="search" placeholder="Rechercher…" value="${escapeHtml(search)}"><div class="tx-nav" aria-label="Naviguer dans les transactions"><button type="button" class="btn btn-ghost btn-sm" data-action="previous" title="Transaction précédente">↑</button><button type="button" class="btn btn-ghost btn-sm" data-action="next" title="Transaction suivante">↓</button></div></div>`;
  }

  // The open transaction is two rows — itself and its source lines — and the
  // pair shares one band, so the banding counts transactions rather than the
  // table rows they take up.
  function monthGroups(rows) {
    let month = null;
    return rows.map((t, i) => {
      const next = /^\d{4}-\d{2}/.test(t.date || '') ? t.date.slice(0, 7) : 'inconnue';
      const heading = next === month ? '' : `<tr class="tx-month"><td colspan="${columnCount()}">${next === 'inconnue' ? 'Date inconnue' : escapeHtml(ymFull(next))}</td></tr>`;
      month = next;
      const band = i % 2 ? 'alt' : '';
      return heading + row(t, band) + (t.id === selectedId ? rawDetail(t, band) : '');
    }).join('');
  }

  function columnCount() { return showSwCategory ? 6 : 5; }

  // A Splitwise mark carries the colour of the group the expense was shared
  // in: the reader keeps several groups, and the logo alone says nothing
  // about which one a row came from.
  function sourceMarks(t) {
    return (t.sources || []).map(s => {
      const group = s === 'splitwise' ? t.swGroup : '';
      const label = group ? `${sourceLabel(s)} · ${group}` : sourceLabel(s);
      return sourceLogoHTML(s, `title="${escapeHtml(label)}"`, groupPalette.get(group) || '');
    }).join('');
  }

  function row(t, band) {
    const sources = sourceMarks(t);
    const warning = matchDateWarning(t);
    const badge = warning ? `<span class="tx-date-warn" title="${escapeHtml(warning)}">${icon('alert', { size: 13, label: warning })}</span>` : '';
    const swCategory = showSwCategory ? `<td class="tx-sw-category">${t.swCategory ? escapeHtml(t.swCategory) : '—'}</td>` : '';
    return `<tr class="tx-row ${band} ${t.id === selectedId ? 'selected' : ''} ${checked.has(t.id) ? 'checked' : ''} ${isMutedRow(t) ? 'muted' : ''}" data-id="${escapeHtml(t.id)}">${markCell(t)}<td><div class="source-list">${sources}</div></td><td style="white-space:nowrap;">${escapeHtml(shortDate(t.date))}${badge}</td><td class="preview-amount ${t.amount < 0 ? 'neg' : 'pos'}">${money(t.amount, 2)}</td><td>${escapeHtml(rowDescription(t))}</td>${swCategory}</tr>`;
  }

  // Both marks share one slot: the tick box at rest, the copy button once the
  // row is under the pointer. The tick box stays a real checkbox underneath,
  // so the keyboard and a touch screen can still reach it.
  function markCell(t) {
    const label = 'Copier pour Excel';
    return `<td class="tx-mark-cell"><div class="tx-mark">
      <input type="checkbox" class="tx-check" data-action="check"${checked.has(t.id) ? ' checked' : ''} aria-label="Cocher la transaction">
      <button type="button" class="tx-copy" data-action="copy" data-formula="${escapeHtml(excelFormula(t))}" title="${label}">${icon('copy', { size: 14, label })}</button>
    </div></td>`;
  }

  function rawDetail(transaction, band) {
    const entries = transaction.rawEntries || [];
    const warning = matchDateWarning(transaction);
    const body = entries.length
      ? entries.map(rawFile).join('')
      : '<div class="tx-raw-empty">Le brut n’est disponible que pour les transactions importées dans cette session.</div>';
    return `<tr class="tx-raw-row ${band}"><td colspan="${columnCount()}"><div class="tx-raw"><div class="tx-raw-title">Lignes source</div>${warning ? `<div class="tx-raw-warn">${icon('alert', { size: 14 })}${escapeHtml(warning)} (${escapeHtml(shortDate(transaction.matchDate))}).</div>` : ''}${body}</div></td></tr>`;
  }

  function rawFile(entry) {
    const fields = rawFields(entry);
    const table = fields.length
      ? `<div class="tx-raw-scroll"><table class="tx-raw-table">
          <thead><tr>${fields.map(f => `<th>${escapeHtml(f.name)}</th>`).join('')}</tr></thead>
          <tbody><tr>${fields.map(f => `<td>${escapeHtml(f.value) || '—'}</td>`).join('')}</tr></tbody>
        </table></div>`
      : '';
    return `<div class="tx-raw-file"><div>${sourceLogoHTML(entry.source)}<b>${escapeHtml(entry.file || sourceLabel(entry.source))}</b></div>${table}</div>`;
  }

  function emptyState() {
    return `<div class="empty-state" style="padding:42px var(--tx-gutter);"><div class="empty-title">Charge tes transactions</div><div class="empty-body">Choisis un ou plusieurs exports; ils restent uniquement dans cette session.</div><div class="import-sources" style="margin-top:22px;text-align:left;"><div class="import-sources-title">Sources reconnues</div><div class="import-sources-list">${KNOWN_SOURCES.map(s => `<div class="import-source-chip">${sourceLogoHTML(s)}<span>${escapeHtml(sourceLabel(s))}</span></div>`).join('')}</div></div></div>`;
  }

  function fileButton() { return `<label class="btn btn-primary" style="cursor:pointer;">Choisir des fichiers<input class="tx-file-picker" type="file" multiple accept=".csv,.txt" style="display:none;"></label>`; }
  function memberPicker(reports) {
    const names = commonMembers(reports.map(r => r.memberColumns));
    return `<div class="card"><div class="banner banner-info">
      <div>Qui es-tu dans ${reports.length > 1 ? 'ces exports Splitwise' : 'cet export Splitwise'} ?</div>
      <div class="tx-splitwise-files">${reports.map(r => escapeHtml(r.label || '(sans nom)')).join(' · ')}</div>
      <div class="import-who-row">
        <select data-who>${memberOptions(names)}</select>
        <button class="btn btn-primary btn-sm" data-action="who">Importer</button>
      </div>
    </div><div class="import-actions"><button class="btn btn-ghost" data-action="cancel">Annuler</button></div></div>`;
  }

  async function copyFormula(formula) {
    if (!formula) return;
    try {
      await navigator.clipboard.writeText(formula);
      toast(`Copié : ${formula}`);
    } catch {
      toast('Le navigateur a refusé la copie');
    }
  }

  function selectOffset(offset) {
    const next = stepSelection(visibleRows(), selectedId, offset);
    if (!next) return;
    selectedId = next;
    render(activeContainer);
    requestAnimationFrame(revealSelected);
  }

  // The toolbar and the column names are sticky, so a row scrolled to the top
  // of the viewport lands underneath them. Their heights are measured rather
  // than hardcoded: both grow with what they hold. The bottom margin brings the
  // source lines along, since they sit right under the row they explain.
  function revealSelected() {
    const row = activeContainer?.querySelector('.tx-row.selected');
    if (!row) return;
    const pinnedTop = (activeContainer.querySelector('.tx-toolbar')?.offsetHeight || 0)
      + (activeContainer.querySelector('.tx-table thead')?.offsetHeight || 0);
    row.style.scrollMarginTop = `${pinnedTop + 8}px`;
    row.style.scrollMarginBottom = `${(activeContainer.querySelector('.tx-raw-row')?.offsetHeight || 0) + 8}px`;
    row.scrollIntoView({ block: 'nearest' });
  }

  async function importFiles(files) {
    store.runImport(files);
    if (store.state.pendingImport?.fileReports.some(r => r.needsMemberSelection)) return;
    const imported = store.state.pendingImport.items.filter(it => it.included);
    // Read back rather than trusted from memory: the range may have moved in
    // another tab since this view loaded.
    applyRange(rangeAfterImport(localStorage.getItem(DATE_RANGE_KEY), imported.map(it => it.date)));
    const n = await store.confirmImport();
    toast(`${plural(n, 'transaction')} importée${n >= 2 ? 's' : ''}`);
  }

  function wireFilePicker(container) { container.querySelectorAll('.tx-file-picker').forEach(input => input.addEventListener('change', async () => { const files = []; for (const f of input.files) files.push({ label: f.name, text: await f.text() }); if (files.length) await importFiles(files); })); }
  function wireList(container) {
    container.querySelector('#tx-from')?.addEventListener('change', e => { from = e.target.value; saveRange(); render(container); });
    container.querySelector('#tx-to')?.addEventListener('change', e => { to = e.target.value; saveRange(); render(container); });
    container.querySelector('#tx-search')?.addEventListener('input', e => { search = e.target.value; const caret = e.target.selectionStart; render(container); const refreshed = container.querySelector('#tx-search'); refreshed?.focus(); refreshed?.setSelectionRange(caret, caret); });
    container.querySelector('[data-action="previous"]')?.addEventListener('click', () => selectOffset(-1));
    container.querySelector('[data-action="next"]')?.addEventListener('click', () => selectOffset(1));
    container.querySelectorAll('.tx-row').forEach(el => el.addEventListener('click', () => { selectedId = el.dataset.id; render(container); requestAnimationFrame(revealSelected); }));
    // Stopped at the control: copying or ticking a row is not opening it, and
    // the render a selection triggers would pull this very node out of the
    // document. Copying a row is also what ticks it off — the reader took the
    // amount away, so the row is dealt with.
    container.querySelectorAll('[data-action="copy"]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      copyFormula(el.dataset.formula);
      markChecked(el.closest('.tx-row'), true);
    }));
    container.querySelectorAll('[data-action="check"]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      markChecked(el.closest('.tx-row'), el.checked);
    }));
  }

  // Written straight onto the row rather than through a render: the pointer is
  // on the control, and a rebuilt table would drop the hover it is holding.
  function markChecked(row, on) {
    const id = row?.dataset.id;
    if (!id) return;
    if (on) checked.add(id); else checked.delete(id);
    row.classList.toggle('checked', on);
    const box = row.querySelector('.tx-check');
    if (box) box.checked = on;
  }
  function wireImport(container) { container.addEventListener('click', async e => { const b = e.target.closest('[data-action]'); if (!b) return; if (b.dataset.action === 'cancel') store.cancelImport(); else if (b.dataset.action === 'who') { const name = container.querySelector('[data-who]').value; if (name) { store.setSplitwiseMyName(name); await importFiles(store.state.pendingImport.rawFiles); } } }); }

  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.target.closest?.('input, textarea, select, button')) return;
    if (!activeContainer || store.state.pendingImport) return;
    e.preventDefault();
    selectOffset(e.key === 'ArrowUp' ? -1 : 1);
  });

  window.addEventListener('resize', syncMetrics);

  return { render };
}
