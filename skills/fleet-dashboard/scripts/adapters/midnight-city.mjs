// Midnight City adapter. One read-only call per agent per round: `progression <agentId>` through the City's own
// direct-control helper (scripts/mcity-control.mjs in the City's skill folder), run from that folder so the helper
// finds its own .env. This file never reads the .env, never connects, never acts, and passes the helper no
// environment beyond PATH and HOME.
//
// fleet.json, per agent:
//   "adapter": "midnight-city",
//   "midnight-city": { "skillDir": "~/skills/midnight-city-direct-control", "agentId": "<your agent id>" }
//
// Fields read from the answer (as the helper printed them when this was written; the City is a preview game):
//   skills.<skill>.xp (or progression.skills)       → xp
//   agent.activeAction.activity | kind, .phase       → doing
//   activeWork.kind, activeWork.source_id           → doing (profession work)
//   agent.position.spaceId                          → position
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expand } from '../lib/config.mjs';

export const name = 'midnight-city';

// Seven colours checked for contrast against the dashboard's dark panels, one per common City skill.
export const skillColors = { hacking: '#3987e5', mining: '#d95926', fishing: '#199e70', woodcutting: '#c98500', scavenging: '#d55181', smithing: '#008300', agility: '#9085e9' };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/;
const helperOf = (agent) => path.join(expand(agent.opts.skillDir, agent.base), agent.opts.helper ?? 'scripts/mcity-control.mjs');

export function check(agent) {
  const o = agent.opts, e = [];
  if (typeof o.skillDir !== 'string' || !o.skillDir) e.push('"midnight-city".skillDir must be the City skill folder (the one holding scripts/mcity-control.mjs)');
  if (typeof o.agentId !== 'string' || !ID_RE.test(o.agentId)) e.push('"midnight-city".agentId must be your agent id (from `node scripts/mcity-control.mjs claimable`)');
  if (o.helper !== undefined && (typeof o.helper !== 'string' || path.isAbsolute(o.helper) || o.helper.split(/[\\/]/).includes('..'))) e.push('"midnight-city".helper must be a path inside skillDir');
  return e;
}

function run(agent, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const helper = helperOf(agent);
    if (!fs.existsSync(helper)) return reject(new Error(`no ${agent.opts.helper ?? 'scripts/mcity-control.mjs'} in skillDir`));
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.homedir() };
    const p = spawn(process.execPath, [helper, ...args], { cwd: expand(agent.opts.skillDir, agent.base), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', size = 0;
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => { size += d.length; if (size < 8 * 1024 * 1024) out += d; });
    p.stderr.on('data', (d) => { if (err.length < 2000) err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code, sig) => {
      clearTimeout(timer);
      if (sig) return reject(new Error('the City helper timed out'));
      if (code !== 0) return reject(new Error(`City helper exit ${code}: ${err.trim().split('\n').pop() ?? ''}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('the City helper did not print JSON')); }
    });
  });
}

const nice = (v) => (typeof v === 'string' ? v.replace(/[_-]+/g, ' ').trim() : null);

export async function sample(agent, ctx) {
  const j = await run(agent, ['progression', agent.opts.agentId], Math.max(5_000, (ctx.timeoutMs ?? 25_000) - 1_000));
  const sk = j?.skills ?? j?.progression?.skills ?? {};
  const xp = Object.fromEntries(Object.entries(sk).filter(([k, v]) => /^[a-z_]{2,30}$/.test(k) && Number(v?.xp) > 0).map(([k, v]) => [k, Number(v.xp)]));
  const ag = j?.agent ?? {}, act = ag.activeAction ?? null, work = j?.activeWork ?? null;
  let doing;
  if (act) doing = { label: nice(act.activity ?? act.kind) ?? 'busy', detail: nice(act.phase) };
  else if (work) doing = { label: nice(work.kind) ?? 'working', detail: nice(work.source_id) };
  else doing = { label: ag.isPerformingJob === true ? 'working' : 'idle' };
  let position;
  const sp = ag.position?.spaceId;
  if (typeof sp === 'string') {
    if (sp.startsWith('agent-room:')) position = { space: 'private-room', name: 'a private room' };   // never the room's id
    else if (/^[a-z0-9-]{1,60}$/.test(sp)) position = { space: sp, name: NAMES[sp] ?? pretty(sp) };
  }
  return { xp, doing, position };
}

// The City as a schematic, not to scale: compass districts around Central, Central's buildings drawn inside it,
// and three outlying places in a row underneath. Space ids are the game's; labels are the names players see.
const TILES = [
  { id: 'forest', pos: 'nw', label: 'Forest' }, { id: 'north', pos: 'n', label: 'Enemy Staging Ground' }, { id: 'volcano', pos: 'ne', label: 'Volcano City' },
  { id: 'west', pos: 'w', label: 'West Plaza' }, { id: 'central', pos: 'c', label: 'Central' }, { id: 'east', pos: 'e', label: 'East Plaza' },
  { id: 'forest-rivers', pos: 'sw', label: 'Amoeba Wilds' }, { id: 'south', pos: 's', label: 'South Plaza' }, { id: 'bison-valley', pos: 'se', label: 'Bison Valley' },
  { id: 'miners-cave', pos: 'x1', label: 'Miners Cave' }, { id: 'construction-yard', pos: 'x2', label: 'Construction Yard' }, { id: 'heartline-tower', pos: 'x3', label: 'Heartline Tower' },
];
const ROOMS = [
  { id: 'hacker-house-interior', label: 'Hacker House' }, { id: 'cipher-hacker-house-interior', label: 'Cipher Hacker House' },
  { id: 'iog-house-interior', label: 'IOG House', also: ['iog-sleeping-quarters'] }, { id: 'charging-house-interior', label: 'Charging House' },
  { id: 'ada-arena-interior', label: 'ADA Arena' }, { id: 'goodtimes-interior', label: 'Good Times Bar' }, { id: 'hoskbrew-interior', label: 'HoskBrew' },
  { id: 'nexifuse-interior', label: 'NexiFuse' }, { id: 'prison-interior', label: 'Prison' }, { id: 'private-room', label: 'Private room', onlyIfHere: true },
];
const NAMES = Object.fromEntries([...TILES, ...ROOMS].flatMap((x) => [[x.id, x.label], ...(x.also ?? []).map((a) => [a, x.label])]));
const pretty = (sp) => sp.replace(/-interior$/, '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export function map() {
  return { title: 'Midnight City', tiles: TILES, rooms: { in: 'central', list: ROOMS } };
}
