#!/usr/bin/env node
// selftest.mjs: checks all four controls with no network and no real agent (temporary folders, a fake driver,
// short timers). It forces each refusal the skill promises: a cap hit, an expired pause, an unanswered ask and
// gate-blocked text. It also checks the shared formats against fleet-dashboard's asks code and city-driver-starter's
// own driver and pause.mjs. Fake keys and home folders are built at run time, so this file holds none.
//   node selftest.mjs        expect "selftest: N ok, 0 failed"
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPause, isPaused, watchPause, hold } from './lib/pause.mjs';
import { openAsk, resolveAsk, closeAsk, approvalFrom, outcomeLine, listAsks, answerAsk, MAX_OPEN } from './lib/asks.mjs';
import { fileHandback, ingestHandbacks, recentSelf, promptBlock } from './lib/handback.mjs';
import { createLimits, policyProblems } from './lib/limits.mjs';
import { makeGate } from './lib/gate.mjs';
import { readLines, writeJson, appendLine, previousPart } from './lib/files.mjs';
import { readPause as starterReadPause } from '../../city-driver-starter/scripts/driver.mjs';
import { agentStatus } from '../../fleet-dashboard/scripts/lib/fleet.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTROLS = path.join(HERE, 'controls.mjs');
const STARTER_PAUSE = path.join(HERE, '..', '..', 'city-driver-starter', 'scripts', 'pause.mjs');
const TEMPS = [];
const tmp = (p = 'aoc-') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TEMPS.push(d); return d; };
let ok = 0, failed = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : `  (${extra})`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);
const MIN = 60_000;
const FAKE_KEY = ['sk', 'live', 'Zq9'.repeat(8)].join('_');
const FAKE_HOME = ['', 'Users', 'someone', 'notes'].join('/');
const run = (args, opts = {}) => new Promise((res) => execFile(process.execPath, [CONTROLS, ...args], { timeout: 20_000, ...opts }, (e, out, err) => res({ code: e ? e.code : 0, out: String(out), err: String(err) })));
const runFile = (file, args) => new Promise((res) => execFile(process.execPath, [file, ...args], { timeout: 20_000 }, (e, out, err) => res({ code: e ? e.code : 0, out: String(out), err: String(err) })));
const policy = (dir, p) => writeJson(path.join(dir, 'policy.json'), { mode: 'on', allow: ['work', 'buy'], ...p });

try {
  // ── pause-with-expiry ──
  {
    const d = tmp();
    check('no PAUSE: readPause is null, not paused', readPause(d) === null && !isPaused(d));
    writeJson(path.join(d, 'PAUSE'), { by: 'me', at: '2026-11-14T18:00:00Z', until: new Date(Date.now() + MIN).toISOString() });
    const p = readPause(d);
    check('PAUSE with until: paused, not expired', isPaused(d) && !p.expired && p.by === 'me');
    check('at is kept exactly as written (RELEASED.for must equal it)', p.at === '2026-11-14T18:00:00Z');
    writeJson(path.join(d, 'PAUSE'), { by: 'me', until: new Date(Date.now() - 1000).toISOString() });
    check('FORCED REFUSAL (expired pause): past until no longer counts as paused', readPause(d).expired && !isPaused(d));
    fs.writeFileSync(path.join(d, 'PAUSE'), '');
    const t = readPause(d);
    check('`touch PAUSE`: paused, no end time, at = file time', isPaused(d) && t.until === null && t.at === fs.statSync(path.join(d, 'PAUSE')).mtime.toISOString());
    check('a PAUSE with no until is flagged stale after PAUSE_STALE_MIN', readPause(d, { now: Date.now() + 61 * MIN }).stale && !readPause(d).stale);
    fs.writeFileSync(path.join(d, 'PAUSE'), 'not json');
    check('a PAUSE that is not JSON still pauses', isPaused(d) && /not JSON/.test(readPause(d).by));
    writeJson(path.join(d, 'PAUSE'), { by: 'x', until: 'tomorrow-ish' });
    check('an until that is not a date is flagged and treated as no end time', readPause(d).badUntil && isPaused(d));
    check('city-driver-starter reads the same PAUSE the same way', JSON.stringify((({ by, until, expired }) => ({ by, until, expired }))(starterReadPause(d))) === JSON.stringify({ by: 'x', until: 'tomorrow-ish', expired: false }));
  }
  {
    // fleet-dashboard's page must agree with isPaused(): an expired PAUSE is left in place and must not show yellow.
    const d = tmp(), f = path.join(d, 'PAUSE');
    const card = () => agentStatus({ key: 'scout', name: 'scout', adapter: 'fake', pauseFile: f, staleMinutes: 30 }, [{ t: Date.now(), a: { scout: { xp: {} } } }], Date.now(), 5);
    const shapes = [
      ['live until', () => writeJson(f, { by: 'me', at: new Date().toISOString(), until: new Date(Date.now() + MIN).toISOString() })],
      ['expired until', () => writeJson(f, { by: 'me', at: new Date(Date.now() - 2 * MIN).toISOString(), until: new Date(Date.now() - 1000).toISOString() })],
      ['touch PAUSE', () => fs.writeFileSync(f, '')],
      ['not JSON', () => fs.writeFileSync(f, 'not json')],
      ['until not a date', () => writeJson(f, { by: 'x', until: 'tomorrow-ish' })],
      ['no PAUSE', () => fs.rmSync(f, { force: true })],
    ];
    const off = shapes.filter(([, make]) => { make(); return card().paused !== isPaused(d); }).map(([n]) => n);
    check('fleet-dashboard\'s page agrees with isPaused() on all 6 PAUSE shapes', off.length === 0, off.join(', '));
    shapes[1][1]();
    const c = card();
    check('FORCED REFUSAL (expired pause) on the page: not "paused", not yellow', !c.paused && c.light === 'green' && !c.why.includes('paused') && c.doing?.label !== 'paused', `${c.light} ${c.why}`);
  }
  {
    const d = tmp();
    const seen = { pause: 0, renew: 0, resume: [], stale: 0 };
    const w = watchPause(d, {
      intervalMs: 40, staleMinutes: 0.002,
      onPause: async () => { seen.pause++; await sleep(150); return { stoppedWork: true, released: true }; },
      onRenew: async () => { seen.renew++; }, onResume: async (r) => { seen.resume.push(r); }, onStale: async () => { seen.stale++; },
    });
    writeJson(path.join(d, 'PAUSE'), { by: 'race', at: 'A1', until: new Date(Date.now() + MIN).toISOString() });
    await sleep(400);
    const r1 = JSON.parse(fs.readFileSync(path.join(d, 'RELEASED'), 'utf8'));
    check('driver: one onPause even when it outlasts the timer (no re-entry)', seen.pause === 1);
    check('driver: RELEASED.for is the PAUSE at; paused is true', r1.for === 'A1' && r1.stoppedWork === true && w.paused);
    writeJson(path.join(d, 'PAUSE'), { by: 'race', at: 'A2', until: new Date(Date.now() + MIN).toISOString() });
    await sleep(200);
    const r2 = JSON.parse(fs.readFileSync(path.join(d, 'RELEASED'), 'utf8'));
    check('driver: a renewed PAUSE gets a fresh RELEASED, no second hand-off', r2.for === 'A2' && seen.pause === 1 && seen.renew === 1);
    fs.rmSync(path.join(d, 'PAUSE'));
    await sleep(200);
    check('driver: PAUSE removed -> resume, RELEASED deleted', seen.resume.length === 1 && !seen.resume[0].expired && !fs.existsSync(path.join(d, 'RELEASED')) && !w.paused);
    writeJson(path.join(d, 'PAUSE'), { by: 'owner', at: 'A3', until: new Date(Date.now() + 300).toISOString() });
    await sleep(700);
    check('driver: an expired PAUSE resumes on its own (expired=true)', seen.resume.length === 2 && seen.resume[1].expired === true && !w.paused);
    check('driver: never deletes PAUSE (not its file)', fs.existsSync(path.join(d, 'PAUSE')));
    fs.rmSync(path.join(d, 'PAUSE'));
    fs.writeFileSync(path.join(d, 'PAUSE'), '');
    fs.utimesSync(path.join(d, 'PAUSE'), new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    await sleep(300);
    check('driver: a stale no-end-time PAUSE is flagged once', seen.stale === 1);
    w.stop();
  }
  {
    const d = tmp();
    const w = watchPause(d, { intervalMs: 40, onPause: async () => ({ stoppedWork: false, released: true }) });
    const h = await hold(d, { minutes: 1, by: 'tester', pollMs: 30, waitSeconds: 5, cleanupOnSignal: false });
    check('hold: waits for a RELEASED for its own pause', h.ok && h.release.for === h.at && w.paused);
    check('hold: PAUSE always has an end time', Boolean(readPause(d).until));
    check('hold: stillMine() while the pause lasts', h.stillMine());
    writeJson(path.join(d, 'PAUSE'), { by: 'someone-else', at: 'other', until: new Date(Date.now() + MIN).toISOString() });
    check('hold: stillMine() is false once someone replaced the PAUSE', !h.stillMine());
    check('letGo never removes someone else\'s newer PAUSE', h.done() === false && readPause(d).by === 'someone-else');
    fs.rmSync(path.join(d, 'PAUSE')); await sleep(150);
    const short = await hold(d, { minutes: 0.008, by: 'short', pollMs: 30, waitSeconds: 5, cleanupOnSignal: false });
    await sleep(700);
    check('FORCED REFUSAL (expired pause): a holder\'s stillMine() is false after until, the driver has taken back', short.ok && !short.stillMine() && !w.paused);
    short.done();
    w.stop();
    let threw = false; try { await hold(d, { minutes: 0, cleanupOnSignal: false }); } catch { threw = true; }
    check('hold refuses a pause with no end time', threw);
    const lonely = tmp();
    const none = await hold(lonely, { minutes: 1, pollMs: 30, waitSeconds: 0.3, cleanupOnSignal: false });
    check('hold: no driver -> fails cleanly and removes its PAUSE', !none.ok && /no RELEASED/.test(none.reason) && !fs.existsSync(path.join(lonely, 'PAUSE')));
    const stuck = tmp();
    const w2 = watchPause(stuck, { intervalMs: 40, onPause: async () => ({ stoppedWork: true, released: false }) });
    const s = await hold(stuck, { minutes: 1, pollMs: 30, waitSeconds: 3, cleanupOnSignal: false });
    check('hold: a driver that could not hand back -> not ok, PAUSE removed', !s.ok && /could not hand back/.test(s.reason) && !fs.existsSync(path.join(stuck, 'PAUSE')));
    w2.stop();
  }
  {
    // a holder killed mid-hold removes its PAUSE on the way out
    const d = tmp();
    const w = watchPause(d, { intervalMs: 40, onPause: async () => ({ released: true }) });
    const script = path.join(tmp(), 'holder.mjs');
    fs.writeFileSync(script, `import { hold } from ${JSON.stringify(path.join(HERE, 'lib', 'pause.mjs'))};\nconst h = await hold(process.argv[2], { minutes: 5, by: 'killed', pollMs: 30, waitSeconds: 5 });\nconsole.log(h.ok ? 'held' : 'no');\nsetInterval(() => {}, 1000);\n`);
    const child = spawn(process.execPath, [script, d], { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((res) => child.stdout.on('data', (b) => String(b).includes('held') && res()));
    child.kill('SIGTERM');
    const code = await new Promise((res) => child.on('exit', (c) => res(c)));
    check('hold: SIGTERM removes the holder\'s PAUSE (no stranded agent)', code === 130 && !fs.existsSync(path.join(d, 'PAUSE')));
    w.stop();
  }
  {
    // city-driver-starter's own pause.mjs against this driver side
    const d = tmp();
    const w = watchPause(d, { intervalMs: 40, onPause: async () => ({ stoppedWork: true, released: true }) });
    const r = await runFile(STARTER_PAUSE, [d, '5', '--by', 'starter']);
    check('city-driver-starter pause.mjs gets its RELEASED from this driver side', r.code === 0 && /RELEASED/.test(r.out), r.err);
    const off = await runFile(STARTER_PAUSE, [d, 'off']);
    await sleep(150);
    check('...and "off" hands the agent back', off.code === 0 && !w.paused);
    w.stop();
  }

  // ── ask-the-owner (fleet-dashboard's asks format) ──
  const gate = makeGate({ maxChars: 200, banned: ['guaranteed'], check: (t) => (/\bforge\b/i.test(t) ? 'names a place that is not in the agent\'s state' : null) });
  {
    const a = tmp();
    const r = openAsk(a, { id: 'A1', agent: 'scout', question: 'Moss says hi. Reply?', draft: 'Hi Moss!', kind: 'friend', onTimeout: 'send', minutes: 30, context: ['moss: hi', 'moss: you there?'] });
    check('openAsk writes the ask with an owner-only file', r.ok && mode(path.join(a, 'A1.json')) === '600');
    const seen = listAsks(a, ['scout']).asks;
    check('fleet-dashboard\'s reader shows it open, with question and draft', seen.length === 1 && seen[0].open && seen[0].agent === 'scout' && seen[0].draft === 'Hi Moss!');
    check('a bad id is refused', !openAsk(a, { id: '../x', question: 'q', minutes: 1 }).ok);
    check('an ask with no deadline is refused', /deadline/.test(openAsk(a, { id: 'A9', question: 'q' }).reason));
    check('onTimeout send without a draft is refused', /needs a draft/.test(openAsk(a, { id: 'A9', question: 'q', onTimeout: 'send', minutes: 1 }).reason));
    check('an action ask can never act on silence', /never acts on silence/.test(openAsk(a, { id: 'A9', question: 'q', onTimeout: 'send', draft: 'x', minutes: 1, action: { name: 'pay' } }).reason));
    check('a used id is refused', /already used/.test(openAsk(a, { id: 'A1', question: 'q', minutes: 1 }).reason));
    for (let i = 2; i <= MAX_OPEN; i++) openAsk(a, { id: `A${i}`, agent: 'scout', question: 'q', minutes: 1 });
    check(`the queue is bounded (${MAX_OPEN} open asks per agent)`, /queue full/.test(openAsk(a, { id: 'A99', agent: 'scout', question: 'q', minutes: 1 }).reason));
    check('another agent has its own queue', openAsk(a, { id: 'B1', agent: 'moss', question: 'q', minutes: 1 }).ok);
    let threw = false; try { resolveAsk(a, r.ask, {}); } catch { threw = true; }
    check('resolveAsk refuses to run without a gate', threw);
    check('no answer, before the deadline: waiting', resolveAsk(a, r.ask, { gate }).status === 'waiting');
  }
  {
    const a = tmp();
    const mk = (id, extra) => openAsk(a, { id, agent: 'scout', question: 'q?', draft: 'Hi there!', minutes: 10, maxOpen: 50, ...extra }).ask;
    const okAsk = mk('K1'); answerAsk(a, { id: 'K1', verdict: 'ok' });
    check('owner says ok -> the draft is said', (({ status, say }) => status === 'answered' && say === 'Hi there!')(resolveAsk(a, okAsk, { gate })));
    const own = mk('K2'); answerAsk(a, { id: 'K2', verdict: 'own', text: 'Busy today, talk tomorrow.' });
    check('owner\'s own words -> said, after the gate', resolveAsk(a, own, { gate }).say === 'Busy today, talk tomorrow.');
    const leak = mk('K3'); answerAsk(a, { id: 'K3', verdict: 'own', text: `use ${FAKE_KEY} for it` });
    const rl = resolveAsk(a, leak, { gate });
    check('FORCED REFUSAL (gate-blocked text): the owner\'s own words with a key are not said', rl.say === null && rl.blocked && /key/.test(rl.reason));
    check('...and the log line says blocked, not sent', /blocked by gate/.test(outcomeLine(leak, rl)) && !outcomeLine(leak, rl).includes(FAKE_KEY));
    const skip = mk('K4'); answerAsk(a, { id: 'K4', verdict: 'skip' });
    check('skip -> nothing said', (({ status, say }) => status === 'answered' && say === null)(resolveAsk(a, skip, { gate })));
    check('fleet-dashboard refuses a second answer (409)', answerAsk(a, { id: 'K4', verdict: 'ok' })[0] === 409);
    const quiet = mk('K5', { onTimeout: 'nothing', minutes: 0.001 });
    await sleep(120);
    const rq = resolveAsk(a, quiet, { gate });
    check('FORCED REFUSAL (unanswered ask): silence past the deadline does nothing by default', rq.status === 'timeout' && rq.say === null && /nothing/.test(outcomeLine(quiet, rq)));
    const friendly = mk('K6', { onTimeout: 'send', minutes: 0.001 }); await sleep(120);
    check('silence on a friendly ask with onTimeout "send" -> the draft is said', resolveAsk(a, friendly, { gate }).say === 'Hi there!');
    const badDraft = openAsk(a, { id: 'K7', agent: 'scout', question: 'q', draft: 'Meet me at the forge!', onTimeout: 'send', minutes: 0.001, maxOpen: 50 }).ask; await sleep(120);
    const rb = resolveAsk(a, badDraft, { gate });
    check('a timed-out draft that fails the gate (invented place) is blocked, not sent', rb.say === null && rb.blocked && /place/.test(rb.reason));
    const late = mk('K8', { minutes: 0.001 }); await sleep(120);
    answerAsk(a, { id: 'K8', verdict: 'ok' });
    check('an answer after the deadline is "late": logged, never acted on', resolveAsk(a, late, { gate }).status === 'late');
    const rec = closeAsk(a, okAsk, 'OWNER SAYS #K1: ok');
    check('closeAsk keeps one record in done/ and removes the ask and answer', rec.answer?.verdict === 'ok' && fs.existsSync(path.join(a, 'done', 'K1.json')) && !fs.existsSync(path.join(a, 'K1.json')) && !fs.existsSync(path.join(a, 'answers', 'K1.json')));
    check('fleet-dashboard can\'t answer a closed ask (404)', answerAsk(a, { id: 'K1', verdict: 'ok' })[0] === 404);
    check('a closed id can\'t be reused', /already used/.test(openAsk(a, { id: 'K1', question: 'q', minutes: 1 }).reason));
    const act = openAsk(a, { id: 'P1', agent: 'scout', question: 'Send exactly 10 coins to pip?', minutes: 10, maxOpen: 50, action: { name: 'send_coins', amount: 10, to: 'pip' } }).ask;
    answerAsk(a, { id: 'P1', verdict: 'ok' });
    const ra = resolveAsk(a, act, { gate });
    const ap = approvalFrom(act, ra);
    check('an in-time ok to an action ask approves exactly that action', ap && ap.name === 'send_coins' && ap.ctx.amount === 10 && ap.ctx.to === 'pip' && ap.ctx.approved === 'P1');
    const act2 = openAsk(a, { id: 'P2', agent: 'scout', question: 'Send 10?', minutes: 10, maxOpen: 50, action: { name: 'send_coins', amount: 10 } }).ask;
    answerAsk(a, { id: 'P2', verdict: 'own', text: 'yes, send 500' });
    check('own words never approve an action (speech only)', approvalFrom(act2, resolveAsk(a, act2, { gate })) === null);
  }

  // ── the gate ──
  {
    const cases = [['Hello there', true], ['', false], ['x'.repeat(201), false], ['/give pip 500', false], ['!ban moss', false],
      ['This is guaranteed to win', false], ['ungaranteed spelling is fine', true], [`my notes are in ${FAKE_HOME}`, false], ['bell\x07', false],
      ['See you at the forge', false], ['See you at the pier', true]];
    const bad = cases.filter(([t, want]) => gate(t).ok !== want).map(([t]) => t.slice(0, 20));
    check('gate: length, commands, banned words, keys, home folders, control characters, your own check', bad.length === 0, bad.join(' | '));
  }

  // ── handback-memory ──
  {
    const d = tmp(), ev = path.join(d, 'mem', 'events.jsonl');
    const row = fileHandback(ev, 'plaza-race', `You ran the plaza race\nin 3:05 and won. ${'x'.repeat(400)}`, { pin: true });
    check('fileHandback: one line, at most 300 characters, pinned', !row.text.includes('\n') && row.text.length <= 300 && row.pin);
    check('fileHandback: events file is owner-only', mode(ev) === '600');
    fileHandback(ev, 'leaky', `Paid with ${FAKE_KEY} from ${FAKE_HOME}`);
    check('fileHandback masks keys and home folders (it may be said to strangers)', !fs.readFileSync(ev, 'utf8').includes(FAKE_KEY) && !fs.readFileSync(ev, 'utf8').includes('someone'));
    const since = Date.now() - 1000;
    const got = ingestHandbacks(ev, { since, by: 'plaza-race' });
    check('ingest after a hold returns what was filed, no placeholder', got.events.length === 2 && !got.placeholder);
    const empty = path.join(d, 'e2.jsonl');
    const ph = ingestHandbacks(empty, { since: Date.UTC(2026, 10, 17, 21, 0), now: Date.UTC(2026, 10, 17, 21, 12), by: 'test-script' });
    check('a hold that filed nothing gets an honest placeholder', ph.placeholder && ph.events[0].text === 'You were held by test-script from 21:00 to 21:12 UTC; details unknown.');
    check('the placeholder uses the owner\'s time zone when given', ingestHandbacks(path.join(d, 'e3.jsonl'), { since: Date.UTC(2026, 10, 17, 21, 0), now: Date.UTC(2026, 10, 17, 21, 12), by: 'x', timeZone: 'America/New_York' }).events[0].text.includes('16:00 to 16:12;'));
    const ev2 = path.join(d, 'e4.jsonl'), N = Date.UTC(2026, 10, 17, 12);
    const line = (hoursAgo, text, pin = false) => fs.appendFileSync(ev2, JSON.stringify({ at: new Date(N - hoursAgo * 3_600_000).toISOString(), by: 't', text, pin }) + '\n');
    line(50, 'old pinned win', true); line(30, 'old news'); line(5, 'five'); line(4, 'four'); line(3, 'three'); line(2, 'two'); line(1, 'one');
    fs.appendFileSync(ev2, '{broken line\n'); line(-1, 'from the future');
    const rs = recentSelf(ev2, { now: N });
    check('recent self: newest first, at most 5, 24 h window', rs.join('|') === '- one|- two|- three|- four|- five');
    check('recent self: a pinned note lasts 72 h; broken and future lines are skipped', recentSelf(ev2, { now: N, max: 10 }).includes('- old pinned win') && !recentSelf(ev2, { now: N, max: 10 }).some((l) => /old news|future/.test(l)));
    check('prompt block is empty when there is no news', promptBlock([]) === '' && promptBlock(['- a']).startsWith('YOUR REAL NEWS'));
  }

  // ── owner-limits ──
  {
    const d = tmp();
    const L = createLimits(d);
    const none = L.check('work');
    check('no policy.json: everything is refused (fails closed)', !none.ok && none.rule === 'policy');
    writeJson(path.join(d, 'policy.json'), { mode: 'on', allow: ['work'], spnd: { perDay: 5 } });
    check('a typo in policy.json (unknown field) refuses everything, and says why', L.check('work').rule === 'policy' && /unknown field "spnd"/.test(L.status().problems.join()));
    check('policyProblems catches a bad mode, tz and cap', policyProblems({ mode: 'yes', tz: 'Mars/Base', allow: [], spend: { perDay: -1 } }).length === 3);
    policy(d, { readOnly: ['look'], spend: { perAction: 50, perDay: 100, perWeek: 150 } });
    check('allowed action passes', L.check('buy', { amount: 40 }).ok); L.record(40);
    const cap = L.check('buy', { amount: 60 });
    check('FORCED REFUSAL (cap hit): over the per-action cap', !cap.ok && cap.rule === 'cap' && /per-action/.test(cap.reason));
    L.record(50);
    check('FORCED REFUSAL (cap hit): over the daily cap', /daily cap/.test(L.check('buy', { amount: 20 }).reason));
    check('a negative or non-number amount is refused', !L.check('buy', { amount: -5 }).ok && !L.check('buy', { amount: 'lots' }).ok);
    check('spend persists across restarts (a new instance sees it)', createLimits(d).status().spentToday === 90);
    check('not in the allow list -> refused', createLimits(d).check('fight').rule === 'allow');
    fs.writeFileSync(path.join(d, 'STOP'), '');
    check('STOP refuses everything except read-only actions', L.check('work').rule === 'stop' && L.check('look').ok);
    fs.rmSync(path.join(d, 'STOP'));
    const log = readLines(path.join(d, 'refusals.jsonl'));
    check('every refusal is logged with its rule and reason, owner-only file', log.length >= 5 && log.every((x) => x.rule && x.reason) && mode(path.join(d, 'refusals.jsonl')) === '600');
    policy(d, { spend: { perDay: 1000, perWeek: 150 } });
    check('policy is re-read on every check (no restart to change limits)', L.check('buy', { amount: 61 }).rule === 'cap' && /weekly/.test(L.check('buy', { amount: 61 }).reason));
  }
  {
    // the owner's day and week, in the owner's time zone
    const d = tmp(); let t = Date.parse('2026-11-17T03:00:00Z');       // 22:00 on the 16th in New York
    const L = createLimits(d, { now: () => t });
    policy(d, { tz: 'America/New_York', spend: { perDay: 100 } });
    L.record(90);
    t = Date.parse('2026-11-17T04:30:00Z');                              // 23:30 on the 16th in New York: same day
    check('owner time zone: still the same day at 23:30 local', L.check('buy', { amount: 20 }).rule === 'cap');
    t = Date.parse('2026-11-17T06:00:00Z');                              // 01:00 on the 17th in New York: a new day
    check('owner time zone: the daily cap resets at local midnight, not UTC midnight', L.check('buy', { amount: 20 }).ok);
    const d2 = tmp(); let t2 = Date.parse('2026-11-22T12:00:00Z');       // a Sunday
    const W = createLimits(d2, { now: () => t2 });
    policy(d2, { tz: 'UTC', spend: { perWeek: 100 } });
    W.record(95);
    check('weekly cap holds through Sunday', W.check('buy', { amount: 10 }).rule === 'cap');
    t2 = Date.parse('2026-11-23T00:30:00Z');                             // Monday
    check('weekly cap resets on Monday', W.check('buy', { amount: 10 }).ok);
  }
  {
    const d = tmp(); const L = createLimits(d);
    policy(d, { floors: { food: 2 }, neverTo: ['my-other-agent'], needsHuman: ['send_coins'], rate: { speak: { perHour: 2 } }, perMinute: 3, allow: ['work', 'buy', 'speak', 'sell'] });
    check('a floor refuses an action that would go below it', L.check('sell', { after: { food: 1 } }).rule === 'floor' && L.check('sell', { after: { food: 2 } }).ok);
    check('a blocked counterparty is refused', L.check('buy', { to: 'my-other-agent' }).rule === 'who');
    check('needsHuman is refused while approvals are off, even with an approval', L.check('send_coins', { amount: 5, approved: 'P1' }).rule === 'human');
    L.check('speak'); L.check('speak');
    check('a per-hour rate is enforced', L.check('speak').rule === 'rate');
    check('a per-minute rate covers all actions together', L.check('work').rule === 'rate');
  }
  {
    const d = tmp(); const L = createLimits(d);
    policy(d, { needsHuman: ['send_coins'], approvals: 'asks', spend: { perAction: 50 }, neverTo: ['my-other-agent'] });
    check('needsHuman without an approval is refused', L.check('send_coins', { amount: 10 }).rule === 'human');
    check('with approvals "asks", an approved action passes', L.check('send_coins', { amount: 10, approved: 'P1' }).ok);
    check('an approval never lifts the caps', L.check('send_coins', { amount: 500, approved: 'P1' }).rule === 'cap');
    check('an approval never lifts a blocked counterparty', L.check('send_coins', { amount: 5, to: 'my-other-agent', approved: 'P1' }).rule === 'who');
    fs.writeFileSync(path.join(d, 'STOP'), '');
    check('an approval never lifts STOP', L.check('send_coins', { amount: 5, approved: 'P1' }).rule === 'stop');
    fs.rmSync(path.join(d, 'STOP'));
  }
  {
    const d = tmp(); const L = createLimits(d);
    policy(d, { mode: 'shadow', spend: { perAction: 10 } });
    const s = L.check('buy', { amount: 50 });
    check('shadow: a would-refuse is allowed and logged as wouldRefuse', s.ok && s.wouldRefuse === 'cap' && readLines(path.join(d, 'refusals.jsonl')).at(-1).wouldRefuse === true);
    policy(d, { mode: 'off' });
    check('off: everything except read-only is refused', L.check('work').rule === 'stop');
    policy(d, { expires: new Date(Date.now() - 1000).toISOString() });
    check('an expired policy refuses until the owner renews it', L.check('work').rule === 'expired');
    policy(d, { onBreach: 'freeze', spend: { perAction: 10 } });
    L.check('buy', { amount: 50 });
    check('freeze: one refusal stops everything after it', L.check('work').rule === 'frozen');
    L.unfreeze();
    check('unfreeze (owner) clears it', L.check('work').ok);
    policy(d, { spend: { perAction: 1 } });
    L.check('buy', { amount: 5, to: FAKE_KEY });
    check('the refusal log never holds a raw key (counterparty and reason are masked)', !fs.readFileSync(path.join(d, 'refusals.jsonl'), 'utf8').includes(FAKE_KEY));
  }

  // ── the owner's command line ──
  {
    const d = tmp(), a = tmp(), ev = path.join(d, 'events.jsonl');
    const w = watchPause(d, { intervalMs: 40, onPause: async () => ({ stoppedWork: true, released: true }) });
    const p = await run(['pause', d, '5', '--by', 'me']);
    check('controls pause: exit 0 after RELEASED', p.code === 0 && /RELEASED/.test(p.out), p.err);
    const st = await run(['status', d]);
    check('controls status: shows the pause and that it was released, and limits refusing without a policy', /PAUSED by me/.test(st.out) && /for this pause/.test(st.out) && /REFUSING EVERYTHING/.test(st.out));
    check('controls pause off: exit 0, the driver resumes', (await run(['pause', d, 'off'])).code === 0 && (await sleep(150), !w.paused));
    w.stop();
    check('controls pause: no driver -> exit 1, PAUSE removed', (await run(['pause', d, '1'], { env: { ...process.env, PAUSE_WAIT_SECONDS: '0.5' } })).code === 1 && !fs.existsSync(path.join(d, 'PAUSE')));
    check('controls pause: minutes out of range -> exit 2', (await run(['pause', d, '0'])).code === 2);
    const doc0 = await run(['doctor', d]);
    check('controls doctor: no policy is a FAIL (exit 1)', doc0.code === 1 && /FAIL\s+policy.json/.test(doc0.out));
    policy(d, { mode: 'shadow' });
    const doc1 = await run(['doctor', d]);
    check('controls doctor: shadow mode -> the rogue test passes and doctor fails', doc1.code === 1 && /rogue test PASSED/.test(doc1.out));
    check('controls rogue: exit 2 when the gate lets it through', (await run(['rogue', d])).code === 2);
    policy(d, { mode: 'on' });
    const doc2 = await run(['doctor', d]);
    check('controls doctor: a good policy passes; writable policy.json is a warning', doc2.code === 0 && /rogue test refused/.test(doc2.out) && /can write policy.json/.test(doc2.out));
    check('controls rogue: exit 0 when refused', (await run(['rogue', d])).code === 0);
    check('controls stop / start', (await run(['stop', d])).code === 0 && createLimits(d).check('work').rule === 'stop' && (await run(['start', d])).code === 0 && createLimits(d).check('work').ok);
    openAsk(a, { id: 'Q1', agent: 'scout', question: 'Moss says hi. Reply?', draft: 'Hi Moss!', onTimeout: 'send', minutes: 30, kind: 'friend', context: ['moss: hi'] });
    const asks = await run(['asks', a]);
    check('controls asks: shows the ask, its thread, its draft and the default', /#Q1 \[friend\]/.test(asks.out) && /earlier: moss: hi/.test(asks.out) && /the draft is sent/.test(asks.out));
    const ans = await run(['answer', a, 'Q1', 'own', 'Hi!', 'Busy', 'today.']);
    check('controls answer: writes the same answer file fleet-dashboard does', ans.code === 0 && JSON.parse(fs.readFileSync(path.join(a, 'answers', 'Q1.json'), 'utf8')).text === 'Hi! Busy today.');
    check('controls answer: a second answer is refused (exit 1)', (await run(['answer', a, 'Q1', 'ok'])).code === 1);
    const hb = await run(['handback', ev, '--by', 'race', '--pin', 'You', 'won', 'the', 'race.']);
    check('controls handback: files a pinned note', hb.code === 0 && readLines(ev).at(-1).pin && readLines(ev).at(-1).text === 'You won the race.');
    check('controls: an unknown command is a usage error (exit 2)', (await run(['nope'])).code === 2);
  }
  // ── logs stay small: refusals.jsonl and events.jsonl roll to <name>.1.jsonl ──
  {
    const d = tmp(), f = path.join(d, 'events.jsonl'), max = 2048;
    for (let i = 0; i < 100; i++) appendLine(f, { at: new Date(Date.now() - (100 - i) * 1000).toISOString(), by: 't', text: `note ${i} `.padEnd(80, '.'), pin: false }, { maxBytes: max });
    const sz = (x) => fs.statSync(x).size, all = readLines(f);
    check('log rolls: past the size the older part becomes events.1.jsonl, both owner-only', fs.existsSync(previousPart(f)) && mode(previousPart(f)) === '600' && mode(f) === '600');
    check('log rolls: each part stays near the limit (one older part kept, so about 2x at most)', sz(f) <= max + 200 && sz(previousPart(f)) <= max + 200 && fs.readdirSync(d).length === 2, fs.readdirSync(d).join(','));
    check('log rolls: readers see both parts, oldest first, newest last', all.length > max / 120 && all.at(-1).text.startsWith('note 99 ') && all.every((x, i) => !i || Date.parse(x.at) > Date.parse(all[i - 1].at)));
    process.env.CONTROLS_LOG_MAX_KB = '1';
    const ev = path.join(d, 'hb', 'events.jsonl');
    fileHandback(ev, 'race', 'You won the race.', { pin: true, now: Date.now() - 30 * 3_600_000 });
    for (let i = 0; i < 12; i++) fileHandback(ev, 'tick', `You checked the queue, round ${i}.`.padEnd(120, ' '), { now: Date.now() - 40 * 3_600_000 });
    const pinned = recentSelf(ev, { max: 50 }).some((l) => l.includes('You won the race.'));
    check('handback: a pinned note that has rolled into events.1.jsonl is still in "recent self"', fs.existsSync(previousPart(ev)) && !fs.readFileSync(ev, 'utf8').includes('won the race') && pinned);
    const L = path.join(d, 'lim'); fs.mkdirSync(L); policy(L, { spend: { perAction: 1 } });
    const lim = createLimits(L); for (let i = 0; i < 30; i++) lim.check('buy', { amount: 5 });
    const st = await run(['status', L]);
    const inParts = readLines(path.join(L, 'refusals.jsonl')).length, inCurrent = fs.readFileSync(path.join(L, 'refusals.jsonl'), 'utf8').trim().split('\n').length;
    const allCaps = readLines(path.join(L, 'refusals.jsonl')).every((x) => x.rule === 'cap'), doc = await run(['doctor', L]);
    check('refusals.jsonl rolls too; status counts today across both parts; doctor shows the size', fs.existsSync(previousPart(path.join(L, 'refusals.jsonl'))) && inParts > inCurrent && new RegExp(`refusals: ${inParts} today`).test(st.out) && allCaps && /refusals.jsonl: \d+ KB in 2 parts at most \(rolls at 1 KB/.test(doc.out), st.out.split('\n').find((x) => x.startsWith('refusals')));
    delete process.env.CONTROLS_LOG_MAX_KB;
    // four writers at once, as events.jsonl allows: no torn line, no lock left behind, still bounded
    const w = path.join(d, 'w', 'events.jsonl');
    const writer = `import { appendLine } from ${JSON.stringify(new URL('./lib/files.mjs', import.meta.url).href)}; for (let i = 0; i < 300; i++) appendLine(${JSON.stringify(w)}, { at: new Date().toISOString(), by: 'w' + process.argv[1], text: 'x'.repeat(60), i }, { maxBytes: 4096 });`;
    await Promise.all([1, 2, 3, 4].map((n) => new Promise((res) => execFile(process.execPath, ['--input-type=module', '-e', writer, String(n)], { timeout: 20_000 }, res))));
    const raw = [w, previousPart(w)].map((x) => fs.readFileSync(x, 'utf8')).join('');
    const torn = raw.split('\n').filter((l) => l.trim()).filter((l) => { try { JSON.parse(l); return false; } catch { return true; } }).length;
    check('log rolls: four writers at once leave no torn line and no lock file, and stay bounded', torn === 0 && !fs.existsSync(`${w}.roll`) && fs.statSync(w).size < 4096 * 2 && fs.statSync(previousPart(w)).size < 4096 * 2, `torn=${torn}`);
  }
} finally {
  for (const d of TEMPS) fs.rmSync(d, { recursive: true, force: true });
}
console.log(`\nselftest: ${ok} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
