// logs.mjs: reads the end of an agent's log. Any text format works; a time is found per line when the line has one.
//   [2026-11-17T08:00:00Z] text      2026-11-17 08:00:00 text      {"t": 1763366400000, …}      {"ts"|"time"|"at": "2026-…"}
// Lines with no time still count for "last lines" and counters; the log's age then falls back to the file's mtime.
import fs from 'node:fs';

const TAIL_BYTES = 256 * 1024;
const cache = new Map();   // file → { size, mtime, lines }

export function tail(file) {
  if (!file) return null;
  let st; try { st = fs.statSync(file); } catch { return null; }
  const c = cache.get(file);
  if (c && c.size === st.size && c.mtime === st.mtimeMs) return c;
  let lines = [];
  let fd;
  try {
    const len = Math.min(st.size, TAIL_BYTES), buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r'); fs.readSync(fd, buf, 0, len, st.size - len);
    lines = buf.toString('utf8').split('\n');
    if (st.size > len) lines.shift();            // the first line is probably cut in half
    lines = lines.filter((l) => l.trim());
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
  const v = { size: st.size, mtime: st.mtimeMs, lines };
  cache.set(file, v); return v;
}

export function timeOf(line) {
  const s = String(line);
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s);
      for (const k of ['t', 'ts', 'time', 'at', 'timestamp']) {
        const v = j?.[k];
        if (Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
        if (typeof v === 'string') { const t = Date.parse(v); if (Number.isFinite(t)) return t; }
      }
    } catch { /* not JSON after all */ }
  }
  const m = /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)\]?/.exec(s);
  if (m) { const t = Date.parse(m[1].replace(' ', 'T')); if (Number.isFinite(t)) return t; }
  return null;
}

// What the status light needs from the log: when it last moved, warnings in the last 15 minutes, and counters.
export function logFacts(agent, now = Date.now()) {
  if (!agent.log) return { has: false };
  const t = tail(agent.log);
  if (!t) return { has: true, missing: true };
  let lastT = null;
  for (let i = t.lines.length - 1; i >= Math.max(0, t.lines.length - 5); i--) { const x = timeOf(t.lines[i]); if (x !== null && (lastT === null || x > lastT)) lastT = x; }
  const lastAt = lastT ?? t.mtime;
  let warns = 0;
  if (agent.warnPattern) {
    for (let i = t.lines.length - 1; i >= 0; i--) {
      const x = timeOf(t.lines[i]);
      if (x !== null && now - x > 15 * 60_000) break;
      if (x === null && t.lines.length - i > 50) break;   // no times in this log: look at the last 50 lines only
      if (agent.warnPattern.test(t.lines[i])) warns++;
    }
  }
  const counters = {};
  for (const [k, re] of Object.entries(agent.logCounters ?? {})) {
    for (let i = t.lines.length - 1; i >= 0; i--) { const m = re.exec(t.lines[i]); if (m && m[1] !== undefined && Number.isFinite(Number(m[1]))) { counters[k] = Number(m[1]); break; } }
  }
  return { has: true, missing: false, lastAt, warns, counters, lines: t.lines };
}
