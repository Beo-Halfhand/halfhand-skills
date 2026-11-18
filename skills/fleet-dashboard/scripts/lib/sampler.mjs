// sampler.mjs: every sampleMinutes (on the clock: :00, :05, …) reads each agent once through its adapter and
// appends one line to the history. Agents are read one after another, with a short pause between them, so a fleet
// that shares one game account doesn't burst its API. Files older than keepDays are deleted.
import { appendRound, prune } from './history.mjs';
import { sampleOne } from '../adapters/index.mjs';
import { activeAgents } from './fleet.mjs';

export async function round(config, { now = Date.now(), gapMs = 300, log = () => {} } = {}) {
  const rec = { t: now, v: 1, a: {} }; const bad = [];
  const agents = activeAgents(config);   // a retired agent is never read
  for (const [i, a] of agents.entries()) {
    rec.a[a.key] = await sampleOne(a, { now, timeoutMs: 25_000 });
    if (rec.a[a.key].err) bad.push(`${a.key}: ${rec.a[a.key].err}`);
    if (gapMs && i < agents.length - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  appendRound(config.dataDir, rec);
  log(`round ${agents.length - bad.length}/${agents.length} ok in ${((Date.now() - now) / 1000).toFixed(1)} s${bad.length ? ' · failed: ' + bad.join('; ') : ''}`);
  try { for (const f of prune(config.dataDir, config.keepDays, now)) log(`pruned ${f}`); } catch (e) { log(`prune failed: ${e.message}`); }
  return rec;
}

export function startSampler(config, { log = () => {}, onRound = () => {} } = {}) {
  const every = config.sampleMinutes * 60_000;
  let stopped = false, timer = null;
  const next = async () => {
    if (stopped) return;
    try { onRound(await round(config, { log })); } catch (e) { log(`round failed: ${e.message}`); }
    schedule();
  };
  const schedule = () => { if (!stopped) timer = setTimeout(next, every - (Date.now() % every)); };
  schedule();
  return { stop() { stopped = true; clearTimeout(timer); }, now: () => round(config, { log }).then(onRound) };
}
