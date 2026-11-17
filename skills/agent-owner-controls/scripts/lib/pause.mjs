// pause.mjs: pause with expiry. Two files in the agent's folder, one writer each.
//
//   PAUSE     written by whoever takes the agent (the owner, or a script)   {"by", "at", "until"}
//   RELEASED  written by the agent's driver once it is hands-off             {"at", "for", "by", "stoppedWork", "released"}
//
// Same files and fields as city-driver-starter's driver, so its pause.mjs, this module and the
// fleet-dashboard all agree. Rules:
//   - `until` is how a pause ends on its own. Scripts must always set it; a crashed script can't strand the agent.
//   - No `until` (or an empty file from `touch PAUSE`): paused until someone deletes it, and flagged as stale
//     once it is older than PAUSE_STALE_MIN minutes (default 60).
//   - `at` identifies this pause, kept exactly as written; missing, the file's modified time is used, so each new
//     manual pause is answered.
//   - The driver never deletes PAUSE (not its file). An expired PAUSE simply stops counting.
//   - RELEASED.for is the PAUSE's `at`: a caller acts only on a release for its own pause.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './files.mjs';

export const pauseFile = (dir) => path.join(dir, 'PAUSE');
export const releasedFile = (dir) => path.join(dir, 'RELEASED');

export function readPause(dir, { now = Date.now(), staleMinutes = Number(process.env.PAUSE_STALE_MIN || 60) } = {}) {
  const f = pauseFile(dir);
  let st;
  try { st = fs.statSync(f); } catch { return null; }
  let p = {};
  let raw = '';
  try { raw = fs.readFileSync(f, 'utf8').trim(); } catch { /* vanished between stat and read */ return null; }
  if (raw) { try { p = JSON.parse(raw); } catch { p = { by: 'unknown (PAUSE is not JSON)' }; } }
  if (!p || typeof p !== 'object' || Array.isArray(p)) p = {};
  // `at` is the pause's identity, kept exactly as written (any string, like city-driver-starter): RELEASED.for must
  // equal it. Missing: the file's modified time. Its age comes from `at` when that is a date, else from the file time.
  const at = typeof p.at === 'string' && p.at ? p.at.slice(0, 64) : st.mtime.toISOString();
  const bornMs = Number.isFinite(Date.parse(at)) ? Date.parse(at) : st.mtimeMs;
  const untilMs = p.until ? Date.parse(p.until) : NaN;
  const until = Number.isFinite(untilMs) ? new Date(untilMs).toISOString() : null;
  return {
    by: String(p.by || 'unknown').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 40),
    at,
    until,
    badUntil: Boolean(p.until) && !until,           // an `until` that isn't a date: treated as no end time, and flagged
    expired: until ? now > untilMs : false,
    stale: !until && now - bornMs > staleMinutes * 60_000,
  };
}

/** True while a PAUSE exists and hasn't expired. Anything that shows "paused" should use this, not "the file exists". */
export const isPaused = (dir, opts) => { const p = readPause(dir, opts); return Boolean(p && !p.expired); };

export function writeReleased(dir, pause, { stoppedWork = false, released = true, ...extra } = {}) {
  const r = { at: new Date().toISOString(), for: pause.at, by: pause.by, stoppedWork, released, ...extra };
  writeJson(releasedFile(dir), r);
  return r;
}

/**
 * Driver side. Watches PAUSE on its own timer (never inside the main loop: a loop busy in a long job can't see a file).
 *   onPause(pause)          stop helpers, stop work, wait for idle; return { stoppedWork, released, ... } for RELEASED
 *   onRenew(pause)          a new or extended PAUSE while already paused: RELEASED is rewritten, nothing else happens
 *   onResume({ by, expired, since, pause })   the pause is gone or past `until`; `since` = when this driver first saw it
 *   onStale(pause)          once per pause: no `until` and older than staleMinutes
 * Returns { tick, stop, paused }. `paused` is what the main loop checks before every action.
 */
export function watchPause(dir, { onPause, onRenew, onResume, onStale, intervalMs = 5000, staleMinutes, now = () => Date.now() } = {}) {
  let pausedFor = null, pausedSince = null, lastPause = null, busy = false, flagged = null;
  async function tick() {
    if (busy) return;                         // onPause can outlast one interval: never re-enter
    busy = true;
    try {
      const p = readPause(dir, { now: now(), staleMinutes });
      if (p && !p.expired) {
        if ((p.stale || p.badUntil) && flagged !== p.at) { flagged = p.at; await onStale?.(p); }
        if (!pausedFor) {
          pausedSince = now();
          const info = (await onPause?.(p)) ?? {};
          writeReleased(dir, p, info);
          pausedFor = p.at; lastPause = p;
        } else if (pausedFor !== p.at) {
          const prev = readJson(releasedFile(dir));
          writeReleased(dir, p, { stoppedWork: prev?.stoppedWork ?? false, released: prev?.released ?? null });
          pausedFor = p.at; lastPause = p;
          await onRenew?.(p);
        }
      } else if (pausedFor) {
        const since = pausedSince, last = lastPause;
        pausedFor = null; pausedSince = null; lastPause = null;
        fs.rmSync(releasedFile(dir), { force: true });     // RELEASED is the driver's own file
        await onResume?.({ by: p?.by ?? last?.by ?? 'unknown', expired: Boolean(p?.expired), since, pause: p ?? last });
      }
    } finally { busy = false; }
  }
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return { tick, stop: () => clearInterval(timer), get paused() { return pausedFor !== null; }, get since() { return pausedSince; } };
}

/**
 * Caller side: take the agent. Writes PAUSE with an end time, waits for a RELEASED for this pause.
 * Resolves { ok: true, at, until, release } or { ok: false, reason } (and removes its own PAUSE: fail cleanly, don't act).
 * With cleanupOnSignal (default), Ctrl-C / SIGTERM / SIGHUP remove this PAUSE before exiting.
 */
export async function hold(dir, { minutes, by = 'script', waitSeconds = Number(process.env.HOLD_WAIT_SECONDS || 360), pollMs = 1000, cleanupOnSignal = true } = {}) {
  if (!(minutes > 0 && minutes <= 24 * 60)) throw new Error('hold: minutes must be between 0 and 1440 (a script always sets an end time)');
  const atMs = Date.now();
  const at = new Date(atMs).toISOString(), until = new Date(atMs + minutes * 60_000).toISOString();
  writeJson(pauseFile(dir), { by: String(by).slice(0, 40), at, until });
  const off = () => letGo(dir, at);
  const handlers = [];
  if (cleanupOnSignal) {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const h = () => { off(); process.exit(130); };
      process.once(sig, h); handlers.push([sig, h]);
    }
  }
  const unhook = () => { for (const [sig, h] of handlers) process.removeListener(sig, h); };
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    const r = readJson(releasedFile(dir));
    if (r && r.for === at) {
      if (r.released === false) { off(); unhook(); return { ok: false, reason: 'the driver paused but could not hand back control', release: r }; }
      // stillMine(): check before every action. False once the pause has expired (the driver takes the agent back at
      // `until`, even mid-task) or someone replaced the PAUSE.
      const stillMine = () => { const p = readPause(dir); return Boolean(p && p.at === at && !p.expired); };
      return { ok: true, at, until, release: r, stillMine, done: () => { unhook(); return off(); } };
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
  off(); unhook();
  return { ok: false, reason: `no RELEASED for this pause within ${waitSeconds} s` };
}

/** Remove PAUSE only if it is still ours (its `at` matches): never delete someone else's newer pause. */
export function letGo(dir, at) {
  const p = readJson(pauseFile(dir));
  if (!p || p.at !== at) return false;
  fs.rmSync(pauseFile(dir), { force: true });
  return true;
}
