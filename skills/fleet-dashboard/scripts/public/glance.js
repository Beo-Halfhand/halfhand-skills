// fleet-dashboard: the at-a-glance band and the page loop, shared by / and /m. Reads /api/fleet every 15 s and
// hands it to every part of the page as the 'fd:fleet' event.
'use strict';
(() => {
  const { h, compact, ago, setZone, setSkills, poll, $ } = window.fd;
  const from = document.body.dataset.from || '';
  const order = (l) => ({ red: 0, yellow: 1, green: 2 }[l]);

  function glance(f) {
    const t = f.totals, need = f.agents.filter((a) => a.light !== 'green').sort((x, y) => order(x.light) - order(y.light)).slice(0, 3);
    const tile = (k, v, sub) => h('section', { class: 'g-tile' }, h('div', { class: 'g-k' }, k), h('div', { class: 'g-v' }, v), sub);
    const counts = h('div', { class: 'g-s' }, ...['green', 'yellow', 'red'].flatMap((l) => (t[l] ? [h('span', { class: 'nw' }, h('span', { class: `dot ${l}`, 'aria-hidden': 'true' }), `${t[l]} ${l}`), ' '] : [])));
    return [
      tile('Agents', String(t.agents), counts),
      tile('Needs a look', need.length ? String(t.yellow + t.red) : 'none',
        need.length ? h('div', { class: 'g-need' }, ...need.map((a) => h('a', { href: `/agent?key=${encodeURIComponent(a.key)}${from ? '&from=' + from : ''}` }, h('span', { class: `dot ${a.light}`, 'aria-hidden': 'true' }), ' ', a.name, h('span', { class: 'muted' }, ` · ${a.why[0] ?? ''}`)))) : h('div', { class: 'g-s' }, 'every light is green')),
      tile('XP · last 6 h', `+${compact(t.xp6)}`, h('div', { class: 'g-s' }, `across ${t.agents} agent${t.agents === 1 ? '' : 's'}`)),
      tile('Asks for you', String(t.asksOpen ?? 0), h('div', { class: 'g-s' }, t.asksOpen ? 'waiting on your answer' : 'nothing waiting')),
    ];
  }

  poll((f) => {
    setZone(f.timeZone); setSkills(f.skills);
    document.title = f.title;
    if ($('title')) $('title').textContent = f.title;
    if ($('ver')) $('ver').textContent = `v${f.version}`;
    if ($('glance')) { $('glance').replaceChildren(...glance(f)); $('glance').removeAttribute('aria-busy'); }
    if ($('updated')) $('updated').textContent = f.lastRound ? `last reading ${ago(f.lastRound)}` : 'no readings yet';
    if ($('askBadge')) { $('askBadge').hidden = !f.totals.asksOpen; $('askBadge').textContent = String(f.totals.asksOpen); }
    document.dispatchEvent(new CustomEvent('fd:fleet', { detail: f }));
  }, (e) => { if ($('updated')) $('updated').textContent = 'dashboard unreachable: ' + e.message; });

  // phone tabs
  for (const b of document.querySelectorAll('.tabb')) b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('.tabb')) { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'v-' + b.dataset.v;
    window.scrollTo(0, 0);
  });
})();
