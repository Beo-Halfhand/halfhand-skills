// guard.mjs: what keeps bad numbers out of a score.
//
// rewardGuard: one glitched reading can swing a median-free mean, and even a median when the sample is small. Drop
// any value more than GUARD × that agent's own median for that metric (once it has 3 or more values), any negative
// value (unless the metric allows it), and any value that isn't a number. Every drop is counted and shown, never silent.
//
// confirmReading: a polled value is a candidate until `need` reads in a row agree. A→B→A is a flap: counted, not logged.
import { median } from './stats.mjs';

export const GUARD = 10;

export function rewardGuard(recs, { guard = GUARD, allowNegative = false } = {}) {
  const keep = [], dropped = [], byKey = new Map();
  for (const r of recs) {
    const k = `${r.agent}|${r.metric}`;
    if (!byKey.has(k)) byKey.set(k, []);
    if (Number.isFinite(r.value) && r.value > 0) byKey.get(k).push(r.value);
  }
  const meds = new Map([...byKey].map(([k, xs]) => [k, xs.length >= 3 ? median(xs) : null]));
  for (const r of recs) {
    const m = meds.get(`${r.agent}|${r.metric}`);
    let why = null;
    if (!Number.isFinite(r.value)) why = 'not a number';
    else if (r.value < 0 && !allowNegative) why = 'negative';
    else if (m && r.value > guard * m) why = `${Math.round(r.value / m)}× the agent's own median`;
    if (why) dropped.push({ rec: r, why }); else keep.push(r);
  }
  return { keep, dropped };
}

// state is a plain object you persist between polls. Returns the confirmed change, or null.
export function confirmReading(state, key, value, now = Date.now(), need = 2) {
  const v = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  const s = (state[key] ??= { confirmed: v, candidate: null, seen: 0, firstSeen: null, flaps: 0 });
  if (v === s.confirmed) {
    if (s.candidate !== null) { s.flaps++; s.candidate = null; s.seen = 0; s.firstSeen = null; }   // went back: a flap
    return null;
  }
  if (v !== s.candidate) { s.candidate = v; s.seen = 1; s.firstSeen = now; return need <= 1 ? settle(s, key, now) : null; }
  s.seen++;
  return s.seen >= need ? settle(s, key, now) : null;
}
function settle(s, key, now) {
  const change = { key, from: s.confirmed, to: s.candidate, firstSeen: s.firstSeen, confirmedAt: now };
  s.confirmed = s.candidate; s.candidate = null; s.seen = 0; s.firstSeen = null;
  return change;
}
