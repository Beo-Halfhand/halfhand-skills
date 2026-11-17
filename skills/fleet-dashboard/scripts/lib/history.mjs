// history.mjs: the sampler's files and the maths that turns them into graphs.
//
// One JSON line per sampling round goes to <dataDir>/history/samples-YYYY-MM-DD.jsonl (UTC day):
//   { "t": 1763400000000, "v": 1, "a": { "<agent key>": { "xp": { "<skill>": <total xp> }, "act": {…}, "c": {…} } } }
// XP is a running total per skill, so the gain between two samples is spread evenly over the time between them.
// A gap longer than GAP_EST is drawn faded ("spread over a sampling gap"); one longer than GAP_MAX isn't bridged.
import fs from 'node:fs';
import path from 'node:path';

export const GAP_EST = 15 * 60_000, GAP_MAX = 6 * 3_600_000;
const FILE_RE = /^samples-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export function histDir(dataDir) { return path.join(dataDir, 'history'); }

export function appendRound(dataDir, rec) {
  const dir = histDir(dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(dir, `samples-${dayOf(rec.t)}.jsonl`), JSON.stringify(rec) + '\n', { mode: 0o600 });
}

export function prune(dataDir, keepDays, now = Date.now()) {
  const cut = dayOf(now - keepDays * 86_400_000), gone = [];
  let files = []; try { files = fs.readdirSync(histDir(dataDir)); } catch { return gone; }
  for (const f of files) { const m = FILE_RE.exec(f); if (m && m[1] < cut) { fs.unlinkSync(path.join(histDir(dataDir), f)); gone.push(f); } }
  return gone;
}

// Reads every record from fromT (minus GAP_MAX, so the first bin can be bridged) onwards, oldest first.
// Parsed files are cached by size and mtime, so the 15-second page refresh costs almost nothing.
export function makeReader(dataDir) {
  const cache = new Map();
  return function records(fromT) {
    const dir = histDir(dataDir);
    let files = []; try { files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f)).sort(); } catch { return []; }
    const fromDay = dayOf(fromT - GAP_MAX);
    const out = [];
    for (const f of files) {
      if (f.slice(8, 18) < fromDay) continue;
      const file = path.join(dir, f); let st; try { st = fs.statSync(file); } catch { continue; }
      let c = cache.get(file);
      if (!c || c.size !== st.size || c.mtime !== st.mtimeMs) {
        const recs = [];
        for (const l of fs.readFileSync(file, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); if (Number.isFinite(r?.t) && r.a && typeof r.a === 'object') recs.push(r); } catch { /* a half-written line */ } }
        c = { size: st.size, mtime: st.mtimeMs, recs }; cache.set(file, c);
      }
      for (const r of c.recs) if (r.t >= fromT - GAP_MAX) out.push(r);
    }
    for (const k of cache.keys()) if (!files.includes(path.basename(k))) cache.delete(k);
    return out.sort((x, y) => x.t - y.t);
  };
}

// add(binIndex, fraction) for each bin that [a, b] overlaps
export function spread(t0, bin, n, a, b, add) {
  const span = b - a; if (span <= 0) return;
  for (let i = Math.max(0, Math.floor((a - t0) / bin)); i < n; i++) {
    const s = t0 + i * bin, e = s + bin; if (s >= b) break;
    const ov = Math.min(e, b) - Math.max(s, a); if (ov > 0) add(i, ov / span);
  }
}

// Fills bins[i].xp[skill], .cov (a sample pair covers it) and .est (that pair was far apart). Returns the first sample time or null.
export function xpInto(bins, recs, key, t0, bin) {
  const n = bins.length; let prev = null, first = null;
  for (const r of recs) {
    const x = r.a?.[key]; if (!x?.xp) continue;
    if (first === null) first = r.t;
    if (prev && r.t - prev.t <= GAP_MAX && r.t > t0) {
      const est = r.t - prev.t > GAP_EST;
      for (const [k, v] of Object.entries(x.xp)) {
        const d = Number(v) - Number(prev.xp[k] ?? 0); if (!(d > 0)) continue;   // a reset or a new skill at 0 adds nothing
        spread(t0, bin, n, prev.t, r.t, (i, f) => { bins[i].xp[k] = (bins[i].xp[k] ?? 0) + d * f; });
      }
      spread(t0, bin, n, Math.max(prev.t, t0), r.t, (i) => { bins[i].cov = true; if (est) bins[i].est = true; });
    }
    prev = { t: r.t, xp: x.xp };
  }
  return first;
}

const windowEnd = (now, bin) => Math.floor(now / bin) * bin + bin;

// The card's graph: the last 6 hours in 15-minute bars, top 3 skills per bar.
export const STRIP_BIN = 15 * 60_000, STRIP_N = 24;
export function strip(recs, key, now = Date.now()) {
  const t0 = windowEnd(now, STRIP_BIN) - STRIP_N * STRIP_BIN;
  const bins = Array.from({ length: STRIP_N }, () => ({ xp: {}, cov: false, est: false }));
  xpInto(bins, recs, key, t0, STRIP_BIN);
  return { t0, bin: STRIP_BIN, bins: bins.map((b) => ({ x: Object.entries(b.xp).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v > 0).sort((p, q) => q[1] - p[1]).slice(0, 3), cov: b.cov, est: b.est })) };
}
export const stripXp = (st) => (st?.bins ?? []).reduce((n, b) => n + b.x.reduce((m, [, v]) => m + v, 0), 0);

// The big graph: the last 24 hours in 30-minute bars, every skill, for one agent or the whole fleet.
export const OUT_BIN = 30 * 60_000, OUT_N = 48;
export function output(recs, keys, now = Date.now()) {
  const t0 = windowEnd(now, OUT_BIN) - OUT_N * OUT_BIN;
  const bins = Array.from({ length: OUT_N }, (_, i) => ({ t: t0 + i * OUT_BIN, xp: {}, cov: false, est: false }));
  let historyFrom = null;
  for (const k of keys) { const f = xpInto(bins, recs, k, t0, OUT_BIN); if (f !== null && (historyFrom === null || f < historyFrom)) historyFrom = f; }
  const totals = {}; let xp = 0, peak = 0;
  for (const b of bins) {
    for (const k of Object.keys(b.xp)) { b.xp[k] = Math.round(b.xp[k]); if (!b.xp[k]) delete b.xp[k]; else totals[k] = (totals[k] ?? 0) + b.xp[k]; }
    b.total = Object.values(b.xp).reduce((n, v) => n + v, 0); xp += b.total; peak = Math.max(peak, b.total);
  }
  return { now, t0, bin: OUT_BIN, bins, historyFrom, totals: { xp, peak },
    skills: Object.entries(totals).sort((x, y) => y[1] - x[1]).map(([skill, v]) => ({ skill, xp: v })) };
}

// The newest sample for one agent, if it is no older than maxAge.
export function latest(recs, key, maxAge, now = Date.now()) {
  for (let i = recs.length - 1; i >= 0; i--) {
    const r = recs[i]; if (now - r.t > maxAge) return null;
    const x = r.a?.[key]; if (x) return { t: r.t, ...x };
  }
  return null;
}
// The newest sample that read cleanly (no err), however old within the records given.
export function lastGood(recs, key) {
  for (let i = recs.length - 1; i >= 0; i--) { const x = recs[i].a?.[key]; if (x && !x.err) return { t: recs[i].t, ...x }; }
  return null;
}
