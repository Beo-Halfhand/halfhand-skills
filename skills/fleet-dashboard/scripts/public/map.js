// fleet-dashboard: the agent's own map on Details. A schematic from the adapter (not to scale): every place is named,
// only the agent's place is lit, with its sigil and name in it. Stale or missing position lights nothing; the map
// never guesses. Nothing on it is a link or a button.
'use strict';
window.fdMap = (() => {
  const { h, sigil, clock, ago, zoneName } = window.fd;
  const STALE = 20 * 60_000;

  function render(root, a, map) {
    if (!root) return;
    if (!map) { root.hidden = true; return; }
    root.hidden = false;
    const rooms = map.rooms?.list ?? [], inId = map.rooms?.in ?? null;
    const p = a.place, fresh = p && p.at && Date.now() - p.at <= STALE ? p : null;
    const room = fresh ? rooms.find((r) => r.id === fresh.space || r.also?.includes(fresh.space)) : null;
    const tile = fresh ? map.tiles.find((t) => t.id === fresh.space) : null;
    const litTile = tile?.id ?? (room ? inId : null), elsewhere = fresh && !tile && !room ? fresh : null;
    const here = () => h('div', { class: 'am-here', 'aria-hidden': 'true' }, sigil(a, 26), h('span', { class: 'am-who' }, a.name));
    const parent = map.tiles.find((t) => t.id === inId)?.label ?? '';
    const placeWords = !fresh ? null : room ? `${parent} → ${room.label}` : `${tile?.label ?? fresh.name ?? fresh.space}${fresh.area ? `, at ${fresh.area}` : ''}`;

    const tileEl = (t) => {
      const lit = t.id === litTile, inside = lit && !!room;   // the district is lit as "the way in" when the agent is in one of its buildings
      return h('div', { class: `am-t p-${t.pos}${lit ? (inside ? ' via' : ' lit') : ''}` },
        h('div', { class: 'am-n' }, t.label),
        lit && !inside ? here() : null,
        t.id === inId && rooms.length ? h('div', { class: 'am-rooms' }, ...rooms.filter((r) => !r.onlyIfHere || r === room).map((r) => {
          const on = r === room;
          return h('div', { class: 'am-r' + (on ? ' lit' : '') }, h('div', { class: 'am-rn' }, r.label), on ? here() : null);
        })) : null);
    };
    let status;
    if (fresh) status = [h('div', { class: 'am-now' }, 'Here now: ', h('strong', {}, placeWords)),
      h('div', { class: 'am-age muted' }, `as of ${ago(fresh.at)} (${clock(fresh.at)} ${zoneName()}), from the last reading`)];
    else if (p && p.at) status = [h('div', { class: 'am-now unknown' }, 'Here now: ', h('strong', {}, 'not known')),
      h('div', { class: 'am-age muted' }, `The last position is from ${ago(p.at)}, older than 20 minutes, so nothing is lit.`)];
    else status = [h('div', { class: 'am-now unknown' }, 'Here now: ', h('strong', {}, 'not known')),
      h('div', { class: 'am-age muted' }, `No position for ${a.name} in the last 20 minutes, so nothing is lit. The map does not guess.`)];

    root.replaceChildren(
      h('h2', { class: 'am-title' }, `${a.name} · where in ${map.title} now`),
      h('div', { class: 'amap', role: 'img', 'aria-label': fresh ? `Schematic map of ${map.title}. ${a.name} is here now: ${placeWords}.` : `Schematic map of ${map.title}. ${a.name}'s position is not known.` },
        ...map.tiles.map(tileEl),
        elsewhere ? h('div', { class: 'am-t p-else lit' }, h('div', { class: 'am-n' }, elsewhere.name ?? elsewhere.space), here()) : null),
      ...status,
      h('div', { class: 'am-legend' }, h('span', { class: 'am-sw lit', 'aria-hidden': 'true' }), `Lit = where ${a.name} is now · `, h('span', { class: 'am-sw', 'aria-hidden': 'true' }), 'dimmed = the rest · schematic, not to scale'));
  }
  return { render };
})();
