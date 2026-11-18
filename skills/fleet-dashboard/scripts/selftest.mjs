#!/usr/bin/env node
// selftest.mjs: checks the dashboard with no network, no browser and no real agents (a fake fleet, a fake City
// helper, temporary folders). Prints one line per check and a summary.
//   node selftest.mjs        expect "selftest: N ok, 0 failed"
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, normalize, sampleOne } from './adapters/index.mjs';
import { totalsAt } from './adapters/fake.mjs';
import { parseConfig, loadConfig } from './lib/config.mjs';
import { mask } from './lib/mask.mjs';
import { xpInto, strip, stripXp, output, prune, appendRound, makeReader, GAP_EST } from './lib/history.mjs';
import { timeOf, logFacts } from './lib/logs.mjs';
import { listAsks, answerAsk } from './lib/asks.mjs';
import { agentStatus, skillColors, buildFleet, PALETTE, activeAgents } from './lib/fleet.mjs';
import { parseJob, numberView, lastDidOf, jobsFromFile, retiredOf, jobsFileReport } from './lib/jobs.mjs';
import { round } from './lib/sampler.mjs';
import { createServer } from './lib/server.mjs';
import { buildDemo } from './lib/demo.mjs';
import { launchdPlist, systemdUnit } from './install.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPS = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TEMPS.push(d); return d; };
let ok = 0, failed = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : `  (${extra})`}`); };
const MIN = 60_000, NOW = Date.UTC(2026, 10, 17, 12, 7);
const cfg = (agents, extra = {}) => parseConfig({ agents, ...extra }, path.join(os.tmpdir(), 'x', 'fleet.json'), ADAPTERS);

// ── config ──
{
  const r = loadConfig(path.join(HERE, 'fleet.example.json'), ADAPTERS);
  check('the example config is valid', r.errors.length === 0, r.errors.join('; '));
  check('~/ paths expand to the home folder', r.config.agents[0].log === path.join(os.homedir(), 'my-driver/log.jsonl'));
  check('relative paths are taken from the config folder', r.config.dataDir === path.join(HERE, 'fleet-data'));
  const bad = (agents, extra, word) => { const e = cfg(agents, extra).errors; return e.some((x) => x.includes(word)) || e; };
  const f = { adapter: 'fake' };
  check('a key with a slash is refused', bad([{ key: '../x', ...f }], {}, '.key must be') === true);
  check('a key used twice is refused', bad([{ key: 'a', ...f }, { key: 'a', ...f }], {}, 'used twice') === true);
  check('an unknown adapter is refused and the known ones named', bad([{ key: 'a', adapter: 'nope' }], {}, 'midnight-city') === true);
  check('only one main agent', bad([{ key: 'a', main: true, ...f }, { key: 'b', main: true, ...f }], {}, 'only one') === true);
  check('fake agents can\'t sit next to real ones', bad([{ key: 'a', ...f }, { key: 'b', adapter: 'file', file: { path: 'x.json' } }], {}, 'can\'t be mixed') === true);
  check('a proxy host needs a login allow list', bad([{ key: 'a', ...f }], { access: { hosts: ['deck.example.net'] } }, 'allowLogins') === true);
  check('a log counter needs a (group)', bad([{ key: 'a', ...f, logCounters: { coins: 'coins=\\d+' } }], {}, 'group') === true);
  check('a wrong time zone is refused', bad([{ key: 'a', ...f }], { timeZone: 'Mars/Base' }, 'time zone') === true);
  check('midnight-city needs skillDir and agentId', bad([{ key: 'a', adapter: 'midnight-city', 'midnight-city': {} }], {}, 'agentId') === true);
  check('midnight-city helper must stay inside skillDir', bad([{ key: 'a', adapter: 'midnight-city', 'midnight-city': { skillDir: 'x', agentId: 'abc-1', helper: '../evil.mjs' } }], {}, 'inside skillDir') === true);
  check('command adapter takes a list, not a shell string', bad([{ key: 'a', adapter: 'command', command: { run: 'node x.mjs' } }], {}, 'no shell') === true);
  check('agent links must be https', bad([{ key: 'a', ...f, links: [{ label: 'x', url: 'javascript:alert(1)' }] }], {}, 'https') === true);
}

// ── masking ──
{
  const home = os.platform() === 'win32' ? ['C:', 'Users', 'someone'].join('\\') : ['', 'Users', 'someone'].join('/');   // built at run time so the repo's leak gate stays quiet
  const cases = [
    [['api', 'key'].join('_') + '=' + 'abcd1234efgh5678', 'abcd1234'], ['token: "s3cr3tvalue99"', 's3cr3t'], ['Authorization: Bearer abc.def-ghi_jkl123', 'abc.def'],
    ['key ' + ['sk', 'ant', 'api03', 'A'.repeat(24)].join('-'), 'AAAAAAAAAAAAAAAA'], ['ghp_' + 'a'.repeat(36), 'ghp_aaaa'],
    [['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'c2lnbmF0dXJlMTIz'].join('.'), 'eyJhbGci'], ['blob ' + 'Q'.repeat(40), 'QQQQQQQQ'],
    [`file ${home}/agents/log.txt`, 'someone'], ['seed: abandon ability able about above absent absorb abstract absurd abuse access accident', 'abandon ability'],
    ['words abandon ability able about above absent absorb abstract absurd abuse access accident', 'abandon ability'],
  ];
  for (const [inp, leak] of cases) check(`mask hides "${inp.slice(0, 22)}…"`, !mask(inp).includes(leak), mask(inp));
  check('mask keeps agent ids with dashes and plain words', mask('agent user-agent-1234abcd-12ab mined 40 ore') === 'agent user-agent-1234abcd-12ab mined 40 ore');
  check('mask strips terminal colours and control characters', mask('\x1b[31mred\x1b[0m\x07!') === 'red!');
}

// ── history maths ──
{
  const t0 = NOW - 60 * MIN, bin = 15 * MIN;
  const bins = () => Array.from({ length: 4 }, () => ({ xp: {}, cov: false, est: false }));
  const rec = (t, xp) => ({ t, a: { k: { xp } } });
  let b = bins(); xpInto(b, [rec(t0, { a: 100 }), rec(t0 + 30 * MIN, { a: 400 })], 'k', t0, bin);
  check('a gain is spread evenly over the time between two readings', Math.round(b[0].xp.a) === 150 && Math.round(b[1].xp.a) === 150 && !b[2].cov, JSON.stringify(b));
  check('a 30-minute gap is marked as estimated', b[0].est === true && 30 * MIN > GAP_EST);
  b = bins(); xpInto(b, [rec(t0, { a: 100 }), rec(t0 + 5 * MIN, { a: 160 }), rec(t0 + 10 * MIN, { a: 50 })], 'k', t0, bin);
  check('a counter reset adds nothing (never negative)', Math.round(b[0].xp.a) === 60 && !b[0].est);
  b = bins(); xpInto(b, [rec(t0 - 7 * 3_600_000, { a: 1 }), rec(t0 + 5 * MIN, { a: 9999 })], 'k', t0, bin);
  check('readings more than 6 h apart are not bridged', !b[0].xp.a);
  const recs = []; for (let t = NOW - 7 * 3_600_000; t <= NOW; t += 5 * MIN) recs.push(rec(t, { a: (t - (NOW - 7 * 3_600_000)) / MIN * 10, b: 5 }));
  const st = strip(recs, 'k', NOW);
  check('the card strip is 24 bars of 15 minutes', st.bins.length === 24 && st.bin === 15 * MIN);
  check('the card strip adds up to the gain in its window', Math.abs(stripXp(st) - 3520) <= 24, String(stripXp(st)));
  const out = output(recs, ['k'], NOW);
  check('the 24-hour graph is 48 bars of 30 minutes with totals', out.bins.length === 48 && out.totals.xp === out.bins.reduce((n, x) => n + x.total, 0) && out.skills[0].skill === 'a');
  check('the 24-hour graph says when readings started', out.historyFrom === recs[0].t);
  const d = tmp('fd-hist-');
  for (const t of [NOW - 9 * 86_400_000, NOW - 86_400_000, NOW]) appendRound(d, { t, v: 1, a: {} });
  const gone = prune(d, 7, NOW);
  check('files older than keepDays are deleted, newer ones kept', gone.length === 1 && fs.readdirSync(path.join(d, 'history')).length === 2);
  fs.appendFileSync(path.join(d, 'history', fs.readdirSync(path.join(d, 'history')).sort().pop()), '{"t": 12, "a": {}\n');
  check('a half-written history line is skipped', makeReader(d)(NOW - 3_600_000).length === 1);
  check('history files are private to the owner', os.platform() === 'win32' || (fs.statSync(path.join(d, 'history')).mode & 0o077) === 0);
}

// ── logs ──
{
  check('time from "[ISO] text"', timeOf('[2026-11-17T08:00:00Z] hi') === Date.parse('2026-11-17T08:00:00Z'));
  check('time from "YYYY-MM-DD HH:MM:SS text"', timeOf('2026-11-17 08:00:00Z hi') === Date.parse('2026-11-17T08:00:00Z'));
  check('time from a JSON line ("t": ISO)', timeOf('{"t":"2026-11-17T08:00:00.000Z","event":"act"}') === Date.parse('2026-11-17T08:00:00Z'));
  check('time from a JSON line ("ts": seconds)', timeOf('{"ts":1763366400}') === 1763366400000);
  check('no time in a plain line', timeOf('just text') === null);
  const d = tmp('fd-log-'), f = path.join(d, 'a.log');
  const iso = (m) => new Date(NOW - m * MIN).toISOString();
  fs.writeFileSync(f, [`[${iso(40)}] WARN old`, `[${iso(30)}] coins=10`, `[${iso(10)}] WARN one`, `[${iso(5)}] WARN two coins=12`, `[${iso(2)}] fine`].join('\n') + '\n');
  const lf = logFacts({ log: f, warnPattern: /WARN/, logCounters: { coins: /coins=(\d+)/ } }, NOW);
  {   // a log rewritten in place within one mtime tick (Linux's mtime clock is coarse), lines of the same length
    const g = path.join(d, 'same.log'), A = '[2026-11-17T08:00:00Z] state A\n', B = '[2026-11-17T08:00:00Z] state B\n';
    const t0 = new Date(Math.floor(Date.now() / 1000) * 1000);   // a whole second, so both writes really share one mtime
    fs.writeFileSync(g, A); fs.utimesSync(g, t0, t0); logFacts({ log: g }, NOW);
    fs.writeFileSync(g, B); fs.utimesSync(g, t0, t0);
    check('log cache: a same-size rewrite with the same mtime is read again, not served stale', logFacts({ log: g }, NOW).lines.at(-1).endsWith('state B'));
  }
  check('log facts: last time, warnings in 15 min only, last counter', lf.lastAt === NOW - 2 * MIN && lf.warns === 2 && lf.counters.coins === 12, JSON.stringify({ ...lf, lines: undefined }));
}

// ── asks ──
{
  const d = tmp('fd-asks-');
  fs.writeFileSync(path.join(d, 'A1.json'), JSON.stringify({ id: 'A1', agent: 'scout', question: 'Sell 10 fish?\u0007', draft: 'yes', at: new Date(NOW).toISOString() }));
  fs.writeFileSync(path.join(d, 'B2.json'), JSON.stringify({ id: 'B2', agent: 'stranger', question: 'Hi' }));
  fs.writeFileSync(path.join(d, 'C3.json'), JSON.stringify({ id: 'other', question: 'mismatched id' }));
  let l = listAsks(d, ['scout']);
  check('asks: open asks listed, unknown agents blanked, mismatched ids skipped', l.asks.length === 2 && l.asks.every((x) => x.open) && l.asks.find((x) => x.id === 'B2').agent === null);
  check('asks: control characters stripped from the question', l.asks.find((x) => x.id === 'A1').question === 'Sell 10 fish?');
  check('answer: bad id refused', answerAsk(d, { id: '../A1', verdict: 'ok' })[0] === 400);
  check('answer: unknown verdict refused', answerAsk(d, { id: 'A1', verdict: 'maybe' })[0] === 400);
  check('answer: "own" needs text', answerAsk(d, { id: 'A1', verdict: 'own', text: '  ' })[0] === 400);
  check('answer: too long refused', answerAsk(d, { id: 'A1', verdict: 'own', text: 'x'.repeat(501) })[0] === 400);
  check('answer: no such ask', answerAsk(d, { id: 'Z9', verdict: 'ok' })[0] === 404);
  check('answer: written once', answerAsk(d, { id: 'A1', verdict: 'own', text: 'Sell 5 only' })[0] === 200);
  const a = JSON.parse(fs.readFileSync(path.join(d, 'answers', 'A1.json'), 'utf8'));
  check('answer file says what you chose and nothing else', a.id === 'A1' && a.verdict === 'own' && a.text === 'Sell 5 only' && a.by === 'fleet-dashboard');
  check('answer file is private to the owner', os.platform() === 'win32' || (fs.statSync(path.join(d, 'answers', 'A1.json')).mode & 0o077) === 0);
  check('answer: a second answer is refused (409)', answerAsk(d, { id: 'A1', verdict: 'skip' })[0] === 409);
  check('the ask file itself is never changed', JSON.parse(fs.readFileSync(path.join(d, 'A1.json'), 'utf8')).draft === 'yes');
  l = listAsks(d, ['scout']); check('an answered ask is no longer open', l.asks.find((x) => x.id === 'A1').open === false);
  check('asks off when no asksDir', listAsks(null, []).enabled === false && answerAsk(null, { id: 'A1', verdict: 'ok' })[0] === 404);
}

// ── adapters ──
{
  const n = normalize({ xp: { Mining: 10, 'bad/skill': 5, neg: -1, str: 'x' }, doing: { label: 'gather <b>', detail: 'pine' }, position: { space: '../etc' }, counters: { coins: 3, 'b-ad': 1 }, extra: 'dropped' });
  check('normalize keeps only clean fields', JSON.stringify(n) === JSON.stringify({ xp: { mining: 10 }, c: { coins: 3 } }), JSON.stringify(n));
  const n2 = normalize({ doing: { label: 'mining', detail: 'pine ' + 'Q'.repeat(40) }, position: { space: 'quarry', name: 'The Quarry' } });
  check('normalize masks what it keeps', n2.act.detail === 'pine [masked]' && n2.act.space === 'quarry' && n2.act.name === 'The Quarry', JSON.stringify(n2));
  const fa = { key: 'wren', opts: { skills: ['fishing', 'smithing'] } };
  const x1 = totalsAt(fa, NOW), x2 = totalsAt(fa, NOW + 47 * MIN);
  check('fake: the same moment gives the same numbers', JSON.stringify(totalsAt(fa, NOW)) === JSON.stringify(x1));
  check('fake: running totals only go up', Object.keys(x1).every((k) => x2[k] >= x1[k]));
  const off = await sampleOne({ key: 'b', adapter: 'fake', opts: { offlineSince: NOW - MIN } }, { now: NOW });
  check('fake: an offline agent reads as an error', off.err === 'agent offline (fake)');

  // a stand-in for the City's helper: answers `progression`, records what it was given
  const skill = tmp('fd-city-'), rec = path.join(skill, 'seen.json');
  fs.mkdirSync(path.join(skill, 'scripts'));
  fs.writeFileSync(path.join(skill, 'scripts', 'mcity-control.mjs'), `import fs from 'node:fs';
const [cmd, id] = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(rec)}, JSON.stringify({ cmd, id, cwd: process.cwd(), env: Object.keys(process.env).filter((k) => !k.startsWith('__CF') && k !== 'PWD' && k !== 'SHLVL' && k !== '_') }));
if (id === 'bad-agent') { console.error('Error: 401 for token ' + ['sk', 'live', 'ABCDEFGHIJKLMNOP1234'].join('_')); process.exit(1); }
if (id === 'room-agent') { console.log(JSON.stringify({ skills: {}, agent: { position: { spaceId: 'agent-room:9f8e7d6c' } } })); process.exit(0); }
console.log(JSON.stringify({ skills: { hacking: { xp: 1200, level: 3 }, mining: { xp: 0 } }, agent: { isPerformingJob: true, activeAction: { activity: 'gather_resource', phase: 'working' }, position: { spaceId: 'hacker-house-interior' } } }));
`);
  const city = (id) => ({ key: 'c', adapter: 'midnight-city', base: skill, opts: { skillDir: skill, agentId: id } });
  process.env.SOME_SECRET_FOR_TEST = 'x';
  const s = await sampleOne(city('agent-one'), { now: NOW });
  const seen = JSON.parse(fs.readFileSync(rec, 'utf8'));
  check('midnight-city: one read-only "progression" call for that agent', seen.cmd === 'progression' && seen.id === 'agent-one');
  check('midnight-city: runs from the skill folder (so the helper finds its own .env)', fs.realpathSync(seen.cwd) === fs.realpathSync(skill));
  check('midnight-city: passes the helper only PATH and HOME', seen.env.sort().join(',') === 'HOME,PATH', seen.env.join(','));
  check('midnight-city: xp, doing and place from the answer', s.xp.hacking === 1200 && !('mining' in s.xp) && s.act.label === 'gather resource' && s.act.space === 'hacker-house-interior' && s.act.name === 'Hacker House', JSON.stringify(s));
  const room = await sampleOne(city('room-agent'), { now: NOW });
  check('midnight-city: a private room never shows its id', room.act.space === 'private-room' && !JSON.stringify(room).includes('9f8e7d6c'));
  const badS = await sampleOne(city('bad-agent'), { now: NOW });
  check('midnight-city: a helper error is kept short and masked', /exit 1/.test(badS.err) && !badS.err.includes('ABCDEFGHIJ'), badS.err);
  const none = await sampleOne({ key: 'c', adapter: 'midnight-city', base: skill, opts: { skillDir: path.join(skill, 'nope'), agentId: 'a-1' } }, { now: NOW });
  check('midnight-city: a missing helper says so', /no scripts\/mcity-control\.mjs/.test(none.err));
  const m = ADAPTERS['midnight-city'].map();
  check('midnight-city: map has the 12 places and Central\'s buildings', m.tiles.length === 12 && m.rooms.in === 'central' && m.rooms.list.some((r) => r.label === 'Hacker House'));

  const cmd = (run, env) => ({ key: 'x', adapter: 'command', base: HERE, opts: { run, ...(env ? { env } : {}) } });
  const c1 = await sampleOne(cmd([process.execPath, '-e', 'console.log(JSON.stringify({xp:{reading:5},doing:{label:"reading"},env:Object.keys(process.env)}))']), { now: NOW });
  check('command: reads the JSON it prints', c1.xp.reading === 5 && c1.act.label === 'reading');
  const c2 = await sampleOne(cmd([process.execPath, '-e', 'console.log(JSON.stringify({counters:{has:process.env.SOME_SECRET_FOR_TEST?1:0, listed:process.env.FD_LISTED?1:0}}))'], ['FD_LISTED']), { now: NOW });
  process.env.FD_LISTED = 'y';
  const c3 = await sampleOne(cmd([process.execPath, '-e', 'console.log(JSON.stringify({counters:{has:process.env.SOME_SECRET_FOR_TEST?1:0, listed:process.env.FD_LISTED?1:0}}))'], ['FD_LISTED']), { now: NOW });
  check('command: only PATH, HOME and the variables you list pass through', c2.c.has === 0 && c2.c.listed === 0 && c3.c.has === 0 && c3.c.listed === 1);
  const c4 = await sampleOne(cmd([process.execPath, '-e', 'console.log("hello")']), { now: NOW });
  check('command: no JSON is a failed read', c4.err === 'the status command did not print JSON');
  const c5 = await sampleOne(cmd([process.execPath, '-e', 'setTimeout(()=>{}, 60000)']), { now: NOW, timeoutMs: 3000 });
  check('command: a hung command times out', /timed out|no answer/.test(c5.err ?? ''), c5.err);
  const c7 = await sampleOne(cmd([process.execPath, path.join(HERE, 'no-such-status-script.mjs')]), { now: NOW });
  check('command: a failing status script shows its error line, not Node\'s version footer', /exit 1: .*Cannot find module/.test(c7.err ?? '') && !/Node\.js v\d/.test(c7.err ?? ''), c7.err);
  const c6 = await sampleOne(cmd(['definitely-not-a-command-fd']), { now: NOW });
  check('command: a missing program says so', /not found/.test(c6.err ?? ''), c6.err);

  const fd = tmp('fd-file-'), sf = path.join(fd, 'status.json');
  fs.writeFileSync(sf, JSON.stringify({ xp: { notes: 7 } }));
  const fa1 = await sampleOne({ key: 'f', adapter: 'file', base: fd, opts: { path: sf } }, { now: Date.now() });
  check('file: reads a fresh status file', fa1.xp?.notes === 7);
  const old = new Date(Date.now() - 45 * MIN); fs.utimesSync(sf, old, old);
  const fa2 = await sampleOne({ key: 'f', adapter: 'file', base: fd, opts: { path: sf, maxAgeMinutes: 20 } }, { now: Date.now() });
  check('file: a stale status file is a failed read', /45 min old/.test(fa2.err ?? ''), fa2.err);
}

// ── lights, places, colours ──
{
  const d = tmp('fd-light-');
  const { config } = cfg([{ key: 'a', adapter: 'fake', log: path.join(d, 'a.log'), pauseFile: path.join(d, 'PAUSE'), staleMinutes: 30, warnPattern: 'WARN' }]);
  const a = config.agents[0];
  const r = (t, x) => ({ t, a: { a: x } });
  const good = [r(NOW - 10 * MIN, { xp: { x: 1 }, act: { label: 'mining', space: 'quarry', name: 'Quarry' } })];
  const log = (age, extra = []) => { fs.writeFileSync(a.log, [...extra, `[${new Date(NOW - age * MIN).toISOString()}] ok`].join('\n') + '\n'); };
  log(2); check('green: fresh log, good reading', agentStatus(a, good, NOW, 5).light === 'green');
  check('place: shown while 20 minutes old or less', agentStatus(a, good, NOW, 5).place?.name === 'Quarry');
  check('place: dropped when older than 20 minutes', agentStatus(a, good, NOW + 15 * MIN, 5).place === null);
  log(45); check('red: log quiet longer than staleMinutes', (() => { const s = agentStatus(a, good, NOW, 5); return s.light === 'red' && s.why[0] === 'log quiet 45 min'; })());
  fs.writeFileSync(a.pauseFile, ''); check('yellow, not red: paused agents are allowed a quiet log', (() => { const s = agentStatus(a, good, NOW, 5); return s.light === 'yellow' && s.doing.label === 'paused'; })());
  const P = (o) => fs.writeFileSync(a.pauseFile, JSON.stringify(o));
  P({ by: 'owner', at: new Date(NOW - 60 * MIN).toISOString(), until: new Date(NOW + 10 * MIN).toISOString() });
  check('yellow: a PAUSE whose until is still ahead', (() => { const s = agentStatus(a, good, NOW, 5); return s.light === 'yellow' && s.paused === true; })());
  P({ by: 'owner', at: new Date(NOW - 60 * MIN).toISOString(), until: new Date(NOW - MIN).toISOString() });
  check('an expired PAUSE (left in place) no longer counts: not paused, quiet log is red again', (() => { const s = agentStatus(a, good, NOW, 5); return s.paused === false && s.light === 'red' && !s.why.includes('paused') && s.doing?.label !== 'paused'; })());
  log(2); check('an expired PAUSE with a fresh log is green', (() => { const s = agentStatus(a, good, NOW, 5); return s.light === 'green' && s.paused === false; })());
  log(45);
  P({ by: 'owner', until: 'tomorrow-ish' }); check('a PAUSE with an until that is not a date stays paused', agentStatus(a, good, NOW, 5).paused === true);
  fs.writeFileSync(a.pauseFile, 'not json'); check('a PAUSE that is not JSON stays paused', agentStatus(a, good, NOW, 5).paused === true);
  fs.rmSync(a.pauseFile); fs.rmSync(a.log); check('red: the configured log is missing', agentStatus(a, good, NOW, 5).why.includes('no log at the configured path'));
  log(1, [1, 2, 3].map((k) => `[${new Date(NOW - k * MIN).toISOString()}] WARN x`)); check('yellow: 3 warnings in 15 minutes', agentStatus(a, good, NOW, 5).why.includes('3 warnings in 15 min'));
  log(1); check('yellow: the last read failed (with its reason)', agentStatus(a, [...good, r(NOW - MIN, { err: 'helper timed out' })], NOW, 5).why.includes('last read failed: helper timed out'));
  const { config: c2 } = cfg([{ key: 'a', adapter: 'fake', staleMinutes: 30 }]);
  check('no log: yellow until the first reading', agentStatus(c2.agents[0], [], NOW, 5).light === 'yellow');
  check('no log: red when readings stop', agentStatus(c2.agents[0], [r(NOW - 50 * MIN, { xp: { x: 1 } })], NOW, 5).light === 'red');
  const recs = []; for (let t = NOW - 3 * 3_600_000; t <= NOW; t += 5 * MIN) recs.push({ t, a: { a: { xp: { alpha: (t / MIN) * 3, beta: (t / MIN) * 2, fishing: t / MIN } } } });
  const { config: c3 } = cfg([{ key: 'a', adapter: 'file', file: { path: 's.json' } }], { skillColors: { beta: '#123456', fishing: '#199e70' } });
  const sc = skillColors(c3, recs, NOW);
  check('colours: a pinned colour wins', sc.colors.beta === '#123456');
  check('colours: the fake adapter pins its own colours', skillColors(c2, recs, NOW).colors.fishing === ADAPTERS.fake.skillColors.fishing);
  check('colours: no two skills share a colour', new Set(Object.values(sc.colors)).size === Object.keys(sc.colors).length);
  check('colours: other skills get free palette colours', PALETTE.includes(sc.colors.alpha));
}

// ── jobs, the last thing done, retired agents ──
{
  const pj = (j) => parseJob(j, 'job');
  check('job: a title is required', pj({ number: { label: 'x', xp: 'mining' } }).errors.some((e) => e.includes('.title')));
  check('job: the number needs exactly one source', pj({ title: 'T', number: { label: 'x', xp: 'mining', counter: 'coins' } }).errors.some((e) => e.includes('exactly one')) && pj({ title: 'T', number: { label: 'x' } }).errors.length === 1);
  check('job: an unknown status is refused', pj({ title: 'T', status: 'maybe' }).errors.some((e) => e.includes('status')));
  check('job: title, slot and status kept, masked and capped', (() => { const j = pj({ title: 'Mining <b>the</b> Quarry ' + 'Q'.repeat(40), slot: 'night', status: 'testing' }).job; return j.title.startsWith('Mining bthe/b Quarry [masked]') && j.slot === 'night' && j.status === 'testing'; })());
  const good = { xp: { mining: 4_375_104 }, c: { rank: 12 } };
  check('number: an XP total, shortened', numberView(pj({ title: 'T', number: { label: 'Mining XP', xp: 'mining' } }).job.number, good, {}).value === '4.4M XP');
  check('number: a counter shown as a rank', numberView(pj({ title: 'T', number: { label: 'Board', counter: 'rank', as: 'rank' } }).job.number, good, good.c).value === '#12');
  check('number: a value you keep, with its date', (() => { const v = numberView(pj({ title: 'T', number: { label: 'Board', value: '#14', asOf: 'Nov 17' } }).job.number, null, {}); return v.value === '#14' && v.live === false && v.note === 'as of Nov 17'; })());
  check('number: not read yet says so (never a made-up 0)', (() => { const v = numberView(pj({ title: 'T', number: { label: 'Coins', counter: 'coins' } }).job.number, good, {}); return v.value === '—' && v.note === 'not read yet'; })());
  const rules = [{ re: /DONE (\w+) block · \+([\d,]+) XP/, say: '$1 block done, +$2 XP' }, { re: /SOLD (\d+) (\w+) to (\S+)/, say: 'sold $1 $2 to $3' }];
  const L = (m, x) => `[${new Date(NOW - m * MIN).toISOString()}] ${x}`;
  const lines = [L(30, 'DONE fishing block · +1,200 XP'), L(20, 'SOLD 4 mackerel to someone'), L(10, 'DONE wood_cutting block · +900 XP'), L(2, 'status: fine')];
  const ld = lastDidOf(lines, rules, timeOf);
  check('last: the newest line a rule matches, with its time', ld.text === 'wood cutting block done, +900 XP' && ld.t === NOW - 10 * MIN, JSON.stringify(ld));
  check('last: only the (groups) are copied, and they are masked', lastDidOf([L(1, 'SOLD 2 fish to ' + ['sk', 'live', 'ABCDEFGHIJKLMNOP1234'].join('_') + ' and a secret chat line')], rules, timeOf).text === 'sold 2 fish to [masked]');
  check('last: no rule or no match → nothing', lastDidOf(lines, [], timeOf) === null && lastDidOf(['plain'], rules, timeOf) === null);
  const ex = loadConfig(path.join(HERE, 'fleet.example.json'), ADAPTERS).config.agents[0];
  const J = (o) => JSON.stringify({ t: new Date(NOW).toISOString(), ...o });
  check('last: the city-driver-starter recipe shows only actions the City confirmed', lastDidOf([J({ event: 'act', act: ['gather', 'pine_tree'], why: 'job', submitted: true, result: 'confirmed' }), J({ event: 'act', act: ['eat'], submitted: true, result: 'failed', reason: 'no food' }), J({ event: 'wait', why: 'mid-action' })], ex.lastDid, timeOf)?.text === 'gather pine tree (confirmed)');
  const e1 = cfg([{ key: 'a', adapter: 'fake', lastDid: [{ match: '(', say: 'x' }] }]).errors, e2 = cfg([{ key: 'a', adapter: 'fake', lastDid: [{ match: 'x' }] }]).errors, e3 = cfg([{ key: 'a', adapter: 'fake', retired: 3 }]).errors;
  check('config: a bad lastDid regex, a rule with no words and a retired that is not true or a note are refused', e1.some((e) => e.includes('match')) && e2.some((e) => e.includes('say')) && e3.some((e) => e.includes('retired')));
  // from the 11-18 stranger test
  const e4 = cfg([{ key: 'a', adapter: 'fake', lastDid: [{ match: 'batch (\\d+): (\\d+)', say: 'batch $1, $3 items' }] }]).errors;
  check('config: a "say" that uses more $N than the match has groups is refused', e4.some((e) => e.includes('uses $3, but match has 2')), e4.join('; '));
  check('config: a bad regex says why', e1.some((e) => /match is not a valid regular expression \(.+\)/.test(e)), e1.join('; '));
  const e5 = cfg([{ key: 'a', adapter: 'fake', retired: 'false' }]);
  check('config: retired "false" (in quotes) is refused, and does not retire the agent', e5.errors.some((e) => e.includes('without quotes')) && e5.config.agents[0].retired === false);
  {
    const jd = tmp('fd-jr-'), f = path.join(jd, 'jobs.json');
    const miss = jobsFileReport(f); fs.writeFileSync(f, '{ nope'); const broken = jobsFileReport(f);
    fs.writeFileSync(f, JSON.stringify({ agents: { a: { title: 'Fine' }, b: { title: 'X', status: 'maybe' }, 'Bad Key': { title: 'x' } } })); const mixed = jobsFileReport(f);
    check('jobs file report (for --check): missing, broken and bad entries each named; good ones kept', /no file there yet/.test(miss.errors[0]) && /not valid JSON/.test(broken.errors[0]) && Object.keys(mixed.jobs).join() === 'a' && mixed.errors.some((e) => e.includes('agents.b.status')) && mixed.errors.some((e) => e.includes('"Bad Key"')));
  }

  const d = tmp('fd-jobs-'), jf = path.join(d, 'jobs.json'), log = path.join(d, 'a.log');
  fs.writeFileSync(log, lines.join('\n') + '\n');
  const { config: c } = cfg([{ key: 'a', adapter: 'fake', log, lastDid: [{ match: 'DONE (\\w+) block', say: '$1 block done' }], job: { title: 'Fishing', number: { label: 'Fishing XP', xp: 'fishing' } } },
    { key: 'b', adapter: 'fake', retired: 'moved on' }, { key: 'c', adapter: 'fake', retiredFile: path.join(d, 'c', 'RETIRED') }], { jobsFile: jf });
  const recs = [{ t: NOW - 5 * MIN, a: { a: { xp: { fishing: 5000 } } } }];
  let st = agentStatus(c.agents[0], recs, NOW, 5);
  check('card: four arguments still work (other skills call agentStatus), with the job from fleet.json', st.job.title === 'Fishing' && st.job.number.value === '5,000 XP' && st.lastDid.text === 'wood cutting block done');
  fs.writeFileSync(jf, JSON.stringify({ agents: { a: { title: 'Mining now', status: 'staged' }, b: { nope: 1 }, 'Bad Key': { title: 'x' } } }));
  st = agentStatus(c.agents[0], recs, NOW, 5, jf);
  check('jobs file: its entry wins over fleet.json, bad entries are dropped', st.job.title === 'Mining now' && st.job.status === 'staged' && Object.keys(jobsFromFile(jf, NOW)).join() === 'a');
  fs.writeFileSync(jf, JSON.stringify({ agents: { a: { title: 'Smithing' } } })); const later = new Date(Date.now() + 5000); fs.utimesSync(jf, later, later);
  check('jobs file: re-read after a minute, not before', agentStatus(c.agents[0], recs, NOW + 30_000, 5, jf).job.title === 'Mining now' && agentStatus(c.agents[0], recs, NOW + 61_000, 5, jf).job.title === 'Smithing');
  fs.writeFileSync(jf, '{ broken'); fs.utimesSync(jf, new Date(Date.now() + 9000), new Date(Date.now() + 9000));
  check('jobs file: broken → fleet.json\'s own job shows', agentStatus(c.agents[0], recs, NOW + 200_000, 5, jf).job.title === 'Fishing');
  check('retired: "retired" in fleet.json takes the agent off the page, with its note', activeAgents(c).map((x) => x.key).join() === 'a,c' && retiredOf(c.agents[1]).note === 'moved on');
  fs.mkdirSync(path.join(d, 'c')); fs.writeFileSync(path.join(d, 'c', 'RETIRED'), 'done with this one\n');
  const f = buildFleet(c, () => recs, 't', 0, NOW);
  check('retired: a retiredFile takes effect with no restart; not a card, not counted, listed with its note and date', f.agents.map((x) => x.key).join() === 'a' && f.totals.agents === 1 && f.retired.map((x) => x.key).join() === 'b,c' && f.retired[1].note === 'done with this one' && Number.isFinite(f.retired[1].since));
  const dd = tmp('fd-ret-'), mark = (k) => path.join(dd, `read-${k}`);
  const reader = (k, extra) => ({ key: k, adapter: 'command', command: { run: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(mark(k))}, 'x'); console.log('{}')`], cwd: dd }, ...extra });
  const { config: rc, errors: re } = cfg([reader('on'), reader('off', { retired: true })], { dataDir: dd });
  const r = await round(rc, { now: NOW, gapMs: 0 });
  check('retired: the sampler never reads a retired agent', !re.length && fs.existsSync(mark('on')) && !fs.existsSync(mark('off')) && Object.keys(r.a).join() === 'on', re.join('; '));
  fs.rmSync(path.join(d, 'c', 'RETIRED'));
  check('retired: removing the retiredFile brings the agent back', activeAgents(c).map((x) => x.key).join() === 'a,c');
}

// ── the demo, the server and the pages ──
{
  const d = tmp('fd-demo-');
  const port = await new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const { config, file } = await buildDemo(d, { port });
  const f = buildFleet(config, makeReader(config.dataDir), 'test', 2);
  check('demo: 8 made-up agents, 5 green, 2 yellow, 1 red', f.agents.length === 8 && f.totals.green === 5 && f.totals.yellow === 2 && f.totals.red === 1, JSON.stringify(f.totals));
  const by = Object.fromEntries(f.agents.map((x) => [x.key, x.strip.bins]));
  check('demo: full 6-hour graphs, Quill\'s gap drawn as estimated, Basil stops, Sable starts late', f.agents.filter((x) => x.strip.bins.filter((b) => b.cov).length >= 22).length === 6 && by.quill.some((b) => b.est) && !by.basil.slice(-4).some((b) => b.cov) && by.sable.filter((b) => b.cov).length <= 10);
  check('demo: every card has a job and a last thing done; Tansy is retired (no card, not read, named in the strip)', f.agents.every((x) => x.job?.title && x.lastDid?.text) && f.retired.length === 1 && f.retired[0].name === 'Tansy' && !makeReader(config.dataDir)(Date.now() - 3_600_000).some((r) => 'tansy' in r.a), JSON.stringify(f.retired));
  check('demo: 2 open asks', listAsks(config.asksDir, config.agents.map((x) => x.key)).asks.filter((x) => x.open).length === 2);

  const server = createServer({ config, records: makeReader(config.dataDir), version: 'test' });
  await new Promise((res) => server.listen(port, '127.0.0.1', res));
  const req = (method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ code: res.statusCode, headers: res.headers, text: t, json: () => JSON.parse(t) }));
    });
    r.on('error', reject); if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body)); r.end();
  });
  for (const p of ['/', '/m', '/agent', '/deck.css', '/common.js', '/cards.js', '/map.js', '/graph.js', '/asks.js', '/glance.js', '/agent.js', '/icon.svg', '/manifest.webmanifest']) {
    const r = await req('GET', p); check(`GET ${p} → 200 with a strict CSP`, r.code === 200 && /script-src 'self'/.test(r.headers['content-security-policy'] ?? '') && r.headers['x-content-type-options'] === 'nosniff', String(r.code));
  }
  for (const p of ['/../server.mjs', '/%2e%2e/deck.mjs', '/lib/server.mjs', '/fleet.json', '/selftest.mjs']) check(`GET ${p} → 404 (only the page files are served)`, (await req('GET', p)).code === 404);
  check('a page with no inline script (the CSP would block it)', !/<script>(?!<\/script>)/.test(fs.readFileSync(path.join(HERE, 'public', 'index.html'), 'utf8')) && !/ on[a-z]+="/.test(['index', 'm', 'agent'].map((x) => fs.readFileSync(path.join(HERE, 'public', `${x}.html`), 'utf8')).join('')));
  check('an unknown Host is refused (421), which stops DNS rebinding', (await req('GET', '/api/fleet', { headers: { host: 'evil.example' } })).code === 421);
  const api = await req('GET', '/api/fleet'); const j = api.json();
  check('/api/fleet: agents, totals, colours and the map', j.agents.length === 8 && j.totals.asksOpen === 2 && j.skills.order.length >= 5 && j.maps.fake.tiles.length === 12);
  check('/api/fleet: no file paths in what the page gets', !api.text.includes(d) && !api.text.includes(os.homedir()) && !api.text.includes(os.tmpdir()));
  const det = (await req('GET', '/api/agent/wren')).json();
  check('/api/agent/<key>: skills and the last 30 log lines', det.skillsNow.length === 2 && det.log.length === 30 && det.name === 'Wren');
  check('/api/agent/<unknown> → 404', (await req('GET', '/api/agent/nobody')).code === 404);
  check('a retired agent: /api/agent and /api/output say 404 "retired"; /api/health counts only active agents', (await req('GET', '/api/agent/tansy')).json().error === 'retired' && (await req('GET', '/api/output?key=tansy')).code === 404 && (await req('GET', '/api/health')).json().agents === 8);
  check('/api/output: 48 bars for the fleet or one agent', (await req('GET', '/api/output?key=fleet')).json().bins.length === 48 && (await req('GET', '/api/output?key=moss')).json().name === 'Moss' && (await req('GET', '/api/output?key=zzz')).code === 404);
  const body = { id: 'A101', verdict: 'ok' };
  check('POST /api/ask without X-Deck → 403', (await req('POST', '/api/ask', { body })).code === 403);
  check('POST /api/ask from another site → 403', (await req('POST', '/api/ask', { body, headers: { 'x-deck': '1', origin: 'https://evil.example' } })).code === 403);
  check('POST /api/ask bad JSON → 400', (await req('POST', '/api/ask', { body: '{nope', headers: { 'x-deck': '1' } })).code === 400);
  check('POST /api/ask over 8 KB → refused', await req('POST', '/api/ask', { body: 'x'.repeat(20_000), headers: { 'x-deck': '1' } }).then((r) => r.code === 400, () => true));
  check('POST /api/ask from the page → 200', (await req('POST', '/api/ask', { body, headers: { 'x-deck': '1', origin: `http://127.0.0.1:${port}` } })).code === 200);
  check('POST /api/ask again → 409', (await req('POST', '/api/ask', { body, headers: { 'x-deck': '1' } })).code === 409);
  check('PUT and DELETE do nothing', (await req('PUT', '/api/ask', { body, headers: { 'x-deck': '1' } })).code === 404 && (await req('DELETE', '/api/fleet')).code === 404);
  server.close();

  // the same server behind a private proxy host with a login header
  const proxied = { ...config, access: { hosts: ['deck.example.net'], loginHeader: 'x-login', allowLogins: ['me@example.com'] } };
  const s2 = createServer({ config: proxied, records: makeReader(config.dataDir), version: 'test' });
  await new Promise((res) => s2.listen(port, '127.0.0.1', res));
  check('proxy host: no login header → 403', (await req('GET', '/api/health', { headers: { host: 'deck.example.net' } })).code === 403);
  check('proxy host: a login not on the list → 403', (await req('GET', '/api/health', { headers: { host: 'deck.example.net', 'x-login': 'other@example.com' } })).code === 403);
  check('proxy host: an allowed login → 200', (await req('GET', '/api/health', { headers: { host: 'deck.example.net', 'x-login': 'ME@example.com' } })).code === 200);
  s2.close();

  // the command line
  const run = (args) => new Promise((resolve) => execFile(process.execPath, [path.join(HERE, 'deck.mjs'), ...args], { timeout: 60_000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));
  const ck = await run(['--config', file, '--check']);
  check('deck.mjs --check: reads each agent once and reports', ck.code === 1 && /config ok: 9 agent/.test(ck.out) && /✓ wren .*job "Fishing at the Docks", 2 lastDid rule/.test(ck.out) && /✗ basil/.test(ck.out) && /– tansy \(fake\): retired \(moved to the mainland crew \(made up\)\), not read/.test(ck.out), ck.out.slice(0, 300));
  const before = makeReader(config.dataDir)(Date.now() - 3_600_000).length;
  const once = await run(['--config', file, '--once']);
  check('deck.mjs --once: appends one round and exits', once.code === 0 && makeReader(config.dataDir)(Date.now() - 3_600_000).length === before + 1, once.out);
  {   // --check names the jobs file, prefers its job, and flags a number whose skill or counter isn't in the reading
    const jf = path.join(d, 'jobs.json'); fs.writeFileSync(jf, JSON.stringify({ agents: { wren: { title: 'Mending nets' }, ghost: { title: 'Nobody' } } }));
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')); raw.jobsFile = './jobs.json';
    raw.agents.find((x) => x.key === 'moss').job = { title: 'Woodcutting', number: { label: 'Wood', xp: 'woodcuting' } };
    raw.agents.find((x) => x.key === 'juniper').job = { title: 'Mining', number: { label: 'Gold', counter: 'gold' } };
    const cf = path.join(d, 'check-jobs.json'); fs.writeFileSync(cf, JSON.stringify(raw));
    const cj = await run(['--config', cf, '--check']);
    check('deck.mjs --check: the jobs file gets a line, its job wins, a typo in a number\'s skill or counter is flagged', /jobs file jobs\.json: 2 job\(s\)/.test(cj.out) && /"ghost" in the jobs file is not an agent/.test(cj.out) && /✓ wren .*job "Mending nets" \(from the jobs file\)/.test(cj.out) && /! job number: no skill "woodcuting"/.test(cj.out) && /! job number: no counter "gold"/.test(cj.out), cj.out.slice(0, 600));
  }
  const badc = path.join(d, 'bad.json'); fs.writeFileSync(badc, JSON.stringify({ agents: [{ key: 'A B', adapter: 'fake' }] }));
  const bc = await run(['--config', badc]);
  check('deck.mjs with a broken config: exit 2, the file named, and the problems listed', bc.code === 2 && /\.key must be/.test(bc.out) && /^bad\.json has 1 problem/m.test(bc.out));
}

// ── always-on files ──
{
  const o = { label: 'local.fleet-dashboard', name: 'fleet-dashboard', node: '/opt/node/bin/node', deck: '/srv/a&b/deck.mjs', config: '/srv/a&b/fleet 1.json', workdir: '/srv/a&b', out: '/srv/a&b/data/service.out', pathEnv: '/opt/node/bin:/usr/bin:/bin' };
  const pl = launchdPlist(o);
  check('launchd: paths are XML-escaped', pl.includes('/srv/a&amp;b/fleet 1.json') && !pl.includes('a&b'));
  check('launchd: starts at login, restarts if it stops, not too often', /RunAtLoad<\/key><true\/>/.test(pl) && /KeepAlive<\/key><true\/>/.test(pl) && /ThrottleInterval<\/key><integer>30/.test(pl));
  if (os.platform() === 'darwin') {
    const f = path.join(tmp('fd-plist-'), 'x.plist'); fs.writeFileSync(f, pl);
    let lint = true; try { execFileSync('plutil', ['-lint', f], { stdio: 'ignore' }); } catch { lint = false; }
    check('launchd: plutil -lint passes', lint);
  }
  const u = systemdUnit({ ...o, config: '/srv/x/fleet 100%.json' });
  check('systemd: arguments quoted and % escaped', u.includes('--config "/srv/x/fleet 100%%.json"') && /Restart=always/.test(u) && /NoNewPrivileges=yes/.test(u));
  const uw = systemdUnit({ ...o, workdir: '/srv/my fleet 100%' });
  check('systemd: WorkingDirectory is not quoted (systemd rejects a quoted path); spaces and % escaped', uw.includes('WorkingDirectory=/srv/my\\x20fleet\\x20100%%\n'), uw.split('\n').find((l) => l.startsWith('WorkingDirectory')));
  let sdOk = null; try { execFileSync('systemd-analyze', ['--version'], { stdio: 'ignore' }); sdOk = true; } catch { /* not on this machine */ }
  if (sdOk) {
    const dd = tmp('fd-unit-'), wd = path.join(dd, 'my fleet'); fs.mkdirSync(wd); for (const f of ['deck.mjs', 'fleet.json']) fs.writeFileSync(path.join(wd, f), '');
    const uf = path.join(dd, 'fleet-dashboard.service'); fs.writeFileSync(uf, systemdUnit({ ...o, node: process.execPath, deck: path.join(wd, 'deck.mjs'), config: path.join(wd, 'fleet.json'), workdir: wd }));
    let verr = ''; try { execFileSync('systemd-analyze', ['verify', uf], { stdio: 'pipe' }); } catch (e) { verr = String(e.stderr || e.message); }
    check('systemd: systemd-analyze verify accepts the unit (a folder name with a space)', !/fleet-dashboard\.service/.test(verr), verr.split('\n')[0]);
  }
  const inst = await new Promise((resolve) => execFile(process.execPath, [path.join(HERE, 'install.mjs'), '--systemd', '--config', path.join(HERE, 'fleet.example.json')], (err, stdout) => resolve({ code: err ? err.code : 0, out: stdout })));
  const fh = tmp('fd-home-'), noSd = await new Promise((resolve) => execFile(process.execPath, [path.join(HERE, 'install.mjs'), '--systemd', '--config', path.join(HERE, 'fleet.example.json'), '--start'], { env: { ...process.env, HOME: fh, PATH: path.dirname(process.execPath) } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, err: stderr })));
  check('install.mjs --systemd --start with no systemd: exit 1, says what to do, writes nothing', noSd.code === 1 && /No service manager/.test(noSd.err) && fs.readdirSync(fh).length === 0, `${noSd.code} ${noSd.err}`);
  check('install.mjs without --write only prints (writes nothing)', inst.code === 0 && /# would write/.test(inst.out) && /ExecStart=/.test(inst.out));
}

for (const d of TEMPS) fs.rmSync(d, { recursive: true, force: true });
console.log(`\nselftest: ${ok} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
