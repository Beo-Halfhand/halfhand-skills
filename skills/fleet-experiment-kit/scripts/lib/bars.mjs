// bars.mjs: a bar is the rule, written before any data, that says what result counts as a win. This file checks a bar's
// shape and turns a row's outcomes into a readout against it. It computes; it never decides.
//
// Bar types (all fractions: 0.15 = +15%):
//   lift         concurrent T vs C. Lift between the groups' medians.        { min, lowerBoundAbove?, stopBelow?, stopAfter? }
//   paired-lift  one agent, windows in pairs, a coin flip picks which arm     { min, lowerBoundAbove?, stopBelow?, stopAfter?, looks?, maxSample? }
//                goes first. Mean of per-pair lifts, one-sided 95% bound.
//   rate         shadow or canary: share of decisions with a flag.            { flag, max, none? }   none: flags that stop it at once
//   count        "it happens at all": confirmed events per week.              { min }                minSample is in days for this type
import { backstopMs, clockFrom } from './register.mjs';
import { rewardGuard } from './guard.mjs';
import { scoreable } from './outcomes.mjs';
import { medianLift, pairedLift, median, pct, num } from './stats.mjs';

export const BAR_TYPES = { lift: ['concurrent'], 'paired-lift': ['paired'], rate: ['shadow', 'single'], count: ['single', 'shadow'] };
const DAY = 86_400_000;
const fin = (x) => typeof x === 'number' && Number.isFinite(x);

export function checkBar(bar, design) {
  const e = [];
  if (!bar || typeof bar !== 'object') return ['bar is missing: write the rule that settles it before any data'];
  const designs = BAR_TYPES[bar.type];
  if (!designs) return [`bar.type must be one of ${Object.keys(BAR_TYPES).join(', ')}`];
  if (design && !designs.includes(design)) e.push(`a ${bar.type} bar needs a ${designs.join(' or ')} design`);
  if (bar.type === 'lift' || bar.type === 'paired-lift') {
    if (!fin(bar.min)) e.push('bar.min must be a number (0.15 = +15%)');
    if (bar.lowerBoundAbove !== undefined && !fin(bar.lowerBoundAbove)) e.push('bar.lowerBoundAbove must be a number');
    if ((bar.stopBelow === undefined) !== (bar.stopAfter === undefined)) e.push('bar.stopBelow and bar.stopAfter go together');
    if (bar.looks !== undefined && !(Array.isArray(bar.looks) && bar.looks.every((n) => Number.isInteger(n) && n > 0))) e.push('bar.looks must be a list of sample sizes');
  }
  if (bar.type === 'rate') {
    if (!(typeof bar.flag === 'string' && bar.flag)) e.push('bar.flag must name the flag being counted (e.g. "fallback")');
    if (!(fin(bar.max) && bar.max > 0 && bar.max <= 1)) e.push('bar.max must be a share above 0, up to 1 (0.01 = 1%)');
    if (bar.none !== undefined && !(Array.isArray(bar.none) && bar.none.every((f) => typeof f === 'string'))) e.push('bar.none must be a list of flags');
  }
  if (bar.type === 'count' && !(fin(bar.min) && bar.min > 0)) e.push('bar.min must be the events per week that count as "it works"');
  return e;
}

// recs: every outcome of this row (any time). now: the review time.
export function evaluate(row, recs, now = Date.now()) {
  const bar = row.bar, clock = clockFrom(row);
  const out = { id: row.id, type: bar.type, metric: row.metric, state: 'too-early', number: null, numberText: 'no data yet', sample: 0, sampleText: '0', enough: false,
    backstopPassed: now > backstopMs(row), stop: null, unscored: { gap: 0, unconfirmed: 0, guard: 0 }, guardDrops: [], projected: null, baseline: null, recent: [] };
  const base = recs.filter((r) => r.arm === 'baseline' && scoreable(r));
  if (base.length) out.baseline = { median: median(base.map((r) => r.value)), n: base.length };
  if (clock === null) { out.numberText = 'not live yet'; return out; }
  const live = recs.filter((r) => r.t >= clock && r.t < now && r.arm !== 'baseline');
  out.recent = live.slice(-6);
  out.unscored.gap = live.filter((r) => r.ok === false).length;
  out.unscored.unconfirmed = live.filter((r) => r.ok !== false && !scoreable(r)).length;
  out.claimed = live.filter((r) => r.ok !== false).length;
  let ok = live.filter(scoreable);
  if (bar.type === 'lift' || bar.type === 'paired-lift') {
    const g = rewardGuard(ok, { allowNegative: !!bar.allowNegative });
    ok = g.keep; out.guardDrops = g.dropped; out.unscored.guard = g.dropped.length;
  }
  out.scored = ok.length;
  const unit = bar.unit ?? 'outcomes';

  if (bar.type === 'lift') {
    const T = ok.filter((r) => r.arm === 'T').map((r) => r.value), C = ok.filter((r) => r.arm === 'C').map((r) => r.value);
    const m = medianLift(T, C, { seed: row.id });
    out.sample = Math.min(T.length, C.length); out.sampleText = `${T.length} T vs ${C.length} C ${unit}`; out.number = m.lift;
    out.numberText = m.lift === null ? 'no lift yet (one side has no data)' : `median ${row.metric} ${pct(m.lift)} (T ${num(m.t)} vs C ${num(m.c)}; 95% lower bound ${pct(m.lb)})`;
    out.lb = m.lb;
    judge(out, row, (x) => x.number >= bar.min && (bar.lowerBoundAbove === undefined || (x.lb ?? -Infinity) > bar.lowerBoundAbove));
  } else if (bar.type === 'paired-lift') {
    const byPair = new Map();
    for (const r of ok) { if (!r.pair) continue; const p = byPair.get(r.pair) ?? {}; if (p[r.arm] === undefined) p[r.arm] = r.value; byPair.set(r.pair, p); }
    const pairs = [...byPair.values()].filter((p) => p.T !== undefined && p.C !== undefined).map((p) => ({ t: p.T, c: p.C }));
    const pl = pairedLift(pairs);
    out.sample = pl.n; out.sampleText = `${pl.n} complete pairs`; out.number = pl.lift; out.lb = pl.lb;
    out.numberText = pl.lift === null ? 'no complete pair yet' : `mean ${row.metric} lift ${pct(pl.lift)} over pairs (one-sided 95% lower bound ${pct(pl.lb)}${pl.n < 20 ? ', rough under 20 pairs' : ''})`;
    if (bar.looks) { const next = bar.looks.find((n) => n > pl.n); out.nextLook = next ?? null; }
    judge(out, row, (x) => x.number >= bar.min && (bar.lowerBoundAbove === undefined || (x.lb ?? -Infinity) > bar.lowerBoundAbove));
    if (bar.maxSample && pl.n >= bar.maxSample && out.state === 'too-early') out.state = 'not-met';
  } else if (bar.type === 'rate') {
    const n = ok.length, k = ok.filter((r) => r.flags?.includes(bar.flag)).length;
    const bad = (bar.none ?? []).map((f) => [f, ok.filter((r) => r.flags?.includes(f)).length]);
    const others = [...new Set(ok.flatMap((r) => r.flags ?? []))].filter((f) => f !== bar.flag && !(bar.none ?? []).includes(f));
    out.sample = n; out.sampleText = `${n} ${unit}`; out.number = n ? k / n : null;
    out.numberText = `${bar.flag} ${n ? pct(k / n, 2).replace('+', '') : 'n/a'} (${k} of ${n})${others.map((f) => `, ${f} ${ok.filter((r) => r.flags?.includes(f)).length}`).join('')}${bad.map(([f, c]) => `, ${f} ${c}`).join('')}`;
    const hit = bad.filter(([, c]) => c > 0);
    if (hit.length) out.stop = `${hit.map(([f, c]) => `${c} ${f}`).join(', ')}: this bar allows none`;
    judge(out, row, (x) => x.number < bar.max);
  } else if (bar.type === 'count') {
    const days = Math.max(0, (Math.min(now, backstopMs(row)) - clock) / DAY), n = ok.length;
    out.sample = Math.floor(days * 10) / 10; out.sampleText = `${num(days)} days`; out.number = days > 0 ? (n / days) * 7 : null;
    out.numberText = `${n} confirmed in ${num(days)} days = ${num(out.number)} a week`;
    judge(out, row, (x) => x.number >= bar.min);
  }

  // Pace: at this rate, will the minimum sample arrive before the backstop?
  if (bar.type !== 'count' && !out.enough && now > clock) {
    out.projected = Math.floor(out.sample * ((backstopMs(row) - clock) / (now - clock)));
  }
  return out;
}

function judge(out, row, met) {
  const bar = row.bar;
  out.enough = out.sample >= row.minSample;
  if (bar.stopBelow !== undefined && out.sample >= bar.stopAfter && out.number !== null && out.number <= bar.stopBelow) out.stop = `${pct(out.number)} after ${out.sampleText} (stop at ${pct(bar.stopBelow)} or worse)`;
  if (out.number === null) { out.state = 'too-early'; return; }
  if (out.stop) { out.state = 'stop'; return; }
  out.state = out.enough ? (met(out) ? 'met' : 'not-met') : 'too-early';
}
