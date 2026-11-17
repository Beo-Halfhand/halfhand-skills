// outcomes.mjs: the shared outcome log. Every agent, collector and script that measures something writes here,
// in one format, so one review can read all of it.
//
// <dir>/outcomes/outcomes-YYYY-MM-DD.jsonl (UTC day), one JSON line per outcome:
//   { "t": 1763400000000, "v": 1, "exp": "tide-table", "agent": "wren", "arm": "T", "metric": "xp_per_min",
//     "value": 812.4, "confirmed": true, "proof": "history" }
// Optional: "pair" (paired windows), "flags" (["fallback"], ["disagree", "harmful"]…), "claimed" (what the agent said),
// "ok": false with "why" (a window that could not be measured: a sampling gap, a restart), "note".
//
// The rule the scorer follows: only outcomes the world confirmed count. "confirmed": true needs a "proof" that names
// where the number came from (a receipt id, the sampler's history, a second read that agreed). What an agent says it
// did goes in "claimed" with "confirmed": false; the review counts those, shows them, and never scores them.
import fs from 'node:fs';
import path from 'node:path';

const KEY = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const ARMS = new Set(['T', 'C', 'baseline']);
const FILE_RE = /^outcomes-(\d{4}-\d{2}-\d{2})\.jsonl$/;
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
export const outcomesDir = (dir) => path.join(dir, 'outcomes');

// Returns a list of problems; empty means the record may be written.
export function checkOutcome(r, now = Date.now()) {
  const e = [];
  if (!r || typeof r !== 'object') return ['not an object'];
  if (!Number.isFinite(r.t)) e.push('t must be a time in ms');
  else if (r.t > now + 5 * 60_000) e.push('t is in the future');
  if (!KEY.test(r.exp ?? '')) e.push('exp must be a register id');
  if (!KEY.test(r.agent ?? '')) e.push('agent must be a key (lowercase letters, digits, - _)');
  if (!ARMS.has(r.arm)) e.push('arm must be T, C or baseline');
  if (typeof r.metric !== 'string' || !r.metric) e.push('metric is missing');
  if (r.ok === false) { if (!r.why) e.push('an ok:false outcome needs a why'); }
  else if (!Number.isFinite(r.value)) e.push('value must be a number (a missing value is not a zero)');
  if (typeof r.confirmed !== 'boolean') e.push('confirmed must be true or false, never left out');
  if (r.confirmed === true && !(typeof r.proof === 'string' && r.proof.trim())) e.push('a confirmed outcome needs a proof (where the number came from)');
  if (r.confirmed === false && r.ok !== false && r.claimed === undefined) e.push('an unconfirmed outcome needs a proof to become confirmed, or "claimed" (what the agent said)');
  if (r.pair !== undefined && !(Number.isInteger(r.pair) && r.pair > 0)) e.push('pair must be a whole number from 1');
  if (r.flags !== undefined && !(Array.isArray(r.flags) && r.flags.every((f) => typeof f === 'string'))) e.push('flags must be a list of words');
  return e;
}

export function appendOutcome(dir, r, now = Date.now()) {
  const rec = { v: 1, ...r };
  const errs = checkOutcome(rec, now);
  if (errs.length) throw new Error(`outcome refused: ${errs.join('; ')}`);
  const d = outcomesDir(dir);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(d, `outcomes-${dayOf(rec.t)}.jsonl`), JSON.stringify(rec) + '\n', { mode: 0o600 });
  return rec;
}

// Every outcome for one experiment (or all), oldest first. A half-written last line is skipped, not fatal.
export function readOutcomes(dir, { exp = null, from = -Infinity, to = Infinity } = {}) {
  let files = [];
  try { files = fs.readdirSync(outcomesDir(dir)).filter((f) => FILE_RE.test(f)).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    const day = FILE_RE.exec(f)[1];
    if (day < dayOf(Math.max(from, 0)) && from > -Infinity) continue;
    for (const l of fs.readFileSync(path.join(outcomesDir(dir), f), 'utf8').split('\n')) {
      if (!l) continue;
      let r; try { r = JSON.parse(l); } catch { continue; }
      if (!Number.isFinite(r?.t) || r.t < from || r.t >= to) continue;
      if (exp && r.exp !== exp) continue;
      out.push(r);
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// Is this outcome allowed into a score? (Exported so the gate runner can show it saying no.)
export const scoreable = (r) => r.ok !== false && r.confirmed === true && typeof r.proof === 'string' && r.proof.trim() !== '' && Number.isFinite(r.value);
