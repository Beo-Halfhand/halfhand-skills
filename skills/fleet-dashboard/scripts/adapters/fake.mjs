// fake adapter: simulated agents in an invented harbour town, for the demo and the self-test. No network, no files.
// Everything is worked out from the agent's key and the clock, so the same moment always gives the same numbers:
// a backfilled history and the live sampler agree, and running totals only ever go up.
//
// fleet.json, per agent:
//   "adapter": "fake",
//   "fake": { "skills": ["fishing", "smithing"], "pace": 1, "offlineSince": <ms, optional> }
export const name = 'fake';

export const skillColors = { fishing: '#199e70', mining: '#d95926', woodcutting: '#c98500', smithing: '#3987e5', farming: '#008300', crafting: '#d55181', scouting: '#9085e9' };
const SKILLS = Object.keys(skillColors);
const BLOCK = 15 * 60_000, DAY = 86_400_000, PER_DAY = DAY / BLOCK, EPOCH_DAY = Math.floor(Date.UTC(2026, 9, 1) / DAY);

export function check(agent) {
  const o = agent.opts, e = [];
  if (o.skills !== undefined && (!Array.isArray(o.skills) || !o.skills.length || o.skills.some((s) => !SKILLS.includes(s)))) e.push(`"fake".skills must be a list from: ${SKILLS.join(', ')}`);
  if (o.pace !== undefined && !(Number.isFinite(o.pace) && o.pace >= 0 && o.pace <= 10)) e.push('"fake".pace must be a number from 0 to 10');
  if (o.offlineSince !== undefined && !Number.isFinite(o.offlineSince)) e.push('"fake".offlineSince must be a time in ms');
  return e;
}

function hash(str) {
  let x = 0x811c9dc5; for (const ch of str) { x ^= ch.charCodeAt(0); x = Math.imul(x, 0x01000193) >>> 0; }
  x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; x ^= x >>> 15; return x >>> 0;
}
const rnd = (...parts) => hash(parts.join('|')) / 0x100000000;

// What one agent does in one 15-minute block: a skill (weighted to the first in its list) or a rest, and how fast.
function block(agent, b) {
  const skills = agent.opts.skills ?? [SKILLS[hash(agent.key) % SKILLS.length]];
  const hour = Math.floor(((b % PER_DAY) * BLOCK) / 3_600_000);
  const tired = hour >= 9 && hour < 12 ? 0.35 : 0.12;           // a quieter stretch each day, in UTC
  if (rnd(agent.key, 'rest', b) < tired) return { skill: null, rate: 0 };
  const r = rnd(agent.key, 'skill', b), i = r < 0.6 ? 0 : Math.min(skills.length - 1, 1 + Math.floor(((r - 0.6) / 0.4) * (skills.length - 1)));
  const pace = agent.opts.pace ?? 1;
  const run = Math.floor(b / 4);                                 // one hour at a steady speed, then a new one
  return { skill: skills[i], rate: Math.round((900 + 1400 * rnd(agent.key, 'rate', run)) * pace) };   // XP per block
}

const memo = new Map();                                          // key → per-day totals since EPOCH_DAY
function before(agent, day) {
  let m = memo.get(agent.key);
  if (!m || m.sig !== JSON.stringify(agent.opts)) { m = { sig: JSON.stringify(agent.opts), days: [] }; memo.set(agent.key, m); }
  const want = day - EPOCH_DAY, sum = {};
  for (let d = 0; d < want; d++) {
    if (!m.days[d]) {
      const t = {}; for (let i = 0; i < PER_DAY; i++) { const x = block(agent, (EPOCH_DAY + d) * PER_DAY + i); if (x.skill) t[x.skill] = (t[x.skill] ?? 0) + x.rate; }
      m.days[d] = t;
    }
    for (const [k, v] of Object.entries(m.days[d])) sum[k] = (sum[k] ?? 0) + v;
  }
  return sum;
}
export function totalsAt(agent, t) {
  const day = Math.floor(t / DAY), xp = before(agent, day);
  const b = Math.floor(t / BLOCK);
  for (let i = day * PER_DAY; i <= b; i++) {
    const x = block(agent, i); if (!x.skill) continue;
    const part = i < b ? 1 : (t - b * BLOCK) / BLOCK;
    xp[x.skill] = (xp[x.skill] ?? 0) + x.rate * part;
  }
  for (const k of agent.opts.skills ?? []) xp[k] = (xp[k] ?? 0) + 20_000 + (hash(agent.key + k) % 300_000);   // a believable starting level
  return Object.fromEntries(Object.entries(xp).map(([k, v]) => [k, Math.round(v)]));
}

const WORK = {
  fishing: ['fishing', ['docks', 'lighthouse'], 'harbour mackerel'], mining: ['mining', ['quarry', 'deep-mine'], 'iron seam'],
  woodcutting: ['chopping wood', ['pine-woods', 'north-road'], 'tall pines'], smithing: ['smithing', ['forge'], 'iron nails'],
  farming: ['tending crops', ['orchard', 'old-mill'], 'apple rows'], crafting: ['crafting', ['workshop'], 'rope coils'],
  scouting: ['scouting', ['watchtower', 'salt-flats'], 'east trail'],
};
const REST = [['resting', 'inn'], ['trading', 'market'], ['walking', 'town-square'], ['reading', 'library']];

export async function sample(agent, ctx) {
  const t = ctx.now ?? Date.now();
  if (agent.opts.offlineSince && t >= agent.opts.offlineSince) throw new Error('agent offline (fake)');
  const x = block(agent, Math.floor(t / BLOCK));
  let doing, space;
  if (x.skill) { const [label, places, detail] = WORK[x.skill]; doing = { label, detail }; space = places[hash(agent.key + Math.floor(t / BLOCK / 4)) % places.length]; }
  else { const [label, sp] = REST[hash(agent.key + Math.floor(t / BLOCK)) % REST.length]; doing = { label }; space = sp; }
  const xp = totalsAt(agent, t);
  return { xp, doing, position: { space, name: NAMES[space] }, counters: { coins: 150 + (hash(agent.key + 'coins') % 800) + Math.floor(Object.values(xp).reduce((n, v) => n + v, 0) / 9000) } };
}

const TILES = [
  { id: 'pine-woods', pos: 'nw', label: 'Pine Woods' }, { id: 'north-road', pos: 'n', label: 'North Road' }, { id: 'quarry', pos: 'ne', label: 'Quarry' },
  { id: 'docks', pos: 'w', label: 'Docks' }, { id: 'town-square', pos: 'c', label: 'Town Square' }, { id: 'market', pos: 'e', label: 'Market' },
  { id: 'orchard', pos: 'sw', label: 'Orchard' }, { id: 'old-mill', pos: 's', label: 'Old Mill' }, { id: 'lighthouse', pos: 'se', label: 'Lighthouse' },
  { id: 'deep-mine', pos: 'x1', label: 'Deep Mine' }, { id: 'salt-flats', pos: 'x2', label: 'Salt Flats' }, { id: 'watchtower', pos: 'x3', label: 'Watchtower' },
];
const ROOMS = [{ id: 'library', label: 'Library' }, { id: 'forge', label: 'Forge' }, { id: 'inn', label: 'Inn' }, { id: 'workshop', label: 'Workshop' }, { id: 'bank', label: 'Bank' }, { id: 'guild-hall', label: 'Guild Hall' }];
const NAMES = Object.fromEntries([...TILES, ...ROOMS].map((x) => [x.id, x.label]));

export function map() { return { title: 'Harbour Town', tiles: TILES, rooms: { in: 'town-square', list: ROOMS } }; }
