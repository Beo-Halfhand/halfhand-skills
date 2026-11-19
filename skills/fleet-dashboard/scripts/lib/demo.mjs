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
// Each one has a job (in words, with one number for it); Tansy is retired, so she has no card and is never read.
export const CREW = [
  { key: 'wren', name: 'Wren', main: true, skills: ['fishing', 'smithing'], pace: 1.1, job: { title: 'Fishing at the Docks', number: { label: 'Fishing total', xp: 'fishing' } } },
  { key: 'moss', name: 'Moss', skills: ['woodcutting', 'crafting'], job: { title: 'Woodcutting in the Pine Woods', slot: 'night shift', number: { label: 'Woodcutting total', xp: 'woodcutting' } } },
  { key: 'juniper', name: 'Juniper', skills: ['mining', 'smithing'], pace: 1.3, job: { title: 'Mining the Quarry', number: { label: 'Coins', counter: 'coins' } } },
  { key: 'pike', name: 'Pike', skills: ['farming', 'crafting'], pace: 0.9, warns: 3, job: { title: 'Farming the Orchard', number: { label: 'Market board', value: '#14', asOf: 'yesterday' } } },
  { key: 'ember', name: 'Ember', skills: ['scouting', 'fishing'], paused: true, job: { title: 'Scouting the east trail', number: { label: 'Scouting total', xp: 'scouting' } } },
  { key: 'basil', name: 'Basil', skills: ['mining', 'woodcutting'], offlineMin: 95, job: { title: 'Mining the Deep Mine', number: { label: 'Mining total', xp: 'mining' } } },
  { key: 'quill', name: 'Quill', skills: ['crafting', 'smithing'], gap: [200, 160], job: { title: 'Rope at the Workshop', slot: 'spare seat', number: { label: 'Crafting total', xp: 'crafting' } } },
  { key: 'sable', name: 'Sable', skills: ['fishing', 'farming'], pace: 0.8, startedMin: 120, job: { title: 'Fishing at the Lighthouse', status: 'testing', number: { label: 'Fishing total', xp: 'fishing' } } },
  { key: 'tansy', name: 'Tansy', skills: ['farming', 'scouting'], retired: 'moved to the mainland crew (made up)' },
];
// What "Last:" reads in the demo logs. Only the (groups) reach the card, never the rest of the line.
export const LAST_DID = [
  { match: 'DONE (\\w+) block · \\+([\\d,]+) XP', say: '$1 block done, +$2 XP' },
  { match: 'SOLD (\\d+) ([a-z ]+?) for (\\d+) coins', say: 'sold $1 $2 for $3 coins' },
];
const BLOCK = 15 * MIN;

export async function buildDemo(dir, { now = Date.now(), port = 7700, sampleMinutes = 1 } = {}) {
  for (const d of ['data', 'logs', 'asks', 'pause', 'retired']) fs.mkdirSync(path.join(dir, d), { recursive: true, mode: 0o700 });
  const raw = {
    title: 'Harbour crew (demo)', port, dataDir: './data', asksDir: './asks', sampleMinutes, keepDays: 2,
    agents: CREW.map((c) => ({
      key: c.key, name: c.name, adapter: 'fake', ...(c.main ? { main: true } : {}),
      log: `./logs/${c.key}.log`, pauseFile: `./pause/${c.key}/PAUSE`, staleMinutes: 30, warnPattern: '\\bWARN\\b',
      logCounters: { food: 'food=(\\d+)' }, ...(c.job ? { job: c.job } : {}), lastDid: LAST_DID,
      ...(c.retired ? { retiredFile: `./retired/${c.key}/RETIRED` } : {}),
      fake: { skills: c.skills, pace: c.pace ?? 1, ...(c.offlineMin ? { offlineSince: now - c.offlineMin * MIN } : {}) },
    })),
  };
  const file = path.join(dir, 'fleet.json');
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  const { config, errors } = parseConfig(raw, file, ADAPTERS);
  if (errors.length) throw new Error('demo config: ' + errors.join('; '));
  for (const [i, a] of config.agents.entries()) if (CREW[i].retired) {   // retired two days ago; the file's text is the note
    fs.mkdirSync(path.dirname(a.retiredFile), { recursive: true }); fs.writeFileSync(a.retiredFile, CREW[i].retired + '\n');
    const t = new Date(now - 2 * 86_400_000); fs.utimesSync(a.retiredFile, t, t);
  }

  // 26 hours of 5-minute rounds, with Quill's sampling gap and Sable's late start
  const step = 5 * MIN, start = Math.floor((now - 26 * 60 * MIN) / step) * step;
  for (let t = start; t < now - MIN; t += step) {
    const rec = { t, v: 1, a: {} };
    for (const [i, a] of config.agents.entries()) {
      const c = CREW[i];
      if (c.retired) continue;
      if (c.startedMin && t < now - c.startedMin * MIN) continue;
      if (c.gap && t > now - c.gap[0] * MIN && t < now - c.gap[1] * MIN) continue;
      rec.a[a.key] = await sampleOne(a, { now: t });
    }
    appendRound(config.dataDir, rec);
  }

  // logs: the last two hours, one line every three minutes; Basil's stops when it went offline
  for (const [i, a] of config.agents.entries()) {
    const c = CREW[i], lines = [];
    if (c.retired) continue;
    const end = c.offlineMin ? now - c.offlineMin * MIN : now;
    for (let t = now - 120 * MIN; t <= end; t += 3 * MIN) lines.push(await logLine(a, t, i));
    for (let t = Math.ceil((now - 120 * MIN) / BLOCK) * BLOCK; t <= end; t += BLOCK) { const e = await eventLines(a, t, i); lines.push(...e); }
    // an agent that went offline early can have no block end in its short log at some times of day: give it the sale it made before it stopped,
    // so its card always has a last thing done (the self-test failed in 59 of the day's 1,440 minutes without this)
    if (!lines.some((l) => / (?:DONE|SOLD) /.test(l))) lines.push(`[${new Date(end - MIN).toISOString()}] SOLD ${5 + (i % 12)} ${GOODS[c.skills[0]]} for ${20 + ((i * 13) % 40)} coins`);
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

// At the end of each 15-minute block of work: "DONE <skill> block · +N XP", and now and then a sale.
async function eventLines(a, t, i) {
  const [s0, s1] = [await sampleOne(a, { now: t - BLOCK }), await sampleOne(a, { now: t - 1 })];
  if (s0.err || s1.err) return [];
  const gain = {}; for (const [k, v] of Object.entries(s1.xp ?? {})) { const d = v - (s0.xp?.[k] ?? v); if (d > 0) gain[k] = d; }
  const top = Object.entries(gain).sort((x, y) => y[1] - x[1])[0];
  const out = [];
  if (top) out.push(`[${new Date(t).toISOString()}] DONE ${top[0]} block · +${Math.round(top[1]).toLocaleString('en-US')} XP`);
  if ((Math.floor(t / BLOCK) + i) % 3 === 0) out.push(`[${new Date(t + MIN).toISOString()}] SOLD ${5 + ((i * 7 + Math.floor(t / BLOCK)) % 12)} ${GOODS[CREW[i].skills[0]]} for ${20 + ((i * 13 + Math.floor(t / BLOCK)) % 40)} coins`);
  return out;
}
const GOODS = { fishing: 'harbour mackerel', woodcutting: 'pine logs', mining: 'iron ore', farming: 'apples', scouting: 'trail maps', crafting: 'rope coils', smithing: 'iron nails' };

// While the demo runs: a new line for every agent that isn't offline or retired, every 30 seconds, plus the block's
// events when a 15-minute block ends.
export function keepLogsMoving(config) {
  let block = Math.floor(Date.now() / BLOCK);
  const timer = setInterval(async () => {
    const now = Date.now(), b = Math.floor(now / BLOCK), ended = b !== block; block = b;
    for (const [i, a] of config.agents.entries()) {
      if (CREW[i].offlineMin || CREW[i].retired) continue;
      try {
        fs.appendFileSync(a.log, (await logLine(a, now, i)) + '\n');
        if (ended) for (const l of await eventLines(a, b * BLOCK, i)) fs.appendFileSync(a.log, l + '\n');
      } catch { /* the folder was removed */ }
    }
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
