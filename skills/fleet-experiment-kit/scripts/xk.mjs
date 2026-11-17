#!/usr/bin/env node
// xk.mjs: the fleet experiment kit's one command. Zero dependencies, Node 20+. It reads and writes only the experiments
// folder you point it at (and reads fleet-dashboard history if you collect from it). It never talks to an agent.
//
//   node xk.mjs --demo [--keep <dir>]                 an invented crew, five experiments, every verdict; then the gates
//   node xk.mjs gates [--gates my-gates.mjs …]        every gate must show it says no (exit 1 if one doesn't)
//   node xk.mjs register --dir <experiments>          check register.json, write register.md
//   node xk.mjs collect  --dir <experiments> [--history <fleet-dashboard dataDir>]
//   node xk.mjs log      --dir <experiments> --exp <id> --agent <key> --arm T|C|baseline --metric <m>
//                        (--value <n> --proof "<where it came from>" | --claimed "<what the agent says>")
//                        [--pair <n>] [--flags a,b] [--not-measured "<why>"]
//   node xk.mjs arm      <exp id> <window n> [--seed s]   which pair and arm the n-th window of a paired row runs
//   node xk.mjs readout  --dir <experiments> <id>
//   node xk.mjs review   --dir <experiments> [--now <ISO>] [--tz <IANA zone>] [--dry]
//   node xk.mjs decide   --dir <experiments> <id> KEEP|REVERT|EXTEND|INCONCLUSIVE|CLOSE [--why "…"] [--early "…"]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRegister, saveRegister, decide, isOpen } from './lib/register.mjs';
import { appendOutcome, readOutcomes } from './lib/outcomes.mjs';
import { evaluate } from './lib/bars.mjs';
import { collectAll } from './lib/collect.mjs';
import { review, writeReview, dateIn } from './lib/review.mjs';
import { runGates, formatGates } from './lib/gates.mjs';
import { BUILTIN_GATES } from './lib/builtin-gates.mjs';
import { armForWindow } from './lib/arms.mjs';
import { buildDemo } from './lib/demo.mjs';
import { mask } from './lib/mask.mjs';

export const VERSION = '0.1.0';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const opts = (n) => argv.flatMap((a, i) => (a === n && i + 1 < argv.length ? [argv[i + 1]] : []));
const VALUE_FLAGS = ['--dir', '--history', '--exp', '--agent', '--arm', '--metric', '--value', '--proof', '--claimed', '--pair', '--flags', '--not-measured', '--seed', '--now', '--tz', '--why', '--early', '--gates', '--keep'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]));
const die = (msg) => { console.error(mask(msg)); process.exit(2); };
const dirOf = () => { const d = opt('--dir'); if (!d) die('--dir <experiments folder> is required'); return path.resolve(d); };
const nowOf = () => { const n = opt('--now'); if (!n) return Date.now(); const t = Date.parse(n); if (!Number.isFinite(t)) die('--now must be an ISO time'); return t; };

async function gates() {
  const all = [...BUILTIN_GATES];
  for (const f of opts('--gates')) {
    const m = await import(pathToFileURL(path.resolve(f)).href);
    const list = m.default ?? m.gates;
    if (!Array.isArray(list)) die(`${f}: export default a list of gates`);
    all.push(...list);
  }
  const res = await runGates(all);
  console.log(formatGates(res));
  return res.ok;
}

function readoutLine(row, r) {
  return `${row.id}: ${r.state.toUpperCase()}  ${r.numberText}  ·  ${r.sampleText} (min ${row.minSample})${r.stop ? `  ·  STOP: ${r.stop}` : ''}${r.unscored.guard ? `  ·  ${r.unscored.guard} dropped by the reward guard` : ''}${r.unscored.gap ? `  ·  ${r.unscored.gap} not measured` : ''}${r.unscored.unconfirmed ? `  ·  ${r.unscored.unconfirmed} unconfirmed` : ''}`;
}

async function main() {
  const cmd = flag('--demo') ? 'demo' : positional[0];
  if (flag('--version')) return console.log(VERSION);
  if (!cmd || flag('--help')) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 16).map((l) => l.slice(3)).join('\n'));
    return;
  }

  if (cmd === 'demo') {
    const keep = opt('--keep');
    const root = keep ? path.resolve(keep) : fs.mkdtempSync(path.join(os.tmpdir(), 'xk-demo-'));
    if (keep && fs.existsSync(root) && fs.readdirSync(root).length) die(`--keep ${keep}: the folder must be new or empty`);
    try {
      const { exp, now } = buildDemo(root, { now: nowOf() });
      const reg = loadRegister(exp);
      const got = collectAll(exp, reg.rows, { now });
      console.log(`demo: invented crew in ${keep ? root : 'a temporary folder'}; collected ${Object.entries(got).map(([k, v]) => `${v.written} hour windows for ${k} (${v.gaps} not measured)`).join(', ')}\n`);
      const res = review(exp, { now });
      writeReview(exp, res);
      console.log(res.md);
      console.log('─'.repeat(72) + '\n');
      const ok = await gates();
      if (keep) console.log(`\nkept: ${root}  (experiments/ and fleet-data/; try: node xk.mjs readout --dir ${path.join(root, 'experiments')} tide-table)`);
      process.exitCode = ok ? 0 : 1;
    } finally { if (!keep) fs.rmSync(root, { recursive: true, force: true }); }
    return;
  }

  if (cmd === 'gates') { process.exitCode = (await gates()) ? 0 : 1; return; }

  if (cmd === 'arm') {
    const [, id, n] = positional;
    if (!id || !/^\d+$/.test(n ?? '')) die('usage: arm <exp id> <window number from 1> [--seed s]');
    const a = armForWindow(id, +n, opt('--seed') ?? '');
    console.log(JSON.stringify({ exp: id, window: +n, ...a }));
    return;
  }

  const dir = dirOf();
  const reg = loadRegister(dir);

  if (cmd === 'register') {
    if (reg.errors.length) { for (const e of reg.errors) console.log(`✗ ${e}`); process.exitCode = 1; }
    if (reg.raw) { saveRegister(dir, reg.raw); console.log(`${reg.errors.length ? '' : '✓ '}${reg.rows.length} rows (${reg.rows.filter(isOpen).length} open); wrote register.md`); }
    return;
  }
  if (!reg.raw) die(reg.errors.join('; '));

  if (cmd === 'collect') {
    const h = opt('--history');
    const got = collectAll(dir, reg.rows, { now: nowOf(), dataDir: h ? path.resolve(h) : undefined });
    if (!Object.keys(got).length) console.log('no open row has source.type "fleet-dashboard"; nothing to collect');
    for (const [id, v] of Object.entries(got)) console.log(`${id}: ${v.written} windows written (${v.gaps} not measured)`);
    return;
  }

  if (cmd === 'log') {
    const rec = { t: nowOf(), exp: opt('--exp'), agent: opt('--agent'), arm: opt('--arm'), metric: opt('--metric') };
    if (opt('--pair')) rec.pair = Number(opt('--pair'));
    if (opt('--flags')) rec.flags = opt('--flags').split(',').filter(Boolean);
    if (opt('--not-measured')) Object.assign(rec, { ok: false, why: opt('--not-measured'), confirmed: false });
    else if (opt('--claimed') !== null) Object.assign(rec, { value: opt('--value') === null ? 1 : Number(opt('--value')), confirmed: false, claimed: opt('--claimed') });
    else Object.assign(rec, { value: Number(opt('--value') ?? NaN), confirmed: opt('--proof') !== null, ...(opt('--proof') !== null ? { proof: opt('--proof') } : {}) });
    const row = reg.rows.find((r) => r.id === rec.exp);
    if (!row) die(`no row "${rec.exp}" in register.json: register the experiment (bar first) before logging for it`);
    try { appendOutcome(dir, rec); } catch (e) { die(e.message); }
    console.log('logged');
    return;
  }

  if (cmd === 'readout') {
    const id = positional[1], row = reg.rows.find((r) => r.id === id);
    if (!row) die(`no row "${id}"`);
    const r = evaluate(row, readOutcomes(dir, { exp: id }), nowOf());
    console.log(readoutLine(row, r));
    return;
  }

  if (cmd === 'review') {
    const res = review(dir, { now: nowOf(), timeZone: opt('--tz') ?? 'UTC' });
    if (flag('--dry')) console.log(res.md); else console.log(`wrote ${writeReview(dir, res)}\n\n${res.md}`);
    return;
  }

  if (cmd === 'decide') {
    const [, id, verdict] = positional;
    const row = reg.rows.find((r) => r.id === id);
    if (!row) die(`no row "${id}"`);
    const now = nowOf();
    const r = isOpen(row) && row.liveSince ? evaluate(row, readOutcomes(dir, { exp: id }), now) : null;
    let status;
    try { status = decide(row, verdict, r, { today: dateIn(now, opt('--tz') ?? 'UTC'), early: opt('--early'), why: opt('--why') }); } catch (e) { die(e.message); }
    row.status = status;
    if (opt('--why') && verdict !== 'CLOSE') (row.notes ??= []).push({ at: new Date(now).toISOString(), kind: 'decision', text: `${opt('--why')}` });
    saveRegister(dir, reg.raw);
    console.log(`${id}: ${status}`);
    return;
  }

  die(`unknown command "${cmd}" (try --help)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => die(`xk: ${e.message}`));
