#!/usr/bin/env node
// driver.mjs: a first Midnight City driver. One loop: read the City, pick a job, act, respect PAUSE,
// log what really happened. It calls the City's own direct-control helper (mcity-control.mjs) and
// never talks to the City any other way. No dependencies; Node 20+.
//
//   node driver.mjs --config driver.json            run until Ctrl-C
//   node driver.mjs --config driver.json --once     one tick, then exit
//   node driver.mjs --config driver.json --dry-run  read and decide; no connect, no actions (needs agentId)
//
// Files, all in the driver's own folder (the folder holding the config):
//   driver.json   your settings, re-read every tick       PAUSE     you write it to take the agent
//   log.jsonl     one line per decision and outcome         RELEASED  the driver writes it when hands-off
//   journal.md    optional lines written by a model, from facts only
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACTIONS = new Set(['eat', 'trade', 'gather', 'work', 'stop-work']);
const DEFAULTS = { tickSeconds: 60, mode: 'gather', jobs: [], keep: [], food: [], words: { enabled: false } };
const HOLD_PENDING_TICKS = 3, FAILS_BEFORE_BACKOFF = 3, BACKOFF_TICKS = 10, MAX_REFUSED_RECONNECTS = 3;
const home = (p) => (typeof p === 'string' && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

// ---------- config (hot reload: a bad edit keeps the last good config) ----------
export function loadConfig(file, last, log) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cfg = { ...DEFAULTS, ...raw, words: { ...DEFAULTS.words, ...(raw.words || {}) } };
    if (!['gather', 'work'].includes(cfg.mode)) throw new Error(`mode must be "gather" or "work", not "${cfg.mode}"`);
    if (!(cfg.tickSeconds >= 5)) throw new Error('tickSeconds must be 5 or more');
    if (!Array.isArray(cfg.jobs) || !Array.isArray(cfg.keep) || !Array.isArray(cfg.food)) throw new Error('jobs, keep and food must be lists');
    if (last?.badConfig) log({ event: 'config_ok' });
    return cfg;
  } catch (e) {
    if (!last) throw new Error(`config ${file}: ${e.message}`);
    log({ event: 'config_error', error: e.message, kept: 'last good config' });
    return { ...last, badConfig: true };
  }
}

// ---------- the City, through its own helper ----------
export function errorLine(stderr, fallback) {
  const lines = String(stderr).split('\n').map((l) => l.trim()).filter((l) => l && !/^Node\.js v\d/.test(l) && !/^at /.test(l));
  return (lines.find((l) => /\b\w*Error\b|error:/.test(l)) || lines.at(-1) || fallback).slice(0, 300);
}
export function makeCity({ helper, cwd, timeoutMs = 120_000 }) {
  return (...args) => new Promise((resolve) => {
    execFile(process.execPath, [helper, ...args.map(String)], { cwd, timeout: timeoutMs, maxBuffer: 16 << 20 },
      (err, stdout, stderr) => {
        if (err) return resolve({ error: errorLine(stderr, err.message) });
        try { resolve(JSON.parse(stdout)); } catch { resolve({ error: 'helper printed something that is not JSON' }); }
      });
  });
}
const leaseLost = (r) => /lease expired|not connected|control session changed|control_lost/i.test(r?.error || '');

// ---------- PAUSE: a JSON file {"by":"you","until":"<ISO>"}; until is optional, but a script must set it ----------
export function readPause(dir, now = Date.now()) {
  const f = path.join(dir, 'PAUSE');
  if (!fs.existsSync(f)) return null;
  let p = {};
  try { p = JSON.parse(fs.readFileSync(f, 'utf8') || '{}'); } catch { p = { by: 'unknown (PAUSE is not JSON)' }; }
  const at = p.at || fs.statSync(f).mtime.toISOString();
  const expired = p.until ? now > Date.parse(p.until) : false;
  return { by: p.by || 'unknown', at, until: p.until || null, expired };
}

// ---------- the pure part: given what the City said, what one thing do we do? ----------
const count = (inv, ids) => ids.reduce((n, id) => n + (inv[id] || 0), 0);
export function foodIds(cfg, merchants) {
  if (cfg.food.length) return cfg.food;
  // food outlets sell something for crystal; whatever they sell is food
  return [...new Set(merchants.filter((m) => m.source === 'outlet' && m.offer?.acceptsItemId === 'crystal').map((m) => m.offer.paysItemId))];
}
// the City says: copy merchantName, itemId and quantity from the offer's own `trade` object when it has one
const tradeOf = (m) => ({ name: m.trade?.merchantName ?? m.name, itemId: m.trade?.itemId ?? m.offer.acceptsItemId, batch: Number(m.trade?.quantity ?? m.offer.acceptsQuantity) });
function sale(inv, merchants, keep, first) {
  const order = [first, ...Object.keys(inv).sort((a, b) => inv[b] - inv[a])].filter((id) => id && !keep.has(id));
  for (const id of order) {
    const buyer = merchants.find((m) => m.offer?.acceptsItemId === id && m.offer.paysItemId === 'crystal');
    if (!buyer) continue;
    const t = tradeOf(buyer), qty = t.batch > 0 ? Math.floor((inv[id] || 0) / t.batch) * t.batch : 0;
    if (qty > 0) return { act: ['trade', t.name, t.itemId, qty], qty, id };
  }
  return null;
}
export function decide(s, cfg) {
  const agent = s.context?.agent || {};
  const inv = s.inventory?.items || s.inventory?.inventory || {};
  const hunger = s.needs?.hunger?.state || 'normal';
  const load = s.inventory?.load || {};
  const merchants = s.merchants?.merchants || [];
  const food = foodIds(cfg, merchants);
  const keep = new Set([...cfg.keep, 'crystal', ...food]);
  if (agent.activeModule?.locksCommonActions) return { wait: 'an event has the agent; only event actions are allowed' };
  // mid-action (walking, gathering, trading): any new action would replace it, so wait for it to finish
  if (agent.activeAction) return { wait: `mid-action (${agent.activeAction.kind || 'busy'})` };
  // from here on the agent is idle or on a profession job; eating or selling may interrupt the job, which is wanted
  if (hunger !== 'normal') {
    if (count(inv, food) > 0) return { act: ['eat'], why: `hunger ${hunger}, carrying food` };
    const crystal = inv.crystal || 0;
    const offer = merchants.filter((m) => m.source === 'outlet' && m.offer?.acceptsItemId === 'crystal' && tradeOf(m).batch <= crystal)
      .sort((a, b) => tradeOf(a).batch - tradeOf(b).batch)[0];
    if (offer) { const t = tradeOf(offer); return { act: ['trade', t.name, t.itemId, t.batch], why: `hunger ${hunger}, no food, buying ${offer.offer.paysItemId}` }; }
    const sell = sale(inv, merchants, keep, load.heaviestItem);
    if (sell) return { act: sell.act, why: `hunger ${hunger}, no food, selling ${sell.qty} ${sell.id} to pay for food` };
    s.notes.push(`hunger ${hunger} but no food, no affordable seller and nothing to sell; working to earn`);
  }
  if (load.state && load.state !== 'normal') {
    const sell = sale(inv, merchants, keep, load.heaviestItem);
    if (sell) return { act: sell.act, why: `load ${load.state}, selling ${sell.qty} ${sell.id}` };
    if (load.state === 'overburdened') return { wait: 'overburdened and nothing sellable outside the keep list; not gathering more' };
    s.notes.push(`load ${load.state} but nothing sellable outside the keep list`);
  }
  if (agent.isPerformingJob) return { wait: 'already working' };
  if (cfg.mode === 'work') return { act: ['work'], why: 'profession work' };
  const sources = s.progression?.capabilities?.sources || [];
  const open = sources.filter((x) => !x.failureReason);
  const pick = cfg.jobs.length ? cfg.jobs.map((id) => open.find((x) => x.sourceId === id)).find(Boolean) : open[0];
  for (const id of cfg.jobs) {
    if (pick && id === pick.sourceId) break;
    const x = sources.find((y) => y.sourceId === id);
    s.notes.push(`skipped ${id}: ${x ? x.failureReason : 'not offered to this agent'}`);
  }
  return pick ? { act: ['gather', pick.sourceId], why: `job ${pick.sourceId}` } : { wait: 'no job is open to this agent right now' };
}

// ---------- optional words: a model writes one journal line from facts; code checks it ----------
export function checkLine(line, facts, recent) {
  const t = String(line || '').trim().replace(/\s+/g, ' ').replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!t) return { ok: false, why: 'empty reply' };
  if (t.length > 200) return { ok: false, why: 'longer than 200 characters' };
  const known = new Set(facts.join(' ').match(/\d+(\.\d+)?/g) || []);      // whole numbers only: "2" is not in "12"
  const bad = (t.match(/\d+(\.\d+)?/g) || []).find((n) => !known.has(n));
  if (bad) return { ok: false, why: `number ${bad} is not in the facts` };
  if (recent.some((r) => r.toLowerCase() === t.toLowerCase())) return { ok: false, why: 'repeats a recent line' };
  return { ok: true, line: t };
}
export async function askModel(w, facts) {
  const prompt = `Write ONE short first-person journal line (under 200 characters) for a Midnight City agent. Say only what these facts say. Add no feelings, times of day, places, people, numbers, plans or results that are not in the facts. No quotation marks.\n${facts.map((f) => `- ${f}`).join('\n')}`;
  const ollama = /\/api\/chat\/?$/.test(w.url);
  const body = ollama
    ? { model: w.model, messages: [{ role: 'user', content: prompt }], stream: false, think: false }
    : { model: w.model, messages: [{ role: 'user', content: prompt }], max_tokens: 120 };
  const headers = { 'content-type': 'application/json' };
  if (w.apiKeyEnv && process.env[w.apiKeyEnv]) headers.authorization = `Bearer ${process.env[w.apiKeyEnv]}`;
  const r = await fetch(w.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout((w.timeoutSeconds ?? 30) * 1000) });
  if (!r.ok) throw new Error(`model answered HTTP ${r.status}`);
  const j = await r.json();
  return ollama ? j.message?.content : j.choices?.[0]?.message?.content;
}

// ---------- the loop ----------
export async function run(argv = process.argv.slice(2)) {
  const opt = { config: 'driver.json', dryRun: false, ticks: Infinity, fast: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') opt.config = argv[++i];
    else if (a === '--once') opt.ticks = 1;
    else if (a === '--ticks') opt.ticks = Number(argv[++i]);
    else if (a === '--dry-run') opt.dryRun = true;
    else if (a === '--fast') opt.fast = true;          // tests only: 0.05 s between ticks
    else { console.error(`unknown option ${a}\nusage: node driver.mjs [--config driver.json] [--once | --ticks N] [--dry-run]`); return 2; }
  }
  const cfgFile = path.resolve(opt.config);
  const dir = path.dirname(cfgFile);
  const logFile = path.join(dir, 'log.jsonl');
  const log = (o) => fs.appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
  let cfg;
  try { cfg = loadConfig(cfgFile, null, log); } catch (e) { console.error(e.message); return 2; }
  // skillDir and agentId are read once, at start; everything else in driver.json is re-read every tick
  const skillDir = home(process.env.MCITY_SKILL_DIR) || (cfg.skillDir && path.resolve(dir, home(cfg.skillDir)));
  const helper = home(process.env.MCITY_HELPER) || (skillDir && path.join(skillDir, 'scripts', 'mcity-control.mjs'));
  if (!helper || !fs.existsSync(helper)) {
    console.error(`can't find the City's helper (${helper || 'no skillDir set'}). Set "skillDir" in ${path.basename(cfgFile)} to the full path of the City's direct-control skill folder.`);
    return 2;
  }
  const agentId = process.env.MCITY_AGENT_ID || cfg.agentId || '';
  if (opt.dryRun && !agentId) { console.error('--dry-run reads without taking control, so it needs "agentId" in the config (or MCITY_AGENT_ID)'); return 2; }
  const who = agentId ? [agentId] : [];      // reads name the agent; they don't need control
  const city = makeCity({ helper, cwd: path.dirname(path.dirname(helper)) });
  let stopping = false, pausedFor = null, lastInv = null, lastWords = 0, refused = 0, lastNotes = '';
  let held = null;                           // { key, ticks, why }: an action we won't resend yet
  const fails = new Map();                   // action key -> consecutive failures
  const recentLines = [];
  const connect = async () => {
    const c = await city('connect', ...who);
    if (c.error) { log({ event: 'connect_failed', error: c.error }); return false; }
    log({ event: 'connected' });
    const u = c.skillUpdate;
    if (u?.updated === true) { log({ event: 'skill_updated', installedVersion: u.installedVersion ?? null }); stopping = 'skill'; }
    return true;
  };
  const call = async (...args) => {          // one action; on a lost lease, reconnect once and retry
    let r = await city(...args);
    if (!leaseLost(r) || opt.dryRun) return r;
    if (await connect()) { refused = 0; log({ event: 'reconnect', because: r.error, ok: true }); return city(...args); }
    refused++;
    log({ event: 'reconnect', because: r.error, ok: false });
    if (refused >= MAX_REFUSED_RECONNECTS) { log({ event: 'giving_up', why: `${refused} reconnects refused in a row; something else is driving this agent` }); stopping = 'control'; }
    return r;
  };
  const read = (...a) => (opt.dryRun ? city(...a) : call(...a));   // a dry run never connects
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopping = stopping || 'signal'; });
  log({ event: 'start', dryRun: opt.dryRun, mode: cfg.mode });
  if (!opt.dryRun && !(await connect())) { console.error(`connect failed; see ${logFile}`); log({ event: 'stop', why: 'connect failed' }); return 1; }

  for (let tick = 0; tick < opt.ticks && !stopping; tick++) {
    cfg = loadConfig(cfgFile, cfg, log);
    const last = tick + 1 >= opt.ticks;
    // 1. PAUSE comes first, every tick and every 5 s while waiting
    const p = readPause(dir);
    if (p && !p.expired) {
      if (!pausedFor) {
        // hand-off: never reconnect here (city(), not call()), so a pause can't take control back
        const ctx = await city('context', ...who);
        let stopped = false, released = null;
        if (!opt.dryRun) {
          if (ctx.agent?.isPerformingJob) stopped = !(await city('stop-work')).error;
          released = !(await city('disconnect')).error;
        }
        pausedFor = p.at;
        writeReleased(p, stopped, released);
        log({ event: 'paused', by: p.by, until: p.until, stoppedWork: stopped, released, ...(opt.dryRun ? { dryRun: true } : {}) });
      } else if (pausedFor !== p.at) {
        // a new or extended PAUSE while already paused: answer it, send nothing
        const prev = readReleased();
        pausedFor = p.at;
        writeReleased(p, prev?.stoppedWork ?? false, prev?.released ?? null);
        log({ event: 'pause_renewed', by: p.by, until: p.until });
      }
      await nap(5_000); continue;
    }
    if (pausedFor) {
      log({ event: p?.expired ? 'pause_expired' : 'resumed', by: p?.by ?? readReleased()?.by ?? 'unknown' });
      pausedFor = null; fs.rmSync(path.join(dir, 'RELEASED'), { force: true });
      if (!opt.dryRun && !(await connect())) { if (!last) await nap(cfg.tickSeconds * 1000); continue; }
    }
    // 2. read
    const s = { notes: [] };
    for (const what of ['context', 'needs', 'inventory', 'merchants']) {
      s[what] = await read(what, ...(what === 'merchants' ? [] : who));
      if (s[what].error) {
        log({ event: 'read_failed', read: what, error: s[what].error, ...(opt.dryRun && leaseLost(s[what]) ? { hint: 'this City skill needs control even for reads; run without --dry-run, or connect first' } : {}) });
        s.failed = true; break;
      }
    }
    if (!s.failed && cfg.mode === 'gather' && !s.context.agent?.isPerformingJob) {
      s.progression = await read('progression', ...who);
      if (s.progression.error) { log({ event: 'read_failed', read: 'progression', error: s.progression.error }); s.failed = true; }
    }
    if (s.failed) { if (!last) await nap(cfg.tickSeconds * 1000); continue; }
    // what changed since last tick, measured, not assumed
    const inv = s.inventory.items || s.inventory.inventory || {};
    let changed = false;
    if (lastInv) {
      const delta = {};
      for (const id of new Set([...Object.keys(inv), ...Object.keys(lastInv)])) if ((inv[id] || 0) !== (lastInv[id] || 0)) delta[id] = (inv[id] || 0) - (lastInv[id] || 0);
      if ((changed = Object.keys(delta).length > 0)) log({ event: 'inventory_changed', delta });
    }
    lastInv = inv;
    if (held && (changed || --held.ticks <= 0)) held = null;
    // 3. decide, 4. act
    let d = decide(s, cfg);
    const notes = JSON.stringify(s.notes);
    if (notes !== lastNotes) for (const n of s.notes) log({ event: 'note', note: n });   // a note is logged when it changes, not every tick
    lastNotes = notes;
    const key = d.act?.join(' ');
    if (key && held?.key === key) d = { wait: held.why };
    if (d.wait) log({ event: 'wait', why: d.wait });
    else if (opt.dryRun) log({ event: 'would', act: d.act, why: d.why });
    else {
      if (!ACTIONS.has(d.act[0])) throw new Error(`refusing unknown action ${d.act[0]}`);
      const r = await call(...d.act);
      const o = r.outcome || {};
      const result = r.error ? 'error' : o.status || 'unknown';
      log(r.error
        ? { event: 'act', act: d.act, why: d.why, result, error: r.error }
        : { event: 'act', act: d.act, why: d.why, submitted: r.submitted === true, result, ...(o.reason ? { reason: o.reason } : {}) });
      if (result === 'pending' || result === 'unknown') held = { key, ticks: HOLD_PENDING_TICKS, why: `last "${key}" is still ${result}; not sending it again until something changes` };
      if (result === 'confirmed') fails.delete(key);
      if (result === 'failed' || result === 'error') {
        const n = (fails.get(key) || 0) + 1; fails.set(key, n);
        if (n >= FAILS_BEFORE_BACKOFF) { fails.delete(key); held = { key, ticks: BACKOFF_TICKS, why: `"${key}" failed ${n} times in a row (${o.reason || r.error}); trying again in ${BACKOFF_TICKS} ticks` }; log({ event: 'backoff', act: d.act, ticks: BACKOFF_TICKS }); }
      }
    }
    // 5. optional words, never actions
    const w = cfg.words;
    if (w.enabled && w.url && w.model && Date.now() - lastWords >= (w.everyMinutes ?? 60) * 60_000) {
      lastWords = Date.now();
      const h = s.needs.hunger?.state, l = s.inventory.load?.state;
      const facts = [h === 'normal' ? 'I am not hungry' : `I am ${h || 'of unknown hunger'}`, l === 'normal' ? 'my load is light' : `my load is ${l || 'unknown'}`,
        ...Object.entries(inv).filter(([, n]) => n > 0).slice(0, 8).map(([id, n]) => `I carry ${n} ${id}`),
        d.act ? `I just chose this, and it is not finished yet: ${d.why}` : `I am waiting: ${d.wait}`];
      try {
        const c = checkLine(await askModel(w, facts), facts, recentLines);
        if (c.ok) { fs.appendFileSync(path.join(dir, 'journal.md'), `- ${new Date().toISOString()} ${c.line}\n`); recentLines.push(c.line); recentLines.splice(0, recentLines.length - 20); }
        log(c.ok ? { event: 'journal' } : { event: 'journal_rejected', why: c.why });
      } catch (e) { log({ event: 'journal_failed', error: String(e.message).slice(0, 200) }); }
    }
    if (!last) await nap(cfg.tickSeconds * 1000);
  }
  if (!opt.dryRun && !pausedFor && stopping !== 'control') { const r = await city('disconnect'); log(r.error ? { event: 'disconnect_failed', error: r.error } : { event: 'disconnected' }); }
  if (stopping === 'skill') console.error("The City's skill updated itself. Re-read its SKILL.md, check the fields in references/the-city.md still exist, then start the driver again.");
  if (stopping === 'control') console.error(`Stopped: reconnects kept being refused, so something else is driving this agent. See ${logFile}.`);
  log({ event: 'stop', ...(typeof stopping === 'string' ? { why: stopping } : {}) });
  return stopping === 'skill' ? 3 : stopping === 'control' ? 1 : 0;

  function readReleased() { try { return JSON.parse(fs.readFileSync(path.join(dir, 'RELEASED'), 'utf8')); } catch { return null; } }
  function writeReleased(p, stoppedWork, released) {
    fs.writeFileSync(path.join(dir, 'RELEASED'), JSON.stringify({ at: new Date().toISOString(), for: p.at, by: p.by, stoppedWork, released, ...(opt.dryRun ? { dryRun: true } : {}) }) + '\n');
  }
  async function nap(ms) {        // sleep in 5 s slices so a PAUSE or Ctrl-C is seen quickly
    if (opt.fast) ms = 50;
    for (let left = ms; left > 0 && !stopping; left -= 5_000) {
      const p = readPause(dir);
      if (!pausedFor && p && !p.expired) return;
      if (pausedFor && (!p || p.expired || p.at !== pausedFor)) return;
      await sleep(Math.min(5_000, left));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then((code) => { process.exitCode = code; }, (e) => { console.error(e.stack || e.message); process.exitCode = 1; });
}
