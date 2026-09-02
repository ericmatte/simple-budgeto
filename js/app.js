import { createStore } from './storage/store.js';
import { createTransactionsView } from './views/transactions.js';
import { demoTransactions } from './demo.js';
import { currentTheme, toggleTheme } from './lib/theme.js';
import { icon } from './lib/icons.js';
import { playOnce } from './lib/animate.js';

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

// Which screen is on display — not just the tab, so the first paint after
// loading animates in too.
function screenKey() {
  const { loading, view } = store.state;
  if (loading) return 'loading';
  return 'view:' + view;
}

let renderedScreen = null;

// The transition plays on a *tab* change only. Every store change re-renders
// the whole app, so animating on any render would replay it on every
// keystroke, checkbox and cell edit — which is exactly what the importer's
// card used to do. Restricting it to tab-to-tab also means a reload (which
// goes loading -> dashboard, not tab -> tab) arrives with no animation at all.
function render() {
  const previous = renderedScreen;
  const next = screenKey();
  renderedScreen = next;

  if (previous === next) {
    withPreservedScroll(renderNow);
    return;
  }
  renderNow();
}

// Slides the outgoing tab out and the incoming one in, in the direction of
// travel along the tab bar. The outgoing content is kept as a positioned
// copy over the new one for the length of the animation — the live node is
// destroyed by the re-render, so there is nothing left to animate otherwise.
function swapViews(direction) {
  const main = root.querySelector('.main');
  const outgoing = document.getElementById('view');
  if (!main || !outgoing || prefersReducedMotion()) {
    renderNow();
    return;
  }

  const ghost = outgoing.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.className = 'view-ghost view-out-' + direction;
  ghost.style.height = outgoing.offsetHeight + 'px';
  ghost.style.width = outgoing.offsetWidth + 'px';

  renderNow();

  main.classList.add('view-swapping');
  main.appendChild(ghost);
  playOnce(document.getElementById('view'), 'view-in-' + direction);

  const done = () => {
    ghost.remove();
    main.classList.remove('view-swapping');
  };
  ghost.addEventListener('animationend', done, { once: true });
  // The copy must never outlive the animation, even if the event is missed
  // (a background tab never fires it) — a stale overlay would swallow clicks.
  setTimeout(done, 500);
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function renderNow() {
  const { loading, view } = store.state;

  if (loading) {
    root.innerHTML = `<div style="padding:120px 30px; text-align:center; color:var(--sub); font-weight:700;">Chargement de vos données…</div>`;
    return;
  }

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
