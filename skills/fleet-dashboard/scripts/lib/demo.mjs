// demo.mjs: builds a throwaway fleet of invented agents in a temporary folder, so `node deck.mjs --demo` shows a
// working dashboard with zero setup. Everything in it is made up: names, places, numbers, logs and asks.
// It writes 26 hours of history at once (so the graphs are full), then keeps the logs moving while it runs.
import fs from 'node:fs';
import path from 'node:path';
import { appendRound } from './history.mjs';
import { sampleOne } from '../adapters/index.mjs';
import { parseConfig } from './config.mjs';
import { ADAPTERS } from '../adapters/index.mjs';

const MIN = 60_000;
export const CREW = [
  { key: 'wren', name: 'Wren', main: true, skills: ['fishing', 'smithing'], pace: 1.1 },
  { key: 'moss', name: 'Moss', skills: ['woodcutting', 'crafting'] },
  { key: 'juniper', name: 'Juniper', skills: ['mining', 'smithing'], pace: 1.3 },
  { key: 'pike', name: 'Pike', skills: ['farming', 'crafting'], pace: 0.9, warns: 3 },
  { key: 'ember', name: 'Ember', skills: ['scouting', 'fishing'], paused: true },
  { key: 'basil', name: 'Basil', skills: ['mining', 'woodcutting'], offlineMin: 95 },
  { key: 'quill', name: 'Quill', skills: ['crafting', 'smithing'], gap: [200, 160] },
  { key: 'sable', name: 'Sable', skills: ['fishing', 'farming'], pace: 0.8, startedMin: 120 },
];

export async function buildDemo(dir, { now = Date.now(), port = 7700, sampleMinutes = 1 } = {}) {
  for (const d of ['data', 'logs', 'asks', 'pause']) fs.mkdirSync(path.join(dir, d), { recursive: true, mode: 0o700 });
  const raw = {
    title: 'Harbour crew (demo)', port, dataDir: './data', asksDir: './asks', sampleMinutes, keepDays: 2,
    agents: CREW.map((c) => ({
      key: c.key, name: c.name, adapter: 'fake', ...(c.main ? { main: true } : {}),
      log: `./logs/${c.key}.log`, pauseFile: `./pause/${c.key}/PAUSE`, staleMinutes: 30, warnPattern: '\\bWARN\\b',
      logCounters: { food: 'food=(\\d+)' },
      fake: { skills: c.skills, pace: c.pace ?? 1, ...(c.offlineMin ? { offlineSince: now - c.offlineMin * MIN } : {}) },
    })),
  };
  const file = path.join(dir, 'fleet.json');
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  const { config, errors } = parseConfig(raw, file, ADAPTERS);
  if (errors.length) throw new Error('demo config: ' + errors.join('; '));

  // 26 hours of 5-minute rounds, with Quill's sampling gap and Sable's late start
  const step = 5 * MIN, start = Math.floor((now - 26 * 60 * MIN) / step) * step;
  for (let t = start; t < now - MIN; t += step) {
    const rec = { t, v: 1, a: {} };
    for (const [i, a] of config.agents.entries()) {
      const c = CREW[i];
      if (c.startedMin && t < now - c.startedMin * MIN) continue;
      if (c.gap && t > now - c.gap[0] * MIN && t < now - c.gap[1] * MIN) continue;
      rec.a[a.key] = await sampleOne(a, { now: t });
    }
    appendRound(config.dataDir, rec);
  }

  // logs: the last two hours, one line every three minutes; Basil's stops when it went offline
  for (const [i, a] of config.agents.entries()) {
    const c = CREW[i], lines = [];
    const end = c.offlineMin ? now - c.offlineMin * MIN : now;
    for (let t = now - 120 * MIN; t <= end; t += 3 * MIN) lines.push(await logLine(a, t, i));
    if (c.warns) for (let k = 0; k < c.warns; k++) lines.push(`[${new Date(now - (10 - 3 * k) * MIN).toISOString()}] WARN trade refused: the buyer is out of coins`);
    lines.sort();
    fs.writeFileSync(a.log, lines.join('\n') + '\n');
    if (c.offlineMin) { const t = new Date(end); fs.utimesSync(a.log, t, t); }
    if (c.paused) { fs.mkdirSync(path.dirname(a.pauseFile), { recursive: true }); fs.writeFileSync(a.pauseFile, JSON.stringify({ by: 'owner', until: new Date(now + 60 * MIN).toISOString() }) + '\n'); }
  }

  // two questions waiting for the owner
  const ask = (id, agent, question, draft, ago) => fs.writeFileSync(path.join(config.asksDir, `${id}.json`), JSON.stringify({ id, agent, question, draft, at: new Date(now - ago * MIN).toISOString() }, null, 2) + '\n');
  ask('A101', 'wren', 'A trader at the Docks offers 40 coins for 10 harbour mackerel. Sell them?', 'Yes, sell 10. Keep the rest for the Forge.', 12);
  ask('A102', 'juniper', 'The Deep Mine needs a better pick (120 coins). Buy one now or keep mining the Quarry?', 'Keep mining the Quarry until 300 coins.', 41);
  return { file, config };
}

async function logLine(a, t, i) {
  const s = await sampleOne(a, { now: t });
  const what = s.act ? `${s.act.label}${s.act.detail ? ` (${s.act.detail})` : ''} at ${s.act.name ?? s.act.space}` : 'no reading';
  const food = 20 + ((Math.floor(t / (9 * MIN)) + i * 7) % 30);
  return `[${new Date(t).toISOString()}] status: ${what} · coins=${s.c?.coins ?? 0} food=${food}`;
}

// While the demo runs: a new line for every agent that isn't offline, every 30 seconds.
export function keepLogsMoving(config) {
  const timer = setInterval(async () => {
    for (const [i, a] of config.agents.entries()) {
      if (CREW[i].offlineMin) continue;
      try { fs.appendFileSync(a.log, (await logLine(a, Date.now(), i)) + '\n'); } catch { /* the folder was removed */ }
    }
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
