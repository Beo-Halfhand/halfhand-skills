// fleet-dashboard: the last 24 hours of XP, one stacked bar per 30 minutes, for the whole fleet or one agent.
// Mounts on #output. On Details it is pinned to one agent (data-key) with no picker. "Table" shows the same numbers.
'use strict';
(() => {
  const root = document.getElementById('output'); if (!root) return;
  const { h, s, fmt, compact, nice, clock, hourLabel, colorOf, rank, swatch, getJSON } = window.fd;
  const FIXED = root.dataset.key || null;
  const store = { get(k, d) { try { const v = localStorage.getItem('fd:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('fd:' + k, JSON.stringify(v)); } catch { /* private mode */ } } };
  let KEY = FIXED || store.get('outKey', 'fleet'), DATA = null, TABLE = false;
  const niceMax = (v) => { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p; return 10 * p; };

  const sel = h('select', { class: 'out-pick', 'aria-label': 'Whose output', onchange: (e) => { KEY = e.target.value; store.set('outKey', KEY); load(); } });
  const tblBtn = h('button', { class: 'btn small', type: 'button', 'aria-pressed': 'false', onclick: () => { TABLE = !TABLE; tblBtn.setAttribute('aria-pressed', String(TABLE)); tblBtn.textContent = TABLE ? 'Chart' : 'Table'; draw(); } }, 'Table');
  const headline = h('div', { class: 'out-headline' }, 'loading…'), sub = h('div', { class: 'out-sub muted' }), legendEl = h('div', { class: 'out-legend' }), plot = h('div', { class: 'out-plot' });
  root.classList.add('panel');
  root.replaceChildren(h('div', { class: 'out-head' }, h('div', {}, h('div', { class: 'out-eyebrow' }, 'Output · last 24 hours'), headline, sub), h('div', { class: 'out-controls' }, FIXED ? null : sel, tblBtn)), legendEl, plot);

  async function load() {
    try {
      const j = await getJSON('/api/output?key=' + encodeURIComponent(KEY));
      if (j.key !== KEY) return;
      DATA = j; draw();
    } catch (e) {
      if (!FIXED && KEY !== 'fleet') { KEY = 'fleet'; store.set('outKey', KEY); return load(); }
      headline.textContent = 'output unavailable: ' + e.message;
    }
  }
  function draw() {
    const d = DATA; if (!d) return;
    const want = ['fleet', ...d.roster.map((a) => a.key)].join(',');
    if (sel.dataset.keys !== want) { sel.replaceChildren(h('option', { value: 'fleet' }, 'Whole fleet'), ...d.roster.map((a) => h('option', { value: a.key }, a.name))); sel.dataset.keys = want; }
    sel.value = d.key;
    headline.textContent = `+${fmt(d.totals.xp)} XP`;
    const notes = [];
    if (d.historyFrom === null) notes.push('fills in from the next reading');
    else if (d.historyFrom > d.t0) notes.push(`since ${clock(d.historyFrom)} (readings started then)`);
    if (d.totals.peak) notes.push(`peak ${fmt(d.totals.peak)} XP / 30 min`);
    sub.textContent = notes.join(' · ');
    const skills = d.skills.map((x) => x.skill).sort((a, b) => rank(a) - rank(b));
    legendEl.replaceChildren(...(skills.length ? skills.map((k) => h('span', { class: 'li' }, swatch(k), nice(k))) : [h('span', { class: 'li muted' }, 'skills appear as XP is read')]));
    if (TABLE) return drawTable(d);
    drawChart(d, skills);
  }
  function drawChart(d, skills) {
    const W = Math.max(300, plot.clientWidth || root.clientWidth || 800), narrow = W < 560;
    const L = narrow ? 34 : 46, R = 8, PW = W - L - R, N = d.bins.length, bw = PW / N, T = 6, PH = narrow ? 150 : 200, H = T + PH + 24;
    const ymax = niceMax(d.totals.peak), yOf = (v) => T + PH - (v / ymax) * PH;
    const svg = s('svg', { class: 'out-svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${d.name}: ${fmt(d.totals.xp)} XP in the last 24 hours` });
    for (const v of [0, ymax / 2, ymax]) svg.append(s('line', { class: 'grid', x1: L, x2: W - R, y1: yOf(v), y2: yOf(v) }), s('text', { class: 'ax', x: L - 6, y: yOf(v) + 4, 'text-anchor': 'end' }, v ? compact(v) : '0'));
    d.bins.forEach((b, i) => {
      const x = L + i * bw + 1, w = Math.max(1, bw - 2), span = `${clock(b.t)}–${clock(b.t + d.bin)}`;
      if (!b.cov && b.t + d.bin < d.now) { svg.append(s('rect', { class: 'gap', x, y: T, width: w, height: PH }, s('title', {}, `${span}: no readings`))); return; }
      if (!b.total) return;
      const g = s('g', { 'fill-opacity': b.est ? 0.55 : 1 }, s('title', {}, `${span}: +${fmt(b.total)} XP · ${Object.entries(b.xp).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${nice(k)} +${fmt(v)}`).join(', ')}${b.est ? ' (spread over a sampling gap)' : ''}`));
      let y = yOf(0);
      for (const k of skills) { const v = b.xp[k]; if (!v) continue; const hh = (v / ymax) * PH; g.append(s('rect', { x, y: y - hh, width: w, height: Math.max(0.8, hh), fill: colorOf(k) })); y -= hh; }
      svg.append(g);
    });
    const every = narrow ? 12 : 6;   // a label every 6 h on a phone, every 3 h on a desk
    d.bins.forEach((b, i) => { if (i % every === 0) svg.append(s('text', { class: 'ax', x: L + i * bw, y: H - 6 }, hourLabel(b.t))); });
    svg.append(s('text', { class: 'ax', x: W - R, y: H - 6, 'text-anchor': 'end' }, 'now'));
    plot.replaceChildren(svg);
  }
  function drawTable(d) {
    const rows = d.bins.filter((b) => b.total || !b.cov).slice().reverse();
    plot.replaceChildren(h('div', { class: 'out-scroll' }, h('table', { class: 'out-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'From'), h('th', {}, 'XP'), h('th', {}, 'By skill'))),
      h('tbody', {}, ...rows.map((b) => h('tr', {}, h('td', { class: 'nw' }, clock(b.t)), h('td', {}, b.cov ? fmt(b.total) : 'no readings'),
        h('td', {}, Object.entries(b.xp).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${nice(k)} ${fmt(v)}`).join(', ') || '—')))))));
  }
  let rt = null;
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (!TABLE) draw(); }, 120); }).observe(root);
  load(); setInterval(() => { if (!document.hidden) load(); }, 60_000);
})();
