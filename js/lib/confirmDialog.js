import { escapeHtml, plural } from './format.js';

// The app's own "are you sure?".
//
// window.confirm() was doing this job, badly: it is styled by the browser, it
// cannot say what will happen in more than one flat line — and once anyone
// ticks Chrome's "prevent this page from creating additional dialogs", it
// silently returns false forever, which turns every delete button on the page
// into a button that does nothing at all.
//
// Mounted once and reused, like the category palette.

let el = null;
let settle = null; // resolves the promise of the question currently on screen

function mount() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'palette-overlay confirm-overlay';
  el.hidden = true;
  el.innerHTML = `
    <div class="confirm" role="alertdialog" aria-modal="true">
      <div class="confirm-title"></div>
      <div class="confirm-body"></div>
      <div class="confirm-actions">
        <button type="button" class="btn btn-ghost" data-confirm="0"></button>
        <button type="button" class="btn btn-danger" data-confirm="1"></button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  el.addEventListener('mousedown', (e) => { if (e.target === el) close(false); });
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-confirm]');
    if (btn) close(btn.dataset.confirm === '1');
  });
  // Captured, so the view underneath never sees the keystroke: the inbox
  // answers to bare letter keys.
  document.addEventListener('keydown', (e) => {
    if (!settle) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
  }, true);
  return el;
}

function close(answer) {
  if (!settle) return;
  const resolve = settle;
  settle = null;
  el.hidden = true;
  resolve(answer);
}

// `body` is html — it is written by the call sites below, never by user input.
export function confirmDialog({ title, body = '', confirmLabel = 'Supprimer', cancelLabel = 'Annuler' }) {
  mount();
  close(false); // a second question replaces the first, which counts as "no"
  el.querySelector('.confirm-title').innerHTML = title;
  el.querySelector('.confirm-body').innerHTML = body;
  el.querySelector('[data-confirm="0"]').textContent = cancelLabel;
  const yes = el.querySelector('[data-confirm="1"]');
  yes.textContent = confirmLabel;
  el.hidden = false;
  setTimeout(() => yes.focus(), 0);
  return new Promise((resolve) => { settle = resolve; });
}

// --- what each delete actually costs ---------------------------------------
//
// Kept apart from the dialog itself so the wording — where French plurals are
// easy to get wrong — can be read back by the tests.

export function deleteGroupMessage(name, count) {
  return {
    title: `Supprimer le groupe « ${escapeHtml(name)} » ?`,
    body: count >= 2
      ? `Ses <b>${plural(count, 'catégorie')}</b> seront déplacées vers « Non classé ». Aucune transaction n'est supprimée.`
      : count === 1
        ? 'Sa catégorie sera déplacée vers « Non classé ». Aucune transaction n\'est supprimée.'
        : 'Ce groupe est vide.',
  };
}

export function deleteCategoryMessage(name, count) {
  return {
    title: `Supprimer la catégorie « ${escapeHtml(name)} » ?`,
    body: count >= 2
      ? `Ses <b>${plural(count, 'transaction')}</b> seront reclassées dans « Non classé » — aucune n'est supprimée. Son budget planifié, lui, sera effacé.`
      : count === 1
        ? 'Sa transaction sera reclassée dans « Non classé » — elle n\'est pas supprimée. Son budget planifié, lui, sera effacé.'
        : 'Cette catégorie n\'est utilisée par aucune transaction. Son budget planifié sera effacé.',
  };
}

export function deleteTransactionsMessage(count) {
  return {
    title: count >= 2
      ? `Supprimer ${plural(count, 'transaction')} ?`
      : 'Supprimer cette transaction ?',
    body: `${count >= 2 ? 'Elles disparaissent' : 'Elle disparaît'} du budget et du fichier. C'est définitif.`,
  };
}
