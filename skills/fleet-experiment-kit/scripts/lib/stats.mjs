// stats.mjs: the few numbers a readout needs. Small on purpose: medians, a paired lift with a one-sided lower bound,
// and a seeded bootstrap for the lift between two medians. Seeded, so the same data always gives the same readout.

export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function sd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function hash(str) {
  let x = 0x811c9dc5;
  for (const ch of String(str)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 0x01000193) >>> 0; }
  x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; x ^= x >>> 15; return x >>> 0;
}
// mulberry32: a small seeded generator, so readouts and the demo are repeatable
export function rng(seed) {
  let a = hash(seed);
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// One-sided 95% lower bound of a mean (normal approximation; fine from ~20 values up, say so below that).
export const Z95 = 1.645;
export function lowerBound(xs) {
  const s = sd(xs);
  return s === null ? null : mean(xs) - Z95 * s / Math.sqrt(xs.length);
}

// Paired windows: each pair is { c, t } (control and treatment value in the same pair). Lift per pair = t / c − 1.
export function pairedLift(pairs) {
  const lifts = pairs.filter((p) => p.c > 0 && Number.isFinite(p.t)).map((p) => p.t / p.c - 1);
  return { n: lifts.length, lift: mean(lifts), lb: lowerBound(lifts), lifts };
}

// Two independent groups: lift between medians, plus the 5th percentile of a bootstrap of that lift (one-sided 95%).
export function medianLift(T, C, { resamples = 2000, seed = 'readout' } = {}) {
  const mt = median(T), mc = median(C);
  if (mt === null || mc === null || !(mc > 0)) return { t: mt, c: mc, lift: null, lb: null };
  const r = rng(seed), pick = (xs) => { const s = new Array(xs.length); for (let i = 0; i < xs.length; i++) s[i] = xs[Math.floor(r() * xs.length)]; return median(s); };
  const boots = [];
  for (let i = 0; i < resamples; i++) { const c = pick(C); if (c > 0) boots.push(pick(T) / c - 1); }
  boots.sort((a, b) => a - b);
  return { t: mt, c: mc, lift: mt / mc - 1, lb: boots.length ? boots[Math.floor(boots.length * 0.05)] : null };
}

export const pct = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%`);
export const num = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : (Math.round(x * 10 ** d) / 10 ** d).toString());
