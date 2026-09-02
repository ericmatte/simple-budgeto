import { createStore } from './storage/store.js';
import { createTransactionsView } from './views/transactions.js';
import { demoTransactions } from './demo.js';
import { currentTheme, toggleTheme } from './lib/theme.js';
import { icon } from './lib/icons.js';

const store = createStore();
const transactionsView = createTransactionsView(store);

const IS_DEMO = new URLSearchParams(location.search).has('demo');

const root = document.getElementById('app');
let toastTimer = null;

root.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="toggle-theme"]')) return;
  toggleTheme();
  render(); // the table's heat maps are mixed in JS, so CSS alone can't repaint them
});

function themeToggleButton() {
  const dark = currentTheme() === 'dark';
  return `<button class="icon-btn theme-toggle" data-action="toggle-theme"
    title="${dark ? 'Passer au thème clair' : 'Passer au thème sombre'}"
    aria-label="Changer de thème">${icon(dark ? 'sun' : 'moon', { size: 17 })}</button>`;
}

// The toast lives outside `root` and is never part of a render pass: showing
// and hiding it used to rebuild the entire app twice, throwing away scroll
// position and focus each time.
window.addEventListener('toast', (e) => {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = e.detail;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3000);
});

// Any store change rebuilds the whole app from scratch. That's fine for a
// budget this size, but the browser resets every scroll offset when the
// content is torn out from under it — which reads as the page "jumping" on
// every edit. Snapshot the offsets and put them back on the rebuilt DOM.
function withPreservedScroll(build) {
  const y = window.scrollY;
  const lanes = [...root.querySelectorAll('.scrollx, .tbl-pane')].map(el => [el.scrollLeft, el.scrollTop]);
  build();
  const rebuilt = [...root.querySelectorAll('.scrollx, .tbl-pane')];
  if (rebuilt.length === lanes.length) {
    rebuilt.forEach((el, i) => { el.scrollLeft = lanes[i][0]; el.scrollTop = lanes[i][1]; });
  }
  if (window.scrollY !== y) window.scrollTo({ top: y, behavior: 'instant' });
}

let hasRendered = false;

// The very first paint has no scroll offsets worth keeping; every render
// after it does.
function render() {
  if (hasRendered) {
    withPreservedScroll(renderNow);
    return;
  }
  hasRendered = true;
  renderNow();
}

function renderNow() {
  root.innerHTML = `
    <div class="app-header">
      <div class="app-header-top">
        <div class="app-title">Transactions</div>
        <div class="app-header-actions">
          ${themeToggleButton()}
          ${store.state.demo ? '<a class="btn btn-ghost btn-sm" href="./">Quitter la démo</a>' : ''}
        </div>
      </div>
      <div class="app-header-context">
        <div class="app-stamps">Session temporaire — rien n’est sauvegardé.</div>
        <!-- Filled by the transactions view, which owns the period it counts. -->
        <div class="app-stamps app-cashback" id="app-cashback"></div>
      </div>
    </div>
    <div class="main">
      ${store.state.demo ? `
        <div class="banner banner-info" style="margin-bottom:20px;">
          Mode démonstration — données fictives générées à la volée. Rien n'est enregistré et aucun de tes fichiers n'est touché.
        </div>` : ''}
      <div id="view"></div>
    </div>
  `;

  const viewContainer = document.getElementById('view');
  transactionsView.render(viewContainer);
}

store.subscribe(render);
render();
if (IS_DEMO) store.startDemo(demoTransactions());
else store.init();
