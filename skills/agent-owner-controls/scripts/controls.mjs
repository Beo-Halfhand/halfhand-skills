#!/usr/bin/env node
// controls.mjs: the owner's side of agent-owner-controls, from a terminal. Zero dependencies.
//
//   node controls.mjs pause <agent dir> <minutes> [--by <name>]   take the agent; waits for RELEASED (exit 0, 1 no answer, 3 not released)
//   node controls.mjs pause <agent dir> off                       give it back (removes PAUSE)
//   node controls.mjs stop <agent dir> | start <agent dir>        hard stop: STOP file on / off
//   node controls.mjs unfreeze <agent dir>                        clear the freeze latch after a refusal
//   node controls.mjs status <agent dir> [--asks <dir>] [--events <file>]
//   node controls.mjs asks <asks dir>                             open asks, oldest first
//   node controls.mjs answer <asks dir> <id> ok|skip|own [text]   answer once (the same file fleet-dashboard writes)
//   node controls.mjs handback <events file> --by <name> [--pin] <text>
//   node controls.mjs rogue <agent dir>                           an action that must be refused; exit 2 if it passes
//   node controls.mjs doctor <agent dir>                          checks that the controls can actually hold
//
// <agent dir> holds PAUSE, RELEASED, STOP, policy.json, spent.json, refusals.jsonl. Exit 2 on a usage error.
// Logs (refusals.jsonl, events.jsonl) roll to <name>.1.jsonl past CONTROLS_LOG_MAX_KB (default 1024).
import fs from 'node:fs';
import path from 'node:path';
import { readPause, hold, letGo, pauseFile, releasedFile } from './lib/pause.mjs';
import { listAsks, answerAsk, openAsks } from './lib/asks.mjs';
import { fileHandback, recentSelf } from './lib/handback.mjs';
import { createLimits } from './lib/limits.mjs';
import { readJson, readLines, writeJson, previousPart, logMaxBytes } from './lib/files.mjs';

const [cmd, ...args] = process.argv.slice(2);
const usage = (msg) => { if (msg) console.error(msg); console.error('usage: see the top of controls.mjs, or node controls.mjs help'); process.exit(2); };
const needDir = (d) => { if (!d || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) usage(`not a folder: ${d ?? '(none)'}`); return d; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v ?? usage(`${name} needs a value`); };
const when = (s) => (s ? s.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '-');

async function main() {
  switch (cmd) {
    case 'pause': {
      const by = flag('--by') || 'owner';
      const dir = needDir(args[0]);
      if (args[1] === 'off') {
        const p = readJson(pauseFile(dir));
        if (!fs.existsSync(pauseFile(dir))) { console.log('there was no PAUSE; nothing to do'); return 0; }
        if (p?.at && !letGo(dir, p.at)) return usage('PAUSE changed while removing it; look again');
        if (!p?.at) fs.rmSync(pauseFile(dir), { force: true });
        console.log('PAUSE removed. The driver takes the agent back within a few seconds.'); return 0;
      }
      const minutes = Number(args[1]);
      if (!(minutes > 0 && minutes <= 1440)) usage('minutes: 1 to 1440 (every pause from here has an end time)');
      console.log(`PAUSE written (by ${by}, ${minutes} min); waiting for the driver to let go…`);
      const r = await hold(dir, { minutes, by, waitSeconds: Number(process.env.PAUSE_WAIT_SECONDS || 120) });
      if (r.ok) { console.log(`RELEASED: the agent is yours until ${when(r.until)}. At that time the driver takes it back, even mid-task.`); return 0; }
      console.error(`${r.reason}. PAUSE removed again: don't act on the agent.`);
      return /could not hand back/.test(r.reason) ? 3 : 1;
    }
    case 'stop': {
      const dir = needDir(args[0]);
      writeJson(path.join(dir, 'STOP'), { by: flag('--by') || 'owner', at: new Date().toISOString() });
      console.log('STOP written: every action except read-only ones is refused until "start".'); return 0;
    }
    case 'start': {
      const dir = needDir(args[0]);
      fs.rmSync(path.join(dir, 'STOP'), { force: true });
      console.log('STOP removed.'); return 0;
    }
    case 'unfreeze': {
      const dir = needDir(args[0]);
      const L = createLimits(dir), was = L.status().frozen;
      L.unfreeze(); console.log(was ? `unfrozen (was: ${was})` : 'it was not frozen'); return 0;
    }
    case 'status': {
      const asks = flag('--asks'), events = flag('--events');
      const dir = needDir(args[0]);
      const p = readPause(dir), r = readJson(releasedFile(dir)), L = createLimits(dir).status();
      console.log(`pause:    ${!p ? 'none' : p.expired ? `expired at ${when(p.until)} (by ${p.by}); not paused` : `PAUSED by ${p.by} until ${p.until ? when(p.until) : 'removed (no end time)'}${p.stale ? ', STALE' : ''}`}`);
      console.log(`released: ${!r ? 'no' : r.for === p?.at ? `yes, for this pause (work ${r.stoppedWork ? 'stopped' : 'not running'}, control ${r.released === false ? 'NOT handed over' : 'handed over'})` : 'an old RELEASED, not for the current pause'}`);
      console.log(`limits:   ${L.policyOk ? `mode ${L.mode}, ${L.stop ? 'STOP on' : 'no STOP'}${L.frozen ? `, FROZEN (${L.frozen})` : ''}, spent today ${L.spentToday}${L.caps.perDay !== undefined ? `/${L.caps.perDay}` : ''}, this week ${L.spentWeek}${L.caps.perWeek !== undefined ? `/${L.caps.perWeek}` : ''} (${L.tz})` : `REFUSING EVERYTHING: ${L.problems.join('; ')}`}`);
      const tz = L.tz || 'UTC', dayOf = (t) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)); } catch { return ''; } };
      const today = dayOf(Date.now());
      const no = readLines(path.join(dir, 'refusals.jsonl')).filter((x) => dayOf(x.at) === today);
      console.log(`refusals: ${no.length} today (${tz})${no.length ? `; last: ${no.at(-1).action} (${no.at(-1).rule}) ${no.at(-1).reason}` : ''}`);
      if (asks) console.log(`asks:     ${openAsks(asks).filter((a) => !fs.existsSync(path.join(asks, 'answers', `${a.id}.json`))).length} waiting for you`);
      if (events) { const lines = recentSelf(events); console.log(`recent:   ${lines.length ? `\n  ${lines.join('\n  ')}` : 'nothing in the last day'}`); }
      return 0;
    }
    case 'asks': {
      const dir = needDir(args[0]);
      const extra = Object.fromEntries(openAsks(dir).map((a) => [a.id, a]));
      const { asks } = listAsks(dir, []);
      const open = asks.filter((a) => a.open).reverse();
      if (!open.length) { console.log('no open asks'); return 0; }
      for (const a of open) {
        const x = extra[a.id] ?? {};
        console.log(`#${a.id} [${x.kind ?? '?'}] from ${x.agent || 'an agent'}: ${a.question}`);
        if (x.context?.length) console.log(`   earlier: ${x.context.join(' · ')}`);
        if (a.draft) console.log(`   draft: ${a.draft}`);
        console.log(`   if you don't answer by ${when(x.deadline)}: ${x.onTimeout === 'send' ? 'the draft is sent' : 'nothing happens'}`);
      }
      return 0;
    }
    case 'answer': {
      const [dir, id, verdict, ...words] = args;
      needDir(dir);
      const [code, body] = answerAsk(dir, { id, verdict, text: words.join(' ') });
      if (code !== 200) { console.error(body.error); return code === 409 ? 1 : 2; }
      console.log(`answered #${id}: ${verdict}. The agent still checks it against its own rules before acting.`); return 0;
    }
    case 'handback': {
      const by = flag('--by'); const pin = args.includes('--pin');
      const rest = args.filter((a) => a !== '--pin');
      const [file, ...words] = rest;
      if (!file || !by || !words.length) usage('handback <events file> --by <name> [--pin] <text>');
      const row = fileHandback(file, by, words.join(' '), { pin });
      console.log(`filed: ${row.text}`); return 0;
    }
    case 'rogue': {
      const dir = needDir(args[0]);
      const c = createLimits(dir).check('rogue_test', { amount: 1e12, to: '(rogue counterparty)', after: {} });
      if (c.ok) { console.error(`ALERT: an action that must always be refused passed the limits${c.wouldRefuse ? ' (shadow mode: only logged)' : ''}`); return 2; }
      console.log(`rogue refused (${c.rule}): ${c.reason}`); return 0;
    }
    case 'doctor': return doctor(needDir(args[0]));
    case 'help': case '--help': case '-h': case undefined:
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split("\n").slice(1, 16).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return cmd ? 0 : 2;
    default: usage(`unknown command ${cmd}`);
  }
}

function doctor(dir) {
  let bad = 0, warn = 0;
  const ok = (m) => console.log(`ok    ${m}`), no = (m) => { bad++; console.log(`FAIL  ${m}`); }, wa = (m) => { warn++; console.log(`warn  ${m}`); };
  const policy = path.join(dir, 'policy.json');
  const L = createLimits(dir).status();
  if (L.policyOk) ok(`policy.json is valid (mode ${L.mode})`); else no(`policy.json: ${L.problems.join('; ')} -> everything is refused`);
  if (L.mode === 'shadow') wa('mode is "shadow": refusals are only logged, nothing is blocked');
  if (L.mode === 'off') wa('mode is "off": everything except read-only actions is refused');
  const canWrite = (f) => { try { fs.accessSync(f, fs.constants.W_OK); return true; } catch { return false; } };
  if (fs.existsSync(policy) && canWrite(policy)) wa('this user can write policy.json. If the agent runs as this user, it can raise its own limits: see references/limits.md, "Enforced outside the agent"');
  if (canWrite(dir)) wa('this user can write the agent folder, so it could also replace policy.json. Keep policy.json in a folder the agent can only read, for anything that spends real money');
  if (L.stop) wa('STOP is on: the agent is stopped');
  if (L.frozen) wa(`frozen after a refusal: ${L.frozen} (node controls.mjs unfreeze ${dir})`);
  if (L.expires && Date.parse(L.expires) - Date.now() < 7 * 86_400_000) wa(`the policy expires ${L.expires.slice(0, 10)}${Date.parse(L.expires) <= Date.now() ? ' (already: everything is refused)' : ''}`);
  const p = readPause(dir), r = readJson(releasedFile(dir));
  if (p?.stale) wa(`PAUSE by ${p.by} has no end time and is older than ${process.env.PAUSE_STALE_MIN || 60} min. Is someone still using the agent?`);
  if (p?.badUntil) wa('PAUSE has an "until" that is not a date: it is treated as no end time');
  if (p?.expired) ok(`PAUSE by ${p.by} has expired; the driver should be running again`);
  if (r && (!p || p.expired) ) wa('RELEASED is there but there is no live PAUSE: the driver may not be running (it deletes RELEASED when it resumes)');
  const kb = (f) => { try { return Math.ceil(fs.statSync(f).size / 1024); } catch { return 0; } };
  const log = path.join(dir, 'refusals.jsonl');
  ok(`refusals.jsonl: ${kb(log) + kb(previousPart(log))} KB in 2 parts at most (rolls at ${logMaxBytes() / 1024} KB; CONTROLS_LOG_MAX_KB to change)`);
  const c = createLimits(dir).check('rogue_test', { amount: 1e12, to: '(rogue counterparty)', after: {} });
  if (c.ok) no(`the rogue test PASSED the limits${c.wouldRefuse ? ' (shadow mode)' : ''}: these limits don't stop anything`);
  else if (c.rule === 'stop') wa('rogue test refused by STOP only: the policy itself was not tested. Run doctor again after "start"');
  else ok(`rogue test refused (${c.rule})`);
  console.log(`doctor: ${bad} problem(s), ${warn} warning(s)`);
  return bad ? 1 : 0;
}

main().then((code) => process.exit(code ?? 0), (e) => { console.error(`controls: ${e.message}`); process.exit(1); });
