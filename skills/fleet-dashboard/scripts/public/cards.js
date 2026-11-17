// fleet-dashboard: one card per agent (sigil, name, light, what it's doing, where, a 6-hour XP graph, top two skills).
// Tapping a card opens that agent's Details page. Redraws on 'fd:fleet' (the page's one 15-second read); no fetches.
'use strict';
window.fdCards = (() => {
  const { h, s, fmt, compact, nice, clock, sigil, colorOf, rank } = window.fd;
  const STALE = 20 * 60_000;

  const doing = (a) => (a.doing ? nice(a.doing.label) + (a.doing.detail ? ` · ${nice(a.doing.detail)}` : '') : a.light === 'red' ? 'not reporting' : 'no recent reading');
  const freshPlace = (a) => (a.place && a.place.at && Date.now() - a.place.at <= STALE ? a.place : null);
  function where(a, map) {
    const p = freshPlace(a); if (!p) return null;
    const name = p.name ?? nice(p.space);
    const room = map?.rooms?.list?.find((r) => r.id === p.space || r.also?.includes(p.space));
    const parent = room ? map.tiles.find((t) => t.id === map.rooms.in)?.label : null;
    return (parent ? `${parent} → ${name}` : name) + (p.area ? `, at ${p.area}` : '');
  }

  // the card's graph: 24 bars of 15 minutes, stacked by skill, its own scale (peak printed under it)
  function graph(a) {
    const st = a.strip, N = st?.bins?.length ?? 0, W = 240, H = 48;
    const wrap = h('div', { class: 'ro-graph' });
    if (!N || !st.bins.some((b) => b.cov)) { wrap.append(h('div', { class: 'ro-nograph muted' }, 'no XP history yet')); return { el: wrap, sum: null }; }
    const tot = {}; let all = 0, covered = 0, peak = 0;
    for (const b of st.bins) { let t = 0; if (b.cov) covered++; for (const [k, v] of b.x) { tot[k] = (tot[k] ?? 0) + v; all += v; t += v; } peak = Math.max(peak, t); }
    const top = Object.entries(tot).sort((x, y) => y[1] - x[1]);
    const svg = s('svg', { class: 'ro-svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img',
      'aria-label': all ? `XP in the last 6 hours, 15-minute bars: ${top.slice(0, 3).map(([k, v]) => `${nice(k)} ${Math.round((100 * v) / all)}%`).join(', ')}` : 'No XP in the last 6 hours' });
    const bw = W / N, base = H - 0.5;
    svg.append(s('line', { class: 'ro-base', x1: 0, x2: W, y1: base, y2: base }));
    st.bins.forEach((b, i) => {
      const t = st.t0 + i * st.bin, span = `${clock(t)}–${clock(t + st.bin)}`, x = i * bw + 0.8, w = Math.max(1, bw - 1.6);
      const total = b.x.reduce((m, [, v]) => m + v, 0);
      if (total && peak) {
        const g = s('g', { 'fill-opacity': b.est ? 0.55 : 1 }, s('title', {}, `${span}: ${b.x.map(([k, v]) => `${nice(k)} +${fmt(v)}`).join(', ')}${b.est ? ' (spread over a sampling gap)' : ''}`));
        let y = base;
        for (const [k, v] of b.x.slice().sort((p, q) => rank(p[0]) - rank(q[0]))) { const hh = Math.max(0.8, (v / peak) * (H - 3)); g.append(s('rect', { x, y: y - hh, width: w, height: hh, fill: colorOf(k) })); y -= hh; }
        svg.append(g);
      } else if (!b.cov && t + st.bin < Date.now()) {   // the bar still filling up isn't a gap
        svg.append(s('rect', { class: 'ro-gap', x, y: base - 3, width: w, height: 2.5 }, s('title', {}, `${span}: no readings`)));
      }
    });
    wrap.append(svg, h('div', { class: 'ro-axis muted' }, h('span', {}, '6 h ago'), h('span', {}, peak ? `peak ${compact(peak)} / 15 min` : ''), h('span', {}, 'now')));
    return { el: wrap, sum: { top, all, covered } };
  }
  function key(sum) {
    if (!sum) return h('div', { class: 'ro-key muted' }, 'no history yet');
    if (!sum.all) return h('div', { class: 'ro-key muted' }, 'no XP in the last 6 h');
    const items = sum.top.slice(0, 2).map(([k, v]) => { const sw = h('i', { class: 'sw' }); sw.style.background = colorOf(k); return h('span', { class: 'ro-k' }, sw, `${nice(k)} ${Math.round((100 * v) / sum.all)}%`); });
    return h('div', { class: 'ro-key' }, ...items, h('span', { class: 'ro-xp' }, h('b', {}, `+${compact(sum.all)} XP`), ' · 6 h'));
  }

  function card(a, f, from) {
    const { el: g, sum } = graph(a), map = f.maps?.[a.adapter], wh = where(a, map), now = doing(a);
    const reasons = (a.why ?? []).filter((w) => w !== a.doing?.label), why = a.light !== 'green' && reasons.length ? reasons.join(' · ') : null;   // "paused" once, not twice
    return h('a', { class: `ro-card ${a.light}`, href: `/agent?key=${encodeURIComponent(a.key)}${from ? '&from=' + from : ''}`, 'data-agent': a.key, id: 'card-' + a.key,
      'aria-label': `${a.name}: ${now}${wh ? ', ' + wh : ''}${why ? '. ' + why : ''}. Open details` },
      h('div', { class: 'ro-top' }, sigil(a, 48),
        h('div', { class: 'ro-id' },
          h('div', { class: 'ro-name' }, h('span', { class: `dot ${a.light}`, 'aria-hidden': 'true' }), h('span', { class: 'ro-nm' }, a.name)),
          h('div', { class: 'ro-now' }, now),
          h('div', { class: 'ro-at' + (wh ? '' : ' unknown') }, wh ?? (map ? 'position not known' : '')),
          why ? h('div', { class: 'ro-why' }, why) : null)),
      g, key(sum));
  }
  const order = (agents) => agents.slice().sort((x, y) => (y.main - x.main) || y.xp6 - x.xp6 || x.name.localeCompare(y.name));   // the main agent, then by 6 h XP

  const root = document.getElementById('roster');
  if (root) {
    const from = root.dataset.from || null;
    root.replaceChildren(h('h2', { class: 'sec' }, 'Agents'), h('div', { class: 'sk-line w60' }), h('div', { class: 'sk-line w80' }));
    document.addEventListener('fd:fleet', (e) => {
      const f = e.detail, list = order(f.agents);
      try {
        root.replaceChildren(
          h('h2', { class: 'sec ro-h' }, 'Agents ', h('span', { class: 'muted' }, `· ${list.length}`), h('span', { class: 'sec-note muted' }, 'graph = XP per 15 min, last 6 h · tap a card for details')),
          h('div', { class: 'ro-grid' }, ...list.map((a) => card(a, f, from))));
      } catch (err) { root.replaceChildren(h('p', { class: 'muted' }, 'agent cards unavailable: ' + err.message)); }
    });
  }
  return { doing, where, freshPlace, order };
})();
