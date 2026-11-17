// demo.mjs: an invented harbour crew running five experiments, so `node xk.mjs --demo` shows every verdict with zero
// setup. Everything in it is made up: agents, places, numbers, receipts. It writes, in a folder you give it:
//   fleet-data/history/samples-*.jsonl   fleet-dashboard's history format, 7.5 days, 5-minute rounds
//   experiments/register.json            7 rows: 5 open, 1 decided, 1 closed
//   experiments/outcomes/                what the agents logged themselves (pairs, shadow decisions, trades)
//   experiments/decisions.json           one finding already settled, so the review stops repeating it
//   experiments/verdicts/<yesterday>.json  yesterday's review, so "nothing sits" has something to compare with
// Then the collector turns the history into hourly outcomes for the fleet-dashboard row.
import fs from 'node:fs';
import path from 'node:path';
import { appendOutcome } from './outcomes.mjs';
import { saveRegister } from './register.mjs';
import { armForWindow } from './arms.mjs';
import { rng } from './stats.mjs';
import { dateIn } from './review.mjs';

const MIN = 60_000, H = 60 * MIN, DAY = 24 * H;
const iso = (t) => new Date(t).toISOString().slice(0, 16) + ':00Z';
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);

export function buildDemo(root, { now = Date.now() } = {}) {
  now = Math.floor(now / MIN) * MIN;
  const exp = path.join(root, 'experiments'), data = path.join(root, 'fleet-data');
  fs.mkdirSync(path.join(exp, 'verdicts'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(data, 'history'), { recursive: true, mode: 0o700 });
  const live = {
    tide: now - 5 * DAY - 3 * H, rest: now - 4 * DAY, helper: now - 3 * DAY - 2 * H, pantry: now - 2 * DAY - 6 * H, barter: now - 6 * DAY,
  };

  // ── fleet-dashboard history: four agents; the two on the tide table earn about a quarter more once it goes live ──
  const crew = { wren: 95, juniper: 104, moss: 99, pike: 91 }, T = ['wren', 'juniper'];
  const totals = Object.fromEntries(Object.keys(crew).map((k) => [k, { fishing: 180_000 + crew[k] * 900, smithing: 60_000 + crew[k] * 400 }]));
  const step = 5 * MIN, start = Math.floor((now - 7.5 * DAY) / step) * step, r = rng('harbour');
  const gapMoss = [now - 2 * DAY - 9 * H, now - 2 * DAY - 6 * H];   // the sampler missed moss for three hours
  const glitch = now - 3 * DAY - 4 * H;                              // one bad reading for juniper (a total that jumps, then falls back)
  const block = new Map();
  for (let t = start; t < now - MIN; t += step) {
    const rec = { t, v: 1, a: {} };
    for (const [k, base] of Object.entries(crew)) {
      const b = `${k}|${Math.floor(t / (15 * MIN))}`;
      if (!block.has(b)) block.set(b, r() < 0.15 ? 0 : base * (0.75 + 0.5 * r()) * (T.includes(k) && t >= live.tide ? 1.27 : 1));
      const gain = block.get(b) * 5;                                 // XP in these 5 minutes
      totals[k].fishing += gain * 0.7; totals[k].smithing += gain * 0.3;
      if (k === 'moss' && t > gapMoss[0] && t < gapMoss[1]) continue;
      const xp = { fishing: Math.round(totals[k].fishing), smithing: Math.round(totals[k].smithing) };
      if (k === 'juniper' && t === Math.floor(glitch / step) * step) xp.fishing += 420_000;
      rec.a[k] = { xp, act: { label: 'fishing', space: 'docks', name: 'Docks' } };
    }
    const f = path.join(data, 'history', `samples-${dayStr(t)}.jsonl`);
    fs.appendFileSync(f, JSON.stringify(rec) + '\n');
  }

  // ── the register ──
  const rows = [
    { id: 'tide-table', question: 'Does reading the tide table before choosing a fishing spot earn more?', change: 'Tide table picks the fishing spot',
      design: 'concurrent', treatment: T, control: ['moss', 'pike'], metric: 'xp_per_min',
      bar: { type: 'lift', min: 0.15, lowerBoundAbove: 0, unit: 'hour windows' }, barText: 'median XP per minute ≥ +15% vs control, lower bound above 0, or revert',
      barWrittenAt: iso(live.tide - 20 * H), liveSince: iso(live.tide), minSample: 150, backstop: dayStr(now + 3 * DAY), status: 'running',
      source: { type: 'fleet-dashboard', dataDir: '../fleet-data', windowMinutes: 60 },
      baseline: { from: iso(live.tide - 2 * DAY), note: 'pinned: the same four agents, the 2 days before go-live' },
      notes: [{ at: iso(live.tide + 26 * H), kind: 'bugfix', text: 'tide table read in UTC, not harbour time; fixed (bug fix: the clock keeps running)' }] },
    { id: 'short-rest', question: 'Does a 5-minute rest between market runs, instead of 15, sell more per minute?', change: 'Shorter rest between market runs',
      design: 'paired', treatment: ['quill'], metric: 'coins_per_min',
      bar: { type: 'paired-lift', min: 0.03, lowerBoundAbove: 0, stopBelow: -0.10, stopAfter: 20, looks: [60, 100, 150], maxSample: 150 },
      barText: 'mean coins per minute ≥ +3% over paired windows with the lower bound above 0; stop at −10% after 20 pairs; give up at 150 pairs',
      barWrittenAt: iso(live.rest - 2 * DAY), liveSince: iso(live.rest), minSample: 60, backstop: dayStr(now + 3 * DAY), status: 'running' },
    { id: 'market-helper', question: 'Will the crew use a price helper when they sell?', change: 'Price helper in the selling step',
      design: 'single', treatment: ['sable'], metric: 'helper_calls', bar: { type: 'count', min: 10 }, barText: '≥ 10 helper calls a week, or remove it',
      barWrittenAt: iso(live.helper - 3 * H), liveSince: iso(live.helper), minSample: 7, backstop: dayStr(now + 5 * DAY), status: 'running' },
    { id: 'pantry-canary', question: 'Can a new eat-or-sell rule replace the hand-written one?', change: 'New pantry rule, shadow first',
      design: 'shadow', treatment: ['ember'], metric: 'decision', bar: { type: 'rate', flag: 'fallback', max: 0.01, none: ['harmful'], unit: 'decisions' },
      barText: 'fallback under 1% and no harmful disagreement over ≥ 500 decisions; any harmful one stops it',
      barWrittenAt: iso(live.pantry - DAY), liveSince: iso(live.pantry), minSample: 500, backstop: dayStr(now + 4 * DAY), status: 'running' },
    { id: 'barter-board', question: 'Does posting on the barter board bring trades?', change: 'Barter board posts',
      design: 'single', treatment: ['basil'], metric: 'trades', bar: { type: 'count', min: 20 }, barText: '≥ 20 confirmed trades a week (a receipt each)',
      barWrittenAt: iso(live.barter - 4 * H), liveSince: iso(live.barter), minSample: 5, backstop: dayStr(now + 2 * DAY), status: 'running' },
    { id: 'louder-bell', question: 'Does ringing the bell louder bring buyers faster?', change: 'Louder market bell', design: 'concurrent', treatment: ['moss'], control: ['pike'],
      metric: 'xp_per_min', bar: { type: 'lift', min: 0.1 }, barText: 'median XP per minute ≥ +10% vs control', barWrittenAt: iso(now - 30 * DAY), liveSince: iso(now - 29 * DAY),
      minSample: 150, backstop: dayStr(now - 19 * DAY), status: `DECIDED ${dayStr(now - 20 * DAY)}: REVERT (median xp_per_min −4.1%, 212 T vs 209 C hour windows)` },
    { id: 'lantern-helper', question: 'Will a lantern helper get used on night runs?', change: 'Lantern helper', design: 'single', treatment: ['quill'], metric: 'helper_calls',
      bar: { type: 'count', min: 5 }, barText: '≥ 5 calls a week', barWrittenAt: iso(now - 18 * DAY), liveSince: iso(now - 18 * DAY), minSample: 3, backstop: dayStr(now - 11 * DAY),
      status: `CLOSED ${dayStr(now - 15 * DAY)}: 0 calls in 3 days; the hook sat on the night route and the crew never fishes at night (wrong placement, not a bug)` },
  ];
  saveRegister(exp, { rows });

  // ── short-rest: quill logs one outcome per window; a coin flip inside each pair picks which arm goes first ──
  const rq = rng('quill');
  for (let n = 1; n <= 68; n++) {
    const { pair, arm } = armForWindow('short-rest', n), t = live.rest + n * 80 * MIN;
    if (t > now - 30 * MIN) break;
    if (n === 23) { appendOutcome(exp, { t, exp: 'short-rest', agent: 'quill', arm, pair, metric: 'coins_per_min', ok: false, why: 'restarted mid-window', confirmed: false }, now); continue; }
    const v = 4.1 * (0.85 + 0.3 * rq()) * (arm === 'T' ? 1.06 : 1);
    appendOutcome(exp, { t, exp: 'short-rest', agent: 'quill', arm, pair, metric: 'coins_per_min', value: Math.round(v * 100) / 100, confirmed: true, proof: `market receipts M-${4000 + n}` }, now);
  }

  // ── market-helper: two calls on the first day, then nothing ──
  for (const h of [3, 7]) appendOutcome(exp, { t: live.helper + h * H, exp: 'market-helper', agent: 'sable', arm: 'T', metric: 'helper_calls', value: 1, confirmed: true, proof: 'helper access log' }, now);

  // ── pantry-canary: every decision, the old rule's and the new rule's answer; 2 fallbacks, 5 harmless disagreements ──
  const rp = rng('pantry');
  for (let i = 0, t = live.pantry + 3 * MIN; t < now - MIN && i < 900; i++, t += 5 * MIN) {
    const flags = [];
    if (i === 140 || i === 512) flags.push('fallback');
    if (rp() < 0.008) flags.push('disagree');
    appendOutcome(exp, { t, exp: 'pantry-canary', agent: 'ember', arm: 'T', metric: 'decision', value: 1, flags, confirmed: true, proof: 'shadow log' }, now);
  }

  // ── barter-board: basil reports trades; the receipt book confirms most, not all (and none of the last few) ──
  const rb = rng('barter');
  for (let t = live.barter + 2 * H, k = 0; t < now - H; t += Math.round((3 + 4 * rb()) * H), k++) {
    const recent = t > now - DAY, confirmed = recent ? k % 2 === 0 : rb() > 0.12;
    appendOutcome(exp, { t, exp: 'barter-board', agent: 'basil', arm: 'T', metric: 'trades', value: 1, confirmed,
      ...(confirmed ? { proof: `receipt B-${2100 + k}` } : { claimed: { trade: `${['rope', 'nets', 'salt', 'apples'][k % 4]} for coins` } }) }, now);
  }

  // ── what was settled, and yesterday's review ──
  fs.writeFileSync(path.join(exp, 'decisions.json'), JSON.stringify([
    { row: 'short-rest', flag: 'volume', status: 'KNOWN', until: dayStr(now + 3 * DAY), note: 'rest windows only run on market days; if 60 pairs are not in by the backstop, move it with a note (not a design change)' },
  ], null, 2) + '\n');
  const y = dateIn(now - DAY);
  fs.writeFileSync(path.join(exp, 'verdicts', `${y}.json`), JSON.stringify({ date: y, at: new Date(now - DAY).toISOString(), rows: [
    { id: 'tide-table', verdict: 'OK', flags: [] }, { id: 'short-rest', verdict: 'OK', flags: [], suppressed: ['volume'] },
    { id: 'market-helper', verdict: 'LOOKS WRONG', flags: ['evidence-empty'] }, { id: 'pantry-canary', verdict: 'OK', flags: [] }, { id: 'barter-board', verdict: 'OK', flags: [] },
  ] }, null, 2) + '\n');
  return { exp, data, now };
}
