// fleet.mjs: builds what the page shows from files only (history, logs, pause files, asks). It never calls an agent:
// the sampler does that, on its own clock. So opening the page ten times costs the agents nothing.
import fs from 'node:fs';
import { ADAPTERS } from '../adapters/index.mjs';
import { strip, stripXp, output, latest, lastGood } from './history.mjs';
import { logFacts } from './logs.mjs';
import { mask } from './mask.mjs';

export const PLACE_MAX_AGE = 20 * 60_000;
// Seven colours that stay apart from each other and from the panels; skills past seven share "other".
export const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
export const OTHER = '#6e6680';
// Paused = a PAUSE file exists and its `until` (if it has one) hasn't passed. Same rule as city-driver-starter's driver
// and agent-owner-controls' isPaused(): an expired PAUSE is left in place on purpose and simply stops counting.
// No `until`, an empty file, or a file that isn't JSON: paused until someone deletes it.
export function pausedNow(file, now) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8').trim(); } catch { return false; }
  let until = NaN;
  try { const p = raw ? JSON.parse(raw) : null; if (p && typeof p === 'object' && p.until) until = Date.parse(p.until); } catch { /* not JSON: paused */ }
  return !(Number.isFinite(until) && now > until);
}
const mins = (ms) => Math.round(ms / 60_000);
const span = (m) => (m < 120 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

// One colour per skill, the same on every card and graph. Pinned colours (config, then the adapter's) first; the rest
// go to unused slots by XP in the last 24 hours, so the busiest skills get their own colour.
export function skillColors(config, recs, now) {
  const colors = {};
  const taken = new Set();
  for (const src of [config.skillColors, ...new Set(config.agents.map((a) => ADAPTERS[a.adapter].skillColors).filter(Boolean))]) {
    for (const [k, v] of Object.entries(src ?? {})) if (!colors[k] && !taken.has(v.toLowerCase())) { colors[k] = v; taken.add(v.toLowerCase()); }
  }
  const out = output(recs, config.agents.map((a) => a.key), now);
  const free = PALETTE.filter((c) => !taken.has(c.toLowerCase()));
  for (const { skill } of out.skills) if (!colors[skill] && free.length) colors[skill] = free.shift();
  const rank = (c) => { const i = PALETTE.indexOf(c); return i < 0 ? PALETTE.length : i; };
  const order = Object.keys(colors).sort((x, y) => rank(colors[x]) - rank(colors[y]) || x.localeCompare(y));
  return { colors, order, other: OTHER };
}

export function agentStatus(a, recs, now, sampleMinutes) {
  const lf = logFacts(a, now);
  const paused = Boolean(a.pauseFile && pausedNow(a.pauseFile, now));
  const last = latest(recs, a.key, Math.max(PLACE_MAX_AGE, 3 * sampleMinutes * 60_000), now);
  const good = lastGood(recs, a.key);
  const why = []; let light = 'green';
  const red = (m) => { light = 'red'; why.push(m); };
  const yellow = (m) => { if (light !== 'red') light = 'yellow'; why.push(m); };
  if (lf.has && lf.missing) red('no log at the configured path');
  else if (lf.has && !paused && now - lf.lastAt > a.staleMinutes * 60_000) red(`log quiet ${span(mins(now - lf.lastAt))}`);
  if (!lf.has) {
    if (!good) yellow('no reading yet');
    else if (!paused && now - good.t > a.staleMinutes * 60_000) red(`no reading for ${span(mins(now - good.t))}`);
  }
  if (paused) yellow('paused');
  if (last?.err) yellow(`last read failed: ${last.err}`);
  if (lf.has && !lf.missing && lf.warns >= 3) yellow(`${lf.warns} warnings in 15 min`);

  const act = good && now - good.t <= PLACE_MAX_AGE ? good.act : null;
  const doing = paused ? { label: 'paused' } : act?.label ? { label: act.label, detail: act.detail ?? null } : null;
  const place = act?.space ? { space: act.space, name: act.name ?? null, area: act.area ?? null, at: good.t } : null;
  const st = strip(recs, a.key, now);
  return {
    key: a.key, name: a.name, main: a.main, adapter: a.adapter, light, why,
    paused, doing, place, strip: st, xp6: stripXp(st),
    counters: { ...(good?.c ?? {}), ...(lf.counters ?? {}) },
    lastLogAt: lf.has && !lf.missing ? lf.lastAt : null, sampleAt: good?.t ?? null, links: a.links,
  };
}

export function buildFleet(config, records, version, asksOpen, now = Date.now()) {
  const recs = records(now - 24 * 3_600_000);
  const agents = config.agents.map((a) => agentStatus(a, recs, now, config.sampleMinutes));
  const maps = {};
  for (const a of config.agents) { const ad = ADAPTERS[a.adapter]; if (ad.map && !maps[a.adapter]) maps[a.adapter] = ad.map(a); }
  const count = (l) => agents.filter((x) => x.light === l).length;
  return {
    version, now, title: config.title, timeZone: config.timeZone, sampleMinutes: config.sampleMinutes,
    skills: skillColors(config, recs, now), maps,
    totals: { agents: agents.length, green: count('green'), yellow: count('yellow'), red: count('red'), xp6: agents.reduce((n, x) => n + x.xp6, 0), asksOpen },
    lastRound: recs.length ? recs[recs.length - 1].t : null,
    agents,
  };
}

export function agentDetail(config, records, a, now = Date.now()) {
  const recs = records(now - 24 * 3_600_000);
  const base = agentStatus(a, recs, now, config.sampleMinutes);
  const good = lastGood(recs, a.key);
  const lf = config.showLog ? logFacts(a, now) : null;
  return {
    ...base,
    skillsNow: Object.entries(good?.xp ?? {}).sort((x, y) => y[1] - x[1]).map(([skill, xp]) => ({ skill, xp })),
    log: lf?.lines ? lf.lines.slice(-30).map((l) => mask(l).slice(0, 300)) : null,
    staleMinutes: a.staleMinutes,
  };
}

export function outputFor(config, records, key, now = Date.now()) {
  const keys = key === 'fleet' ? config.agents.map((a) => a.key) : [key];
  const recs = records(now - 24 * 3_600_000);
  const o = output(recs, keys, now);
  return { key, name: key === 'fleet' ? 'Whole fleet' : config.agents.find((a) => a.key === key)?.name, ...o,
    roster: config.agents.map((a) => ({ key: a.key, name: a.name })) };
}
