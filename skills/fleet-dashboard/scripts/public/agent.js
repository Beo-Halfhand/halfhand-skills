// fleet-dashboard: one agent's Details page (/agent?key=…). Head, 24-hour graph, its map, skills, recent log.
'use strict';
(() => {
  const { h, fmt, nice, ago, clock, zoneName, setZone, setSkills, swatch, getJSON, $ } = window.fd;
  const q = new URLSearchParams(location.search), KEY = (q.get('key') ?? '').toLowerCase(), FROM = q.get('from') === 'm' ? 'm' : '';
  $('back').href = FROM ? '/m' : '/';
  $('output').dataset.key = KEY;
  let maps = {};

  function head(a) {
    const why = a.light !== 'green' && a.why.length ? h('div', { class: 'a-why' + (a.light === 'red' ? ' red' : '') }, a.why.join(' · ')) : null;
    const facts = [];
    for (const [k, v] of Object.entries(a.counters ?? {})) facts.push(h('span', {}, `${nice(k)} `, h('b', {}, fmt(v))));
    facts.push(h('span', {}, 'XP · 6 h ', h('b', {}, `+${fmt(a.xp6)}`)));
    if (a.lastLogAt) facts.push(h('span', {}, 'log ', h('b', {}, ago(a.lastLogAt))));
    facts.push(h('span', {}, 'last reading ', h('b', {}, a.sampleAt ? ago(a.sampleAt) : 'none yet')));
    return [
      h('div', { class: 'a-now' }, h('span', { class: 'muted' }, 'Doing now: '), window.fdCards.doing(a)),
      why, h('div', { class: 'a-facts' }, ...facts),
      a.links?.length ? h('div', { class: 'a-links' }, ...a.links.map((l) => h('a', { href: l.url, rel: 'noopener noreferrer', target: '_blank' }, `${l.label} ↗`))) : null,
    ];
  }
  function skills(a) {
    const gain = {}; for (const b of a.strip?.bins ?? []) for (const [k, v] of b.x) gain[k] = (gain[k] ?? 0) + v;
    if (!a.skillsNow.length) return [h('h2', {}, 'Skills'), h('p', { class: 'muted' }, 'No skills read yet.')];
    return [h('h2', {}, 'Skills ', h('span', { class: 'sec-note muted' }, 'total XP · gained in 6 h')),
      ...a.skillsNow.map(({ skill, xp }) => h('div', { class: 'sk-row' }, swatch(skill), h('span', {}, nice(skill)), h('span', { class: 'n' }, fmt(xp)), h('span', { class: 'g' }, gain[skill] ? `+${fmt(gain[skill])}` : '')))];
  }
  async function load() {
    try {
      const [f, a] = await Promise.all([getJSON('/api/fleet'), getJSON('/api/agent/' + encodeURIComponent(KEY))]);
      setZone(a.timeZone); setSkills(f.skills); maps = f.maps ?? {};
      document.title = `${a.name} · ${a.title}`;
      $('name').textContent = a.name; $('dot').className = `dot ${a.light}`;
      $('head').replaceChildren(...head(a).filter(Boolean));
      window.fdMap.render($('where'), a, maps[a.adapter]);
      $('skills').replaceChildren(...skills(a));
      if (a.log) $('log').replaceChildren(h('h2', {}, 'Recent log ', h('span', { class: 'sec-note muted' }, `last ${a.log.length} lines · keys and home paths masked`)), h('pre', { class: 'logpre' }, a.log.join('\n') || '(empty)'));
      else $('log').hidden = true;
      $('updated').textContent = `as of ${clock(Date.now())} ${zoneName()}`;
    } catch (e) {
      $('name').textContent = KEY || 'unknown agent';
      $('head').replaceChildren(h('p', {}, e.message === 'HTTP 404' ? `No agent "${KEY}" in this dashboard.` : 'Could not load this agent: ' + e.message));
    }
  }
  load(); setInterval(() => { if (!document.hidden) load(); }, 15_000);
})();
