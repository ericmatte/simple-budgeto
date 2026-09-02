import { money, num0, ym, ymLabel, ymFull, shift, MN, escapeHtml } from '../lib/format.js';
import { groupOf, resolveEmoji, resolveGroupEmoji, moveInList, parseSlotKey } from '../storage/config.js';
import { openEmojiPicker, closeEmojiPicker } from '../lib/emojiPicker.js';
import { openInlineEdit, closeInlineEdit, commitInlineEdit } from '../lib/inlineEdit.js';
import { filterFromBudgetStart, clampWindowEnd, canScrollBack } from '../lib/budgetStart.js';
import { parseFormula } from '../lib/formula.js';
import * as calc from './dashboardCalc.js';
import { icon } from '../lib/icons.js';

export function createDashboardView(store) {
  let chartObserver = null;
  let chartWidth = 0;
  let dragState = null; // { type: 'group'|'category', name, group } while a row is being dragged

  function render(container) {
    closeEmojiPicker();
    closeInlineEdit();
    readPalette();
    const { transactions, config } = store.state;
    // Each row's group is resolved once, here: everything downstream keys on
    // the (group, category) pair, so a name that lives in several groups adds
    // up as several lines instead of collapsing into one.
    const active = filterFromBudgetStart(transactions, config.startMonth)
      .filter(t => t.status !== 'excluded' && t.status !== 'deleted')
      .map(t => ({ ...t, group: groupOf(config, t) }));

    if (!active.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">Vos chiffres vous attendent</div>
          <div class="empty-body">Importe tes transactions bancaires et Splitwise (onglet Importer) pour voir ton patrimoine, tes dépenses réelles vs planifiées, et ta progression vers tes objectifs.</div>
          <button class="btn btn-primary" data-action="go-import">Importer mes transactions</button>
        </div>
      `;
      container.querySelector('[data-action="go-import"]').addEventListener('click', () => store.setView('importer'));
      return;
    }

    const winEnd = clampWindowEnd(config.winEnd || lastDataMonth(active) || ym(new Date()), config.startMonth);
    const canGoBack = canScrollBack(winEnd, config.startMonth);
    const todayKey = ym(new Date());

    const keys = [];
    for (let i = 11; i >= 0; i--) keys.push(shift(winEnd, -i));
    const isIncomeSlot = (slot) => parseSlotKey(slot).group === 'Revenus';

    // `carry` accumulates the money that was substituted in from budgets
    // (see calc.effectiveSpent) across the window, so the balance line
    // projects forward instead of running flat through months that have no
    // real transactions yet. Months before the window are settled history
    // and keep their real balance.
    let carry = 0;
    const data = keys.map(k => {
      const spentReal = calc.spent(active, k);
      const incomeReal = calc.income(active, k);
      const spent = calc.effectiveSpent(active, k, isIncomeSlot);
      const income = calc.effectiveIncome(active, k, isIncomeSlot);
      const adj = calc.adjust(active, k);
      carry += (income - spent) - (incomeReal - spentReal);
      return {
        key: k, spent, income, adj,
        spentReal, incomeReal,
        nw: calc.netWorth(active, k) + carry,
        plan: calc.planned(active, k),
        net: income - spent + adj,
      };
    });
    const si = keys.length - 1;
    const selD = data[si];
    const diff = selD.nw - calc.netWorth(active, shift(winEnd, -1));
    const delta = selD.plan - selD.spent;
    const goalRow = active.filter(r => r.kind === 'objectif')[0];
    const goalPct = goalRow ? Math.max(0, Math.min(100, selD.nw / Math.abs(goalRow.amount) * 100)) : 0;

    container.innerHTML = `
      <div class="kpi-bar">
        ${renderKpis({ selD, diff, delta, sel: winEnd })}
        ${goalRow ? renderGoal(goalPct, selD.nw, goalRow) : ''}
      </div>

      <div class="card">
        <div style="display:flex; align-items:baseline; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:8px;">
          <div style="font-size:17px; font-weight:800;">Patrimoine, dépenses et épargne</div>
          ${renderLegend()}
        </div>
        <div class="scrollx">
          <div style="min-width:940px;">
            <div id="chart-wrap" style="position:relative;"></div>
            ${renderSummaryTable(data, si, calc.netWorth(active, shift(keys[0], -1)))}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="tbl-head-bar">
          <button class="band-nav" data-action="prev-win" title="12 mois précédents" ${canGoBack ? '' : 'disabled'}>${icon('chevronLeft', { size: 18 })}</button>
          <div class="tbl-head-bar-title">
            <div style="font-size:17px; font-weight:800;">Tableau des 12 mois</div>
            <div class="tbl-range">${ymFull(keys[0])} → ${ymFull(winEnd)}</div>
          </div>
          <label class="start-month" title="Les transactions antérieures à ce mois sont ignorées à l'import et masquées partout">
            <span>Budget depuis</span>
            <input type="month" data-action="start-month" value="${config.startMonth || ''}">
            ${config.startMonth ? `<button class="icon-btn" data-action="clear-start-month" title="Retirer la limite">${icon('x', { size: 14 })}</button>` : ''}
          </label>
          <button class="band-nav" data-action="next-win" title="12 mois suivants">${icon('chevronRight', { size: 18 })}</button>
        </div>
        <div class="tbl-pane">${renderTable(active, keys, si, config, todayKey, data)}</div>
      </div>
    `;

    wireEvents(container, { winEnd });
    mountChart(container, data, si);
  }

  function renderKpis({ selD, diff, delta, sel }) {
    const items = [
      { label: 'Patrimoine total', value: money(selD.nw), sub: (diff >= 0 ? '+' : '') + money(diff) + ' vs mois précédent' },
      { label: 'Dépensé · ' + ymLabel(sel), value: money(selD.spent), sub: 'planifié ' + money(selD.plan) },
      { label: 'Écart au budget', value: (delta >= 0 ? '+' : '') + money(delta), sub: delta >= 0 ? 'sous le budget' : 'au-dessus du budget' },
      { label: 'Ajouté au compte', value: (selD.net >= 0 ? '+' : '') + money(selD.net), sub: 'revenus − dépenses' },
    ];
    return items.map(k => `
      <div class="kpi">
        <div class="kpi-label">${escapeHtml(k.label)}</div>
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    `).join('');
  }

  function renderGoal(pct, nw, goalRow) {
    return `
      <div style="flex:1 1 160px; min-width:160px; display:flex; flex-direction:column; gap:6px;">
        <div style="display:flex; justify-content:space-between; gap:10px; font-size:10.5px; font-weight:800; letter-spacing:0.14em; text-transform:uppercase; opacity:.55;">
          <span>Objectif</span><span>${Math.round(pct)}%</span>
        </div>
        <div style="height:8px; border-radius:999px; background:var(--track); overflow:hidden;">
          <div style="width:${pct}%; height:100%; background:var(--green-soft); border-radius:999px;"></div>
        </div>
        <div style="font-size:12px; font-weight:700; opacity:.7;">${money(nw)} / ${money(Math.abs(goalRow.amount))}${goalRow.description ? ' · ' + escapeHtml(goalRow.description) : ''}</div>
      </div>
    `;
  }

  function renderLegend() {
    const items = [['patrimoine', 'var(--green)'], ['planifié', 'var(--chip)'], ['dépensé', 'var(--acc)'], ['ajouté au compte', 'var(--green-soft)']];
    return `<div style="display:flex; gap:14px; font-size:11.5px; font-weight:800; color:var(--sub); align-items:center; flex-wrap:wrap;">
      ${items.map(([label, color]) => `<span style="display:inline-flex; align-items:center; gap:6px;"><span style="width:10px; height:10px; border-radius:3px; background:${color}; display:inline-block;"></span>${label}</span>`).join('')}
    </div>`;
  }

  // These three shade numbers by interpolating between real RGB triplets, so
  // unlike the rest of the app they can't just name a CSS variable. They read
  // the active theme's colours out of the stylesheet instead of baking in the
  // light palette — otherwise every heat-mapped figure would stay dark purple
  // on a dark background. Read once per render: getComputedStyle forces a
  // style resolve, and these run once per cell.
  let palette = { red: [255, 92, 57], ink: [42, 27, 61], green: [44, 182, 125] };

  function readPalette() {
    if (typeof getComputedStyle !== 'function') return;
    const style = getComputedStyle(document.documentElement);
    const read = (name, fallback) => {
      const parts = style.getPropertyValue(name).split(',').map(n => Number(n.trim()));
      return parts.length === 3 && parts.every(Number.isFinite) ? parts : fallback;
    };
    palette = {
      red: read('--acc-rgb', palette.red),
      ink: read('--ink-rgb', palette.ink),
      green: read('--green-rgb', palette.green),
    };
  }

  const mix = (a, b, t) => {
    const k = Math.max(0, Math.min(1, t));
    return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * k)).join(',')})`;
  };

  // Colors a value against the min/max of its own row: red at the low end,
  // green at the high end, fading through the default ink color at the
  // midpoint — a per-row heatmap rather than a fixed positive/negative rule,
  // since every value in these rows (income, expenses, balance) is >= 0.
  function scaleColor(v, min, max) {
    if (max === min) return 'var(--ink)';
    const t = (v - min) / (max - min);
    const { red, ink, green } = palette;
    return t <= 0.5 ? mix(red, ink, t / 0.5) : mix(ink, green, (t - 0.5) / 0.5);
  }

  function heatBg(v, maxAbs) {
    if (!maxAbs) return 'transparent';
    const t = Math.min(1, Math.abs(v) / maxAbs);
    const rgb = (v >= 0 ? palette.green : palette.red).join(',');
    return `rgba(${rgb},${(0.1 + t * 0.55).toFixed(2)})`;
  }

  // Colors a 12-month-table cell's real value against its planned value:
  // ink at exactly-on-plan, fading to green the better it is (under budget
  // for an expense, over target for income) and to red the worse it is.
  function budgetGradient(ratio, isIncome) {
    const score = isIncome ? ratio : 2 - ratio;
    const { red, ink, green } = palette;
    return score >= 1 ? mix(ink, green, score - 1) : mix(ink, red, 1 - score);
  }

  function renderSummaryTable(data, si, prevNw) {
    const grid = `180px repeat(${data.length}, minmax(52px, 1fr)) 84px 84px`;
    const highlight = i => i === si ? 'background:var(--highlight);' : '';

    const incomes = data.map(d => d.income);
    const spents = data.map(d => d.spent);
    const nets = incomes.map((v, i) => v - spents[i]);
    const balances = data.map(d => d.nw);
    const netMaxAbs = Math.max(1, ...nets.map(v => Math.abs(v)));
    const netTotal = nets.reduce((a, v) => a + v, 0);
    const balDelta = balances[balances.length - 1] - prevNw;

    function valueRow(label, vals, strong) {
      const min = Math.min(...vals), max = Math.max(...vals);
      const total = vals.reduce((a, v) => a + v, 0);
      const cells = vals.map((v, i) => `<div class="tbl-cell" style="${highlight(i)} color:${scaleColor(v, min, max)}; font-weight:${i === si ? 900 : 700};">${num0(v)}</div>`).join('');
      return `
        <div class="tbl-row" style="grid-template-columns:${grid};">
          <div class="tbl-label" style="justify-content:flex-end; font-weight:${strong ? 900 : 700};">${label}</div>
          ${cells}
          <div class="tbl-cell" style="font-weight:900;">${num0(total)}</div>
          <div class="tbl-cell" style="color:var(--sub); font-weight:700;">${num0(total / vals.length)}</div>
        </div>
      `;
    }

    const netCells = nets.map(v => `<div class="tbl-cell" style="background:${heatBg(v, netMaxAbs)}; font-weight:800;">${num0(v)}</div>`).join('');
    const balCells = balances.map((v, i) => {
      const min = Math.min(...balances), max = Math.max(...balances);
      return `<div class="tbl-cell" style="${highlight(i)} color:${scaleColor(v, min, max)}; font-weight:${i === si ? 900 : 700};">${num0(v)}</div>`;
    }).join('');

    return `
      <div class="tbl" id="chart-summary-tbl" style="margin-top:6px;">
        <div class="tbl-row" style="grid-template-columns:${grid};">
          <div class="tbl-label"></div>
          ${data.map(() => '<div class="tbl-cell chart-col"></div>').join('')}
          <div style="text-align:right; font-size:11px; font-weight:800; text-transform:uppercase; color:var(--sub); padding:6px 4px;">Total</div>
          <div style="text-align:right; font-size:11px; font-weight:800; text-transform:uppercase; color:var(--sub); padding:6px 0 6px 4px;">Moyenne</div>
        </div>
        ${valueRow('Total des revenus', incomes)}
        ${valueRow('Total des dépenses', spents)}
        <div class="tbl-row" style="grid-template-columns:${grid}; border-top:2px solid var(--ink); border-bottom:2px solid var(--ink);">
          <div class="tbl-label" style="justify-content:flex-end; font-weight:900;">NET (Revenus − Dépenses)</div>
          ${netCells}
          <div class="tbl-cell" style="font-weight:900;">${num0(netTotal)}</div>
          <div class="tbl-cell" style="color:var(--sub); font-weight:700;">${num0(netTotal / nets.length)}</div>
        </div>
        <div class="tbl-row" style="grid-template-columns:${grid};">
          <div class="tbl-label" style="justify-content:flex-end;">Balance projetée</div>
          ${balCells}
          <div class="tbl-cell" style="font-weight:900; color:${balDelta >= 0 ? 'var(--green)' : 'var(--acc)'};">${num0(balDelta)}</div>
          <div class="tbl-cell"></div>
        </div>
      </div>
    `;
  }

  // The SVG viewBox/width/height are set to the container's *real* measured
  // pixel size (not a fixed 1000x260 with preserveAspectRatio=none), so
  // 1 coordinate unit == 1 real pixel and circles/rounded corners never
  // get stretched into ellipses/ovals by a mismatched aspect ratio.
  function mountChart(container, data, si) {
    const wrap = container.querySelector('#chart-wrap');
    if (!wrap) return;
    // Guarded on the width actually changing: painting sets the SVG's height,
    // which the observer sees as a resize, which repaints — an avoidable
    // feedback loop that Chrome reports as dropped observer notifications.
    const paint = () => {
      const w = Math.max(240, wrap.clientWidth || 800);
      if (w === chartWidth) return;
      chartWidth = w;
      const h = Math.max(190, Math.min(260, w * 0.24));
      wrap.innerHTML = buildChartSvg(w, h, data, si, measureColumns(container, wrap, data.length));
    };
    chartWidth = 0;
    paint();
    if (chartObserver) chartObserver.disconnect();
    chartObserver = new ResizeObserver(() => paint());
    chartObserver.observe(wrap);
  }

  // Reads the actual rendered position of each month column in the overview
  // table right below, so the chart's bars/labels line up with it pixel for
  // pixel instead of re-deriving the same layout from a separate formula
  // (grid track sizing, gaps...) that can silently drift out of sync.
  function measureColumns(container, wrap, count) {
    const cells = [...container.querySelectorAll('#chart-summary-tbl .chart-col')];
    if (cells.length !== count) return null;
    const wrapLeft = wrap.getBoundingClientRect().left;
    return cells.map(c => {
      const r = c.getBoundingClientRect();
      return { cx: r.left - wrapLeft + r.width / 2, width: r.width };
    });
  }

  function buildChartSvg(w, h, data, si, cols) {
    const padL = 8, padR = 8, padT = 18, padB = 24;
    const nws = data.map(d => d.nw);
    const nwMin = Math.min(...nws), nwMax = Math.max(...nws), nwSpan = (nwMax - nwMin) || 1;
    const barMax = Math.max(1, ...data.map(d => Math.max(d.spent, d.plan, Math.abs(d.net))));
    const step = (w - padL - padR) / data.length;
    const cx = i => cols ? cols[i].cx : padL + step * (i + 0.5);
    const colWidth = i => cols ? cols[i].width : step;
    const lineRegion = h * 0.4;
    const base = h - padB, top = padT + lineRegion, zone = base - top;

    let bars = '';
    data.forEach((d, i) => {
      const cw = colWidth(i);
      const bw = Math.min(15, cw * 0.22);
      const hp = (d.plan / barMax) * zone, hr = (d.spent / barMax) * zone, hn = (Math.abs(d.net) / barMax) * zone;
      if (i === si) bars += `<rect x="${cx(i) - cw / 2 + 1}" y="${padT - 12}" width="${cw - 2}" height="${h - padB - padT + 14}" fill="var(--chip)" opacity="0.55" rx="10"/>`;
      bars += `<rect x="${cx(i) - bw * 1.55}" y="${base - hp}" width="${bw}" height="${Math.max(1.5, hp)}" fill="var(--chip)" rx="3"/>`;
      bars += `<rect x="${cx(i) - bw * 0.5}" y="${base - hr}" width="${bw}" height="${Math.max(1.5, hr)}" fill="${d.spent > d.plan ? 'var(--acc)' : 'var(--acc-soft)'}" rx="3"/>`;
      bars += `<rect x="${cx(i) + bw * 0.55}" y="${d.net >= 0 ? base - hn : base}" width="${bw}" height="${Math.max(1.5, hn)}" fill="${d.net >= 0 ? 'var(--green-soft)' : 'var(--acc-soft)'}" rx="3"/>`;
      bars += `<text x="${cx(i)}" y="${h - 7}" fill="${i === si ? 'var(--ink)' : 'var(--sub)'}" font-size="11.5" font-weight="${i === si ? 800 : 700}" text-anchor="middle">${MN[Number(d.key.split('-')[1]) - 1].replace('.', '')}</text>`;
    });

    const lineTop = padT, lineBottom = padT + lineRegion - 14;
    const ly = v => lineTop + (1 - (v - nwMin) / nwSpan) * (lineBottom - lineTop);
    const pts = data.map((d, i) => [cx(i), ly(d.nw)]);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = path + ' L' + pts[pts.length - 1][0] + ' ' + lineBottom + ' L' + pts[0][0] + ' ' + lineBottom + ' Z';
    const dots = pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === si ? 6 : 3.5}" fill="var(--surface)" stroke="var(--green)" stroke-width="3"/>`).join('');

    return `
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
        <rect x="${padL}" y="${base}" width="${w - padL - padR}" height="1.5" fill="var(--line)"/>
        ${bars}
        <path d="${area}" fill="var(--green)" opacity="0.1"/>
        <path d="${path}" fill="none" stroke="var(--green)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        <text x="${padL + 2}" y="${lineTop - 4}" fill="var(--sub)" font-size="11" font-weight="800">${money(nwMax)}</text>
        <text x="${padL + 2}" y="${lineBottom}" fill="var(--sub)" font-size="11" font-weight="800">${money(nwMin)}</text>
      </svg>
    `;
  }

  // Groups slots into [{group, slots:[...]}], in the order the groups are
  // configured. A slot whose group no longer exists falls back to "Autres"
  // rather than disappearing along with its money.
  function groupSlots(slots, config) {
    const configOrder = (config.categoryGroups || []).map(g => g.name).filter(g => g !== 'Revenus');
    const byGroup = new Map();
    slots.forEach(slot => {
      const { group } = parseSlotKey(slot);
      const g = configOrder.includes(group) ? group : 'Autres';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(slot);
    });
    const ordered = [...configOrder.filter(g => byGroup.has(g)), ...[...byGroup.keys()].filter(g => !configOrder.includes(g))];
    return ordered.map(g => ({ group: g, slots: byGroup.get(g) }));
  }

  // Pairs each month's displayed amount with whether it came from the budget
  // rather than from a real transaction.
  function effectiveVals(realVals, planVals) {
    const estimated = realVals.map((v, i) => !v && planVals[i] > 0);
    return { vals: realVals.map((v, i) => estimated[i] ? planVals[i] : v), estimated };
  }

  // Orders names by their position in the group's configured subcategory
  // list (so a drag-and-drop reorder sticks); anything not yet in the group
  // (freshly imported, uncategorized) falls back to sorted-by-amount, after
  // the known ones.
  function sortWithinGroup(slots, groupDef, valuesBySlot) {
    const byAmount = (a, b) => (valuesBySlot[b] || 0) - (valuesBySlot[a] || 0);
    if (!groupDef) return [...slots].sort(byAmount);
    const order = groupDef.subcategories;
    const rank = (slot) => order.indexOf(parseSlotKey(slot).category);
    return [...slots].sort((a, b) => {
      const ia = rank(a), ib = rank(b);
      if (ia === -1 && ib === -1) return byAmount(a, b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }

  function renderTable(active, keys, si, config, todayKey, data) {
    const plans = active.filter(r => r.kind === 'planifie');
    const expSlots = {}, incSlots = {};
    keys.forEach(k => {
      const sc = calc.spentBySlot(active, k); Object.keys(sc).forEach(s => expSlots[s] = (expSlots[s] || 0) + sc[s]);
      const ic = calc.incomeBySlot(active, k); Object.keys(ic).forEach(s => incSlots[s] = (incSlots[s] || 0) + ic[s]);
    });
    plans.forEach(p => {
      const slot = calc.slotOf(p);
      if (!(slot in expSlots) && !(slot in incSlots)) expSlots[slot] = 0;
    });

    const todayIdx = keys.indexOf(todayKey);
    // Absolutely-positioned overlays instead of literal border-left/border-right/
    // background: a real border/background on a cell only paints that cell's own
    // box, which sits 1-1.5px below the row's top edge (eaten by .tbl-row's own
    // border-top separator) — leaving a 1px seam between rows. Stretching the
    // overlay 2px above the cell's own box (top:-2px) reaches up into that
    // separator's territory, so the column/row-block reads as one unbroken line.
    // offset shifts the bar past the cell's own edge into the grid's 2px
    // inter-column gutter, so it doesn't sit flush against the cell's number/
    // text (which only has its normal padding to breathe, not extra room for
    // a literal border like before).
    const vBar = (side, color, offset = 0) => `<span style="position:absolute; top:-2px; bottom:0; ${side}:${offset}px; width:3px; background:${color}; pointer-events:none;"></span>`;
    const highlightFill = (active, radius = '0') => active ? `<span style="position:absolute; top:-2px; bottom:0; left:0; right:0; background:var(--highlight); border-radius:${radius}; z-index:-1; pointer-events:none;"></span>` : '';
    const boundary = i => i === todayIdx ? vBar('right', 'var(--acc-soft)', -2) : '';
    // Section header rows only render the label cell (no month columns), so
    // without this, the today-boundary line and the selected-month highlight
    // would vanish for the row's height at every category group header.
    const placeholderCells = () => keys.map((k, i) => `<div style="position:relative;">${highlightFill(i === si)}${boundary(i)}</div>`).join('');

    const headCells = keys.map((k, i) => `<div style="position:relative; text-align:right; font-size:11px; font-weight:800; text-transform:capitalize; padding:6px 5px; color:${i === si ? 'var(--ink)' : 'var(--sub)'};">${highlightFill(i === si, '6px 6px 0 0')}${boundary(i)}${MN[Number(k.split('-')[1]) - 1].replace('.', '')}</div>`).join('');

    function catBorder(kind) {
      if (kind === 'income') return vBar('left', 'var(--green)');
      if (kind === 'expense') return vBar('left', 'var(--acc)');
      return '';
    }

    function row(name, vals, opts = {}) {
      const total = vals.reduce((a, v) => a + v, 0);
      const nz = vals.filter(v => v !== 0).length || 1;
      const emoji = opts.emoji || resolveEmoji(config, name);
      const isCategoryRow = opts.indent && !opts.strong;
      const cells = vals.map((v, i) => {
        if (!isCategoryRow) {
          return `<div class="tbl-cell" style="color:${v === 0 ? 'var(--muted-num)' : (opts.pos ? 'var(--green)' : 'var(--ink)')};">${highlightFill(i === si)}${boundary(i)}${v === 0 ? '·' : num0(v)}</div>`;
        }
        const plan = opts.planVals ? opts.planVals[i] : 0;
        const month = keys[i];
        // Substituted from the budget because nothing real landed here.
        const estimated = opts.estimated ? opts.estimated[i] : false;
        const realColor = estimated ? 'var(--sub)'
          : v === 0 ? 'var(--muted-num)'
          : (plan > 0 ? budgetGradient(v / plan, opts.pos) : (opts.pos ? 'var(--green)' : 'var(--ink)'));
        // The planned line is always in the DOM (empty when unset) so every
        // category row is the same height whether or not it has a budget —
        // and so opening the editor over a cell can never resize the row.
        const body = `
          <span class="plan-real ${estimated ? 'is-estimate' : ''}" style="color:${realColor};">${v === 0 ? '·' : num0(v)}</span>
          <span class="plan-planned">${plan > 0 ? num0(plan) : ''}</span>
          <span class="plan-fill-dot" data-plan-fill title="Étendre cette valeur sur d'autres mois"></span>
        `;
        const tip = estimated
          ? `${name} · ${ymLabel(month)} — aucune transaction réelle : le budget de ${num0(plan)} est compté dans les totaux. Cliquer pour le modifier.`
          : `${name} · ${ymLabel(month)} — réel ${num0(v)}${plan > 0 ? `, budget ${num0(plan)}` : ''}. Cliquer pour définir le budget.`;
        return `<div class="tbl-cell plan-cell" data-plan-cell data-plan-slot="${escapeHtml(opts.slot || '')}" data-plan-month="${month}" data-plan-idx="${i}" data-plan-value="${plan || ''}" title="${escapeHtml(tip)}">${highlightFill(i === si)}${boundary(i)}${body}</div>`;
      }).join('');

      const draggable = opts.dragGroup ? `draggable="true" data-drag-type="category" data-drag-name="${escapeHtml(name)}" data-drag-group="${escapeHtml(opts.dragGroup)}" data-drag-emoji="${escapeHtml(emoji)}"` : '';
      const emojiCell = opts.dragGroup
        ? `<span class="tbl-emoji-btn" data-emoji-edit="${escapeHtml(name)}" title="Changer l'emoji">${emoji}</span>`
        : `<span style="width:20px; text-align:center; display:inline-block;">${emoji}</span>`;
      const nameCell = opts.dragGroup
        ? `<span class="tbl-row-title" data-rename-type="category" data-name="${escapeHtml(name)}" data-group="${escapeHtml(opts.dragGroup)}" title="Cliquer pour renommer · glisser la poignée pour déplacer">${escapeHtml(name)}</span>`
        : `<span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(name)}</span>`;

      return `
        <div class="tbl-row ${opts.strong ? 'strong' : ''}" ${draggable} style="grid-template-columns: 180px repeat(${keys.length}, minmax(52px, 1fr)) 74px 66px;">
          <div class="tbl-label" style="background:${opts.strong ? 'var(--surface-strong)' : 'var(--surface)'}; padding-left:${opts.indent ? '12px' : '0'};">${catBorder(opts.kind)}${opts.dragGroup ? dragGrip() : ''}${emojiCell}${nameCell}</div>
          ${cells}
          <div class="tbl-cell" style="font-weight:900; color:${opts.pos ? 'var(--green)' : 'var(--ink)'};">${num0(total)}</div>
          <div class="tbl-cell" style="color:var(--sub); font-weight:700;">${num0(total / (opts.avgAll ? 12 : nz))}</div>
        </div>
      `;
    }
    function section(label, groupName, kind) {
      const draggable = groupName ? `draggable="true" data-drag-type="group" data-drag-name="${escapeHtml(groupName)}"` : '';
      const mark = groupName ? resolveGroupEmoji(config, groupName) : null;
      const titleInner = groupName
        ? `${mark ? `<span class="tbl-group-emoji">${mark}</span>` : ''}<span class="tbl-row-title" data-rename-type="group" data-name="${escapeHtml(groupName)}" title="Cliquer pour renommer · glisser la poignée pour réordonner">${escapeHtml(label)}</span>`
        : escapeHtml(label);
      return `<div class="tbl-row section" ${draggable} style="grid-template-columns: 180px repeat(${keys.length}, minmax(52px, 1fr)) 74px 66px;"><div class="tbl-label" style="font-size:10.5px; font-weight:400; letter-spacing:.14em; text-transform:uppercase; color:var(--acc); padding-left:4px;">${catBorder(kind)}${groupName ? dragGrip() : ''}${titleInner}</div>${placeholderCells()}</div>`;
    }

    function dragGrip() {
      return `<span class="drag-grip" data-drag-grip title="Glisser pour déplacer" aria-hidden="true"></span>`;
    }

    // One line per (group, category): the plans, the real amounts and the
    // budget cells all look themselves up by that pair, so the "Restaurants"
    // of a trip keeps its own row, its own budget and its own total next to
    // the everyday one.
    function lineFor(slot, bySlot, group, kind) {
      const { category } = parseSlotKey(slot);
      const ps = plans.filter(p => calc.slotOf(p) === slot);
      const planPer = keys.map(k => calc.plannedForCategory(ps, k));
      const { vals, estimated } = effectiveVals(keys.map(k => bySlot(active, k)[slot] || 0), planPer);
      return row(category, vals, {
        indent: true, dragGroup: group, kind, planVals: planPer, estimated,
        pos: kind === 'income', slot,
      });
    }

    let body = '';
    if (Object.keys(incSlots).length) {
      body += section('Revenus', 'Revenus', 'income');
      const revGroup = (config.categoryGroups || []).find(g => g.name === 'Revenus');
      sortWithinGroup(Object.keys(incSlots), revGroup, incSlots)
        .forEach(slot => { body += lineFor(slot, calc.incomeBySlot, 'Revenus', 'income'); });
    }

    groupSlots(Object.keys(expSlots), config).forEach(({ group, slots }) => {
      const dragGroup = group === 'Autres' ? null : group;
      body += section(group, dragGroup, 'expense');
      const groupDef = (config.categoryGroups || []).find(g => g.name === group);
      sortWithinGroup(slots, groupDef, expSlots)
        .forEach(slot => { body += lineFor(slot, calc.spentBySlot, dragGroup, 'expense'); });
    });

    // Totals read straight off the same effective figures the rows show, so
    // the column adds up to what is printed above it.
    let foot = '';
    foot += row('Total dépensé', data.map(d => d.spent), { emoji: icon('receipt'), strong: true, avgAll: true });
    foot += row('Ajouté au compte', data.map(d => d.net), { emoji: icon('banknote'), strong: true, avgAll: true });
    foot += row('Ajustements', data.map(d => d.adj), { emoji: icon('scale'), avgAll: true });
    foot += row('Total', data.map(d => d.nw), { emoji: icon('landmark'), strong: true, avgAll: true });

    // Years span their months above the header, which is where the month
    // band used to carry them before it was folded into this table.
    const yearSpans = [];
    for (const k of keys) {
      const year = k.slice(0, 4);
      if (yearSpans.length && yearSpans[yearSpans.length - 1].year === year) yearSpans[yearSpans.length - 1].count++;
      else yearSpans.push({ year, count: 1 });
    }

    return `
      <div class="tbl">
        <div class="tbl-row tbl-year-row" style="grid-template-columns: 180px repeat(${keys.length}, minmax(52px, 1fr)) 74px 66px;">
          <div class="tbl-label" style="background:var(--surface);"></div>
          ${yearSpans.map(g => `<div class="tbl-year" style="grid-column: span ${g.count};">${g.year}</div>`).join('')}
          <div></div><div></div>
        </div>
        <div class="tbl-row tbl-head-row" style="grid-template-columns: 180px repeat(${keys.length}, minmax(52px, 1fr)) 74px 66px; border-bottom:1.5px solid var(--line);">
          <div style="position:sticky; left:0; background:var(--surface); font-size:11px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--sub); padding:6px 8px 6px 0;">Catégorie</div>
          ${headCells}
          <div style="text-align:right; font-size:11px; font-weight:800; text-transform:uppercase; color:var(--sub); padding:6px 4px;">Total</div>
          <div style="text-align:right; font-size:11px; font-weight:800; text-transform:uppercase; color:var(--sub); padding:6px 0 6px 4px;">Moy.</div>
        </div>
        ${body}
        <div class="tbl-foot">${foot}</div>
      </div>
    `;
  }

  function lastDataMonth(active) {
    const last = active.filter(r => r.date && (r.kind === 'reel' || r.kind === 'ajustement' || r.kind === 'solde')).map(r => r.date).sort().pop();
    return last ? last.slice(0, 7) : null;
  }

  function wireEvents(container, { winEnd }) {
    container.querySelector('[data-action="prev-win"]')?.addEventListener('click', () => {
      store.setDashboardWindow(shift(winEnd, -1));
    });
    container.querySelector('[data-action="next-win"]')?.addEventListener('click', () => {
      store.setDashboardWindow(shift(winEnd, 1));
    });
    container.querySelector('[data-action="start-month"]')?.addEventListener('change', (e) => {
      store.setStartMonth(e.target.value || null);
    });
    container.querySelector('[data-action="clear-start-month"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      store.setStartMonth(null);
    });

    wireDragAndDrop(container);
    wireInlineEditing(container);
    wireEmojiEdit(container);
    wirePlanFillDrag(container);
  }

  // ---------- inline editing (see lib/inlineEdit.js) ----------
  function findPlanCell(slot, month) {
    return [...document.querySelectorAll('[data-plan-cell]')]
      .find(c => c.dataset.planSlot === slot && c.dataset.planMonth === month) || null;
  }

  // A budget belongs to one line of the dashboard, so it is addressed by the
  // (group, category) pair the cell sits on — two categories sharing a name
  // must not write into each other's budget.
  function editPlanCell(slot, month) {
    const cell = findPlanCell(slot, month);
    if (!cell) return;
    const current = cell.dataset.planValue ? Number(cell.dataset.planValue) : null;
    const box = cell.getBoundingClientRect();
    openInlineEdit(cell, { left: box.left + 1, top: box.top + 1, width: box.width - 2, height: box.height - 2 }, {
      value: current == null ? '' : String(current),
      className: 'plan-cell-input',
      align: 'right',
      onTab: (back) => stepPlanCell(slot, month, back ? -1 : 1),
      onCommit: async (raw) => {
        const next = parseFormula(raw);
        // Writing an unchanged value would persist the file and re-render the
        // whole app for nothing — the single biggest source of "it jumps".
        if ((next ?? null) === (current ?? null)) return;
        const { group, category } = parseSlotKey(slot);
        await store.setPlannedCell(category, month, next, group);
      },
    });
  }

  function stepPlanCell(slot, month, dir) {
    const cells = [...document.querySelectorAll('[data-plan-cell]')].filter(c => c.dataset.planSlot === slot);
    const i = cells.findIndex(c => c.dataset.planMonth === month);
    const next = cells[i + dir];
    if (next) editPlanCell(slot, next.dataset.planMonth);
  }

  function editTitle(span) {
    const type = span.dataset.renameType;
    const name = span.dataset.name;
    const host = span.closest('.tbl-label');
    if (!host) return;
    const hostBox = host.getBoundingClientRect();
    const spanBox = span.getBoundingClientRect();
    // Stretches from the title's own left edge to the label column's right
    // edge, so a long name has room to be typed without the box growing.
    openInlineEdit(host, {
      left: spanBox.left - 3,
      top: spanBox.top - 3,
      width: Math.max(60, hostBox.right - spanBox.left - 3),
      height: spanBox.height + 6,
    }, {
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

  function wireInlineEditing(container) {
    // Single click (it used to take a double click, which nobody discovers).
    container.querySelectorAll('[data-rename-type]').forEach(span => {
      span.addEventListener('click', (e) => { e.stopPropagation(); editTitle(span); });
    });

    // Click a 12-month-table cell to type (or "=formula") its planned amount
    // for that exact category+month; Tab/Shift+Tab walk the row month by
    // month so a year of budget can be typed without touching the mouse.
    // Opening on mousedown (rather than click) so moving straight from one
    // cell to the next commits the first and opens the second in one gesture
    // — on click, the commit's re-render destroys the node mid-gesture and
    // the click never lands.
    container.querySelectorAll('[data-plan-cell]').forEach(cell => {
      cell.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('[data-plan-fill]')) return;
        e.preventDefault();
        const { planSlot, planMonth } = cell.dataset;
        Promise.resolve(commitInlineEdit()).then(() => editPlanCell(planSlot, planMonth));
      });
    });
  }

  function wireEmojiEdit(container) {
    container.querySelectorAll('[data-emoji-edit]').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = span.dataset.emojiEdit;
        openEmojiPicker(span, {
          onSelect: (emoji) => store.setCategoryEmoji(name, emoji),
        });
      });
    });
  }

  // ---------- drag and drop ----------
  function wireDragAndDrop(container) {
    container.querySelectorAll('[data-drag-type]').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        closeInlineEdit();
        dragState = { type: el.dataset.dragType, name: el.dataset.dragName, group: el.dataset.dragGroup || null };
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragState.name);
        e.dataTransfer.setDragImage(...makeDragImage(el));
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        clearDropIndicators(container);
        dragState = null;
      });
    });

    // dragover/drop are delegated to the container: per-row dragleave
    // handlers made the drop indicator flicker every time the pointer
    // crossed from one cell of a row into the next.
    if (container.__dndWired) return;
    container.__dndWired = true;
    container.addEventListener('dragover', (e) => {
      const target = dropTarget(e);
      clearDropIndicators(container);
      if (!target) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      target.el.classList.add(target.into ? 'drag-over-into' : target.before ? 'drag-over-top' : 'drag-over-bottom');
    });
    container.addEventListener('drop', async (e) => {
      const target = dropTarget(e);
      clearDropIndicators(container);
      if (!target) return;
      e.preventDefault();
      // The group the row was dragged *from* is read here, while the gesture
      // still exists: it is what tells apart two categories sharing a name,
      // and dropping used to lose it by clearing the state one line early.
      const { name, type, group: from } = dragState;
      dragState = null;
      if (type === 'group') await dropGroup(name, target);
      else await dropCategory(name, target, from);
    });
  }

  function clearDropIndicators(container) {
    container.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over-into')
      .forEach(x => x.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into'));
  }

  // Resolves what the pointer is currently over into a drop intent, or null
  // when the drop would be a no-op. A category dropped onto a *group header*
  // means "put it in this group" — the only way to reach a group that has no
  // rows to aim at yet.
  function dropTarget(e) {
    if (!dragState) return null;
    const el = e.target.closest?.('[data-drag-type]');
    if (!el) return null;
    const rowType = el.dataset.dragType;
    if (dragState.type === 'group' && rowType !== 'group') return null;
    if (dragState.type === 'category' && rowType === 'group') {
      return { el, group: el.dataset.dragName, into: true };
    }
    if (dragState.type !== rowType) return null;
    if (el.dataset.dragName === dragState.name) return null;
    const rect = el.getBoundingClientRect();
    return { el, name: el.dataset.dragName, group: el.dataset.dragGroup, before: e.clientY < rect.top + rect.height / 2 };
  }

  async function dropGroup(moved, target) {
    // Built from the *config* order, not from the rows on screen: groups with
    // no visible category aren't rendered, and reordering off the DOM list
    // silently shoved every one of them to the end of the budget.
    const all = (store.state.config.categoryGroups || []).map(g => g.name);
    await store.reorderCategoryGroups(moveInList(all, moved, target.name, target.before));
  }

  async function dropCategory(moved, target, from) {
    if (target.into) return store.moveCategory(moved, target.group, null, from);
    const siblings = [...document.querySelectorAll('[data-drag-type="category"]')]
      .filter(x => x.dataset.dragGroup === target.group)
      .map(x => x.dataset.dragName)
      .filter(n => n !== moved); // ...or dropping a row one slot down landed it at the end of the group
    const i = siblings.indexOf(target.name);
    const beforeName = target.before ? target.name : (siblings[i + 1] || null);
    await store.moveCategory(moved, target.group, beforeName, from);
  }

  // A small labelled pill rather than a clone of the row: a cloned row still
  // carries `position:sticky` on its label cell, which — once the clone is
  // parented to <body> — snaps that label to the viewport's left edge, i.e.
  // out of the snapshot, leaving a drag preview of empty grid columns.
  function makeDragImage(el) {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    // A group has no emoji of its own, so it borrows the folder icon; a
    // category carries its own, which is plain text and must be escaped.
    const mark = el.dataset.dragType === 'group' ? icon('folderOpen') : escapeHtml(el.dataset.dragEmoji || '');
    ghost.innerHTML = `<span>${mark}</span><span>${escapeHtml(el.dataset.dragName || '')}</span>`;
    document.body.appendChild(ghost);
    setTimeout(() => ghost.remove(), 0);
    return [ghost, 18, 16];
  }

  function wirePlanFillDrag(container) {
    let fill = null;

    function onMove(e) {
      if (!fill) return;
      // Tracked by x against each cell's own box rather than by hit-testing
      // the point: dragging along the row a few pixels above or below the
      // cells (easy to do — they are 30px tall) used to just stop extending
      // the selection, and dropping there filled the wrong range.
      const idx = nearestCellIndex(fill.cells, e.clientX);
      const lo = Math.min(idx, fill.sourceIdx), hi = Math.max(idx, fill.sourceIdx);
      fill.cells.forEach((c, i) => c.classList.toggle('plan-fill-target', i >= lo && i <= hi));
      fill.count = hi - lo;
    }

    function nearestCellIndex(cells, x) {
      let best = 0, bestDist = Infinity;
      cells.forEach((c, i) => {
        const r = c.getBoundingClientRect();
        const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
        if (d < bestDist) { bestDist = d; best = i; }
      });
      return best;
    }

    async function onUp() {
      if (!fill) return;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const targetMonths = fill.cells
        .filter(c => c.classList.contains('plan-fill-target') && Number(c.dataset.planIdx) !== fill.sourceIdx)
        .map(c => c.dataset.planMonth);
      fill.cells.forEach(c => c.classList.remove('plan-fill-target'));
      const { slot, value } = fill;
      fill = null;
      if (targetMonths.length) {
        await store.setPlannedCells(targetMonths.map(month => ({ ...parseSlotKey(slot), month, amount: value })));
      }
    }

    container.querySelectorAll('[data-plan-fill]').forEach(dot => {
      dot.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeInlineEdit();
        const cell = dot.closest('[data-plan-cell]');
        fill = {
          slot: cell.dataset.planSlot,
          sourceIdx: Number(cell.dataset.planIdx),
          value: cell.dataset.planValue ? Number(cell.dataset.planValue) : 0,
          cells: [...cell.closest('.tbl-row').querySelectorAll('[data-plan-cell]')],
        };
        // Keeps the handle lit for the whole gesture, even once the pointer
        // has left the source cell it belongs to.
        cell.classList.add('filling');
        onMove(e);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', () => cell.classList.remove('filling'), { once: true });
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  return { render };
}
