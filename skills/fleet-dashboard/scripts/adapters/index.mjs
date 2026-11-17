// The adapter boundary. The dashboard knows nothing about any game or agent framework; an adapter does.
//
// An adapter is a module that exports:
//   name                      the value of "adapter" in fleet.json
//   check(agent) → string[]   config problems for one agent (agent.opts = that agent's "<adapter name>" object)
//   sample(agent, ctx)        → Promise<Sample>: one read of one agent, made by the sampler every few minutes
//   map?(agent) → Map | null  optional: a schematic of the world, for the Details page
//   skillColors?              optional: { skill: "#rrggbb" } so a skill keeps one colour everywhere
//
// Sample (every field optional):
//   { xp: { <skill>: <running total> }, doing: { label, detail }, position: { space, name, area }, counters: { <name>: <number> } }
// Map:
//   { title, tiles: [{ id, label, pos }], rooms?: { in: <tile id>, list: [{ id, label, also?: [ids] }] } }
//   pos is one of nw n ne w c e sw s se (a 3×3 compass) or x1 x2 x3 (a row under it). A space that isn't on the map
//   still shows, as its own lit row under it, by name.
// Rules for every adapter: read only; never print or return keys, tokens, account ids or home paths; time out.
import * as fake from './fake.mjs';
import * as midnightCity from './midnight-city.mjs';
import * as command from './command.mjs';
import * as file from './file.mjs';
import { mask } from '../lib/mask.mjs';

export const ADAPTERS = Object.freeze({ [fake.name]: fake, [midnightCity.name]: midnightCity, [command.name]: command, [file.name]: file });

const WORD = /^[\p{L}\p{N} .,:'()&/+_-]{1,80}$/u;
const word = (v, n = 60) => (typeof v === 'string' && WORD.test(v.trim()) ? mask(v.trim()).slice(0, n) : null);
const SPACE = /^[a-z0-9][a-z0-9_:-]{0,79}$/i;

// Whatever an adapter returns, only these fields, these types and these sizes reach the history files and the page.
export function normalize(s) {
  const out = {};
  if (s?.xp && typeof s.xp === 'object') {
    const xp = Object.entries(s.xp).filter(([k, v]) => /^[a-z0-9][a-z0-9_ -]{0,39}$/i.test(k) && Number.isFinite(Number(v)) && Number(v) >= 0).slice(0, 40);
    if (xp.length) out.xp = Object.fromEntries(xp.map(([k, v]) => [k.toLowerCase().replace(/[ -]+/g, '_'), Math.round(Number(v))]));
  }
  if (s?.doing && typeof s.doing === 'object') {
    const label = word(s.doing.label, 40);
    if (label) out.act = { label, detail: word(s.doing.detail, 60) };
  }
  if (s?.position && typeof s.position === 'object' && typeof s.position.space === 'string' && SPACE.test(s.position.space)) {
    out.act = { ...(out.act ?? {}), space: s.position.space.toLowerCase(), name: word(s.position.name, 50), area: word(s.position.area, 60) };
  }
  if (s?.counters && typeof s.counters === 'object') {
    const c = Object.entries(s.counters).filter(([k, v]) => /^[a-z][a-z0-9_]{0,30}$/i.test(k) && Number.isFinite(Number(v))).slice(0, 12);
    if (c.length) out.c = Object.fromEntries(c.map(([k, v]) => [k, Number(v)]));
  }
  return out;
}

// Runs one adapter read with a timeout; errors come back masked and short, never thrown.
export async function sampleOne(agent, ctx) {
  const ad = ADAPTERS[agent.adapter];
  const ms = ctx.timeoutMs ?? 25_000;
  let timer;
  try {
    const s = await Promise.race([ad.sample(agent, ctx), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`no answer in ${Math.round(ms / 1000)} s`)), ms); })]);
    return normalize(s);
  } catch (e) {
    return { err: mask(String(e?.message ?? e)).slice(0, 120) || 'read failed' };
  } finally { clearTimeout(timer); }
}
