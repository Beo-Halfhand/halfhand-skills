// collect.mjs: turns fleet-dashboard history into outcomes, so anyone running fleet-dashboard gets measurement for free.
//
// fleet-dashboard's sampler writes <dataDir>/history/samples-YYYY-MM-DD.jsonl, one line per round:
//   { "t": <ms>, "v": 1, "a": { "<agent key>": { "xp": { "<skill>": <running total> }, … } | { "err": "…" } } }
// This reads those files (it never writes to them) and, for each agent in an open row, cuts time into fixed windows
// and writes one outcome per window: the gain in the running total, per minute.
//
// The same rules as the dashboard's graphs: a window is only measured when readings bracket it and no two readings
// inside it are more than GAP minutes apart. Otherwise it is written as ok:false, why:"sampling gap", which the
// review counts as unmeasured. A gap is never a zero. A falling total (a reset) adds nothing.
import fs from 'node:fs';
import path from 'node:path';
import { appendOutcome, readOutcomes } from './outcomes.mjs';
import { clockFrom, isOpen } from './register.mjs';

export const GAP = 15 * 60_000;
const FILE_RE = /^samples-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export function readHistory(dataDir, from = 0) {
  const dir = path.join(dataDir, 'history');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f)).sort(); } catch { return []; }
  const fromDay = new Date(Math.max(0, from - 86_400_000)).toISOString().slice(0, 10), out = [];
  for (const f of files) {
    if (FILE_RE.exec(f)[1] < fromDay) continue;
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!l) continue;
      try { const r = JSON.parse(l); if (Number.isFinite(r?.t) && r.a && typeof r.a === 'object' && r.v === 1) out.push(r); } catch { /* a half-written line */ }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// One agent's readings as [t, total]: the sum over skills, or one skill.
export function series(recs, agent, skill = null) {
  const s = [];
  for (const r of recs) {
    const x = r.a[agent];
    if (!x || x.err || !x.xp || typeof x.xp !== 'object') continue;
    const v = skill ? Number(x.xp[skill]) : Object.values(x.xp).reduce((n, y) => n + Number(y), 0);
    if (Number.isFinite(v)) s.push([r.t, v]);
  }
  return s;
}

// The gain in [a, b) per minute, or null with a reason.
export function windowRate(s, a, b, gap = GAP) {
  let i0 = -1, i1 = -1;
  for (let i = 0; i < s.length; i++) { if (s[i][0] <= a) i0 = i; if (s[i][0] >= b) { i1 = i; break; } }
  if (i0 < 0 || i1 < 0 || a - s[i0][0] > gap || s[i1][0] - b > gap) return { why: 'sampling gap' };
  let gain = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    if (s[i][0] - s[i - 1][0] > gap) return { why: 'sampling gap' };
    const d = s[i][1] - s[i - 1][1]; if (d > 0) gain += d;
  }
  const span = s[i1][0] - s[i0][0];
  return { value: (gain * ((b - a) / span)) / ((b - a) / 60_000) };
}

// Writes the windows that ended since the last run. Returns { written, gaps }.
export function collectRow(dir, row, { dataDir, now = Date.now(), baselineFrom = null } = {}) {
  const src = row.source ?? {};
  const W = (src.windowMinutes ?? 60) * 60_000, clock = clockFrom(row);
  if (clock === null) return { written: 0, gaps: 0 };
  const pinned = Date.parse(row.baseline?.from ?? '');
  const start = Math.ceil((baselineFrom ?? (Number.isFinite(pinned) && pinned < clock ? pinned : clock)) / W) * W;
  const seen = new Set(readOutcomes(dir, { exp: row.id, from: start - W }).map((r) => `${r.agent}|${r.t}`));
  const from = dataDir ?? (src.dataDir ? path.resolve(dir, src.dataDir) : null);
  if (!from) throw new Error(`${row.id}: no fleet-dashboard dataDir (give --history or source.dataDir)`);
  const hist = readHistory(from, start - W);
  const arms = [...row.treatment.map((a) => [a, 'T']), ...(row.control ?? []).map((a) => [a, 'C'])];
  let written = 0, gaps = 0;
  for (const [agent, arm] of arms) {
    const s = series(hist, agent, src.skill ?? null);
    for (let a = start; a + W + GAP <= now; a += W) {           // wait one GAP so the closing reading has landed
      if (seen.has(`${agent}|${a}`) || (a < clock && a + W > clock)) continue;   // a window across go-live belongs to neither
      const w = windowRate(s, a, a + W);
      const base = { t: a, exp: row.id, agent, arm: a < clock ? 'baseline' : arm, metric: row.metric, confirmed: true, proof: 'fleet-dashboard history' };
      if (w.why) { appendOutcome(dir, { ...base, ok: false, why: w.why, confirmed: false, proof: undefined }, now); gaps++; }
      else appendOutcome(dir, { ...base, value: Math.round(w.value * 10) / 10 }, now);
      written++;
    }
  }
  return { written, gaps };
}

export function collectAll(dir, rows, opts = {}) {
  const res = {};
  for (const row of rows) if (isOpen(row) && row.source?.type === 'fleet-dashboard') res[row.id] = collectRow(dir, row, opts);
  return res;
}
