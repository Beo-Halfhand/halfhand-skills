#!/usr/bin/env node
// selftest.mjs: checks the kit with no network and no real agents (an invented crew, temporary folders).
// Prints one line per check and a summary.   node selftest.mjs   expect "selftest: N ok, 0 failed"
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { median, mean, pairedLift, medianLift, lowerBound, pct } from './lib/stats.mjs';
import { appendOutcome, readOutcomes, checkOutcome, scoreable } from './lib/outcomes.mjs';
import { checkRow, loadRegister, saveRegister, clockFrom, statusKind, decide, renderMd, isOpen } from './lib/register.mjs';
import { evaluate, checkBar } from './lib/bars.mjs';
import { rewardGuard, confirmReading } from './lib/guard.mjs';
import { readHistory, series, windowRate, collectRow, collectAll, GAP } from './lib/collect.mjs';
import { review, writeReview, rawFlags, loadDecisions } from './lib/review.mjs';
import { runGates, runGate, mutate, formatGates } from './lib/gates.mjs';
import { BUILTIN_GATES, FIXTURES as F } from './lib/builtin-gates.mjs';
import { armsForPair, armForWindow, splitGroups } from './lib/arms.mjs';
import { buildDemo } from './lib/demo.mjs';
import receiptGates, { receiptMatches } from './examples/receipt-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPS = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TEMPS.push(d); return d; };
let ok = 0, failed = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : `  (${extra})`}`); };
const MIN = 60_000, H = 60 * MIN, DAY = 24 * H, NOW = Date.UTC(2026, 10, 17, 20, 0);
const run = (args, opts = {}) => new Promise((res) => execFile(process.execPath, [path.join(HERE, 'xk.mjs'), ...args], { timeout: 60_000, ...opts }, (err, stdout, stderr) => res({ code: err ? err.code ?? 1 : 0, out: stdout, err: stderr })));
const throws = (f, word) => { try { f(); return false; } catch (e) { return !word || e.message.includes(word); } };

// ── stats ──
{
  check('median of an even list', median([4, 1, 3, 2]) === 2.5);
  check('median of nothing is null, not 0', median([]) === null && mean([]) === null);
  const pl = pairedLift([{ c: 10, t: 11 }, { c: 20, t: 22 }, { c: 0, t: 5 }]);
  check('paired lift skips a pair with a zero control', pl.n === 2 && Math.abs(pl.lift - 0.1) < 1e-9);
  check('lower bound needs two values', lowerBound([1]) === null && lowerBound([1, 3]) < 2);
  const a = medianLift([12, 13, 14, 15], [10, 10, 11, 9], { seed: 'x' }), b = medianLift([12, 13, 14, 15], [10, 10, 11, 9], { seed: 'x' });
  check('the bootstrap is seeded (same data, same bound)', a.lb === b.lb && a.lift > 0.2);
  check('pct prints a real minus sign and n/a', pct(-0.041) === '−4.1%' && pct(null) === 'n/a');
}

// ── outcomes ──
{
  const d = tmp('xk-out-');
  const rec = { t: NOW - H, exp: 'tide-table', agent: 'wren', arm: 'T', metric: 'xp_per_min', value: 101.5, confirmed: true, proof: 'fleet-dashboard history' };
  appendOutcome(d, rec, NOW);
  check('an outcome is refused without a proof when confirmed', throws(() => appendOutcome(d, { ...rec, proof: '' }, NOW), 'proof'));
  check('an outcome is refused when confirmed is left out', throws(() => appendOutcome(d, { ...rec, confirmed: undefined }, NOW), 'confirmed'));
  check('an outcome is refused with a missing value', throws(() => appendOutcome(d, { ...rec, value: undefined }, NOW), 'missing value'));
  check('an unmeasured window needs a why', checkOutcome({ ...rec, ok: false, value: undefined, confirmed: false }, NOW).some((e) => e.includes('why')));
  appendOutcome(d, { ...rec, t: NOW - 30 * MIN, confirmed: false, proof: undefined, claimed: 'caught 40 fish' }, NOW);
  const f = path.join(d, 'outcomes', 'outcomes-2026-11-17.jsonl');
  fs.appendFileSync(f, '{"t":17634');
  const back = readOutcomes(d, { exp: 'tide-table' });
  check('outcomes read back, a half-written line skipped', back.length === 2 && back[0].v === 1);
  check('the outcome log is private (mode 600)', (fs.statSync(f).mode & 0o777) === 0o600);
  check('a claimed outcome is not scoreable', scoreable(back[0]) && !scoreable(back[1]));
  check('readOutcomes filters by time', readOutcomes(d, { from: NOW - 45 * MIN }).length === 1);
}

// ── register ──
{
  const r = F.row();
  check('a good row has no problems', checkRow(r).length === 0, checkRow(r).join('; '));
  check('a bar written after go-live is refused', checkRow({ ...r, barWrittenAt: r.liveSince.replace('T12', 'T13') }).some((e) => e.includes('after the change went live')));
  check('a paired row with a control group is refused', checkRow({ ...F.pairedRow, control: ['dune'] }).some((e) => e.includes('no control group')));
  check('a lift bar on a single design is refused', checkRow({ ...r, design: 'single', control: undefined }).some((e) => e.includes('needs a concurrent')));
  check('a running row with no liveSince is refused', checkRow({ ...r, liveSince: null }).some((e) => e.includes('needs liveSince')));
  check('a logging row may have no liveSince', checkRow({ ...r, liveSince: null, status: 'logging' }).length === 0);
  check('the same id twice is refused', checkRow(r, [r, { ...r }]).some((e) => e.includes('twice')));
  const bug = { ...r, notes: [{ at: new Date(F.NOW - 2 * DAY).toISOString(), kind: 'bugfix', text: 'x' }] };
  const des = { ...r, notes: [{ at: new Date(F.NOW - 2 * DAY).toISOString(), kind: 'design', text: 'x' }] };
  check('a bug fix keeps the clock', clockFrom(bug) === Date.parse(r.liveSince));
  check('a design change restarts the clock', clockFrom(des) === F.NOW - 2 * DAY);
  check('status kinds', statusKind('running') === 'running' && statusKind('DECIDED 2026-01-01: KEEP (+1%, 9)') === 'decided' && statusKind('DECIDED 2026-01-01: EXTEND (+1%, 9)') === 'running' && statusKind('CLOSED 2026-01-01: x') === 'closed');
  check('a closed row is not open, an EXTEND is', !isOpen({ status: 'CLOSED 2026-01-01: x' }) && isOpen({ status: 'DECIDED 2026-01-01: EXTEND (n/a, 3)' }));
  const enough = { enough: true, backstopPassed: false, numberText: '+31%', sampleText: '120 T vs 118 C' };
  check('decide writes the number and the sample', decide(r, 'KEEP', enough, { today: '2026-01-20' }) === 'DECIDED 2026-01-20: KEEP (+31%, 120 T vs 118 C)');
  check('deciding early needs a reason', throws(() => decide(r, 'REVERT', { ...enough, enough: false }, { today: 'x' }), '--early'));
  check('deciding early with a reason says so', decide(r, 'REVERT', { ...enough, enough: false }, { today: '2026-01-20', early: 'harmful lines' }).includes('early: harmful lines'));
  check('at the backstop a decision is allowed and marked', decide(r, 'INCONCLUSIVE', { ...enough, enough: false, backstopPassed: true }, { today: '2026-01-20' }).includes('backstop reached'));
  check('EXTEND needs no full sample', decide(r, 'EXTEND', { ...enough, enough: false }, { today: '2026-01-20' }).startsWith('DECIDED 2026-01-20: EXTEND'));
  const md = renderMd([r, { ...r, id: 'old', status: 'CLOSED 2026-01-01: never used | twice' }]);
  check('register.md has open and closed tables, pipes escaped', md.includes('## Open') && md.includes('## Decided and closed') && md.includes('never used \\| twice'));
  check('checkBar names the problem', checkBar({ type: 'rate', flag: 'fallback', max: 5 }).some((e) => e.includes('bar.max')) && checkBar(undefined)[0].includes('before any data'));
}

// ── guard ──
{
  const recs = [100, 105, 98, 102, 5000, -3, NaN].map((v, i) => ({ agent: 'a', metric: 'm', value: v, i }));
  const g = rewardGuard(recs);
  check('the reward guard drops the glitch, the negative and the NaN', g.keep.length === 4 && g.dropped.length === 3);
  check('each drop says why', g.dropped.map((d) => d.why).join('|').includes("own median") && g.dropped.some((d) => d.why === 'negative'));
  check('two values are too few to judge a glitch', rewardGuard([{ agent: 'a', metric: 'm', value: 1 }, { agent: 'a', metric: 'm', value: 900 }]).dropped.length === 0);
  check('the guard is per agent', rewardGuard([...[1, 1, 1].map((v) => ({ agent: 'a', metric: 'm', value: v })), ...[50, 50, 50].map((v) => ({ agent: 'b', metric: 'm', value: v }))]).dropped.length === 0);
  const s = {};
  confirmReading(s, 'k', 5);
  const seq = [7, 5, 7, 5, 7, 7].map((v, i) => confirmReading(s, 'k', v, i));
  check('flaps are counted, not logged', s.k.flaps === 2 && seq.slice(0, 5).every((x) => x === null));
  check('a change is logged once two reads agree, with the first sighting', seq[5]?.to === 7 && seq[5].firstSeen === 4);
  const s3 = {}; confirmReading(s3, 'k', 1); const r3 = [2, 2, 2].map((v, i) => confirmReading(s3, 'k', v, i, 3));
  check('need = 3 waits for a third read', r3[1] === null && r3[2]?.to === 2);
  const so = {}; confirmReading(so, 'k', { a: 1 }); check('objects compare by value', confirmReading(so, 'k', { a: 1 }) === null && so.k.candidate === null);
}

// ── arms ──
{
  check('a pair always has one T and one C', armsForPair('x', 3).sort().join() === 'C,T');
  check('the coin flip is fixed by id, pair and seed', armsForPair('x', 7, 's').join() === armsForPair('x', 7, 's').join());
  let first = 0; for (let p = 1; p <= 2000; p++) if (armsForPair('balance', p)[0] === 'T') first++;
  check('the coin is fair (T first in 45–55% of 2000 pairs)', first > 900 && first < 1100, `${first}`);
  const w = [1, 2, 3, 4].map((n) => armForWindow('x', n));
  check('windows 1-2 are pair 1, 3-4 pair 2, each with both arms', w[0].pair === 1 && w[1].pair === 1 && w[2].pair === 2 && w[0].arm !== w[1].arm && w[2].arm !== w[3].arm);
  check('armsForPair refuses pair 0', throws(() => armsForPair('x', 0)));
  const sg = splitGroups(['a', 'b', 'c', 'd', 'e'], 'k');
  check('splitGroups splits all agents once', sg.treatment.length === 3 && sg.control.length === 2 && new Set([...sg.treatment, ...sg.control]).size === 5);
}

// ── collect (fleet-dashboard history) ──
{
  const d = tmp('xk-col-'), data = path.join(d, 'data'), exp = path.join(d, 'exp');
  fs.mkdirSync(path.join(data, 'history'), { recursive: true });
  const t0 = Date.UTC(2026, 10, 10, 0, 0), lines = [];
  for (let t = t0; t <= t0 + 10 * H; t += 5 * MIN) {
    const a = {};
    if (!(t > t0 + 3 * H && t < t0 + 3 * H + 30 * MIN)) a.ash = { xp: { fishing: 1000 + (t - t0) / MIN * 10, smithing: 500 } };    // a 30-minute gap at 3 h
    a.cedar = t === t0 + 6 * H ? { err: 'read failed' } : { xp: { fishing: t >= t0 + 8 * H ? 10 : 2000 + (t - t0) / MIN * 5 } };    // an error, then a reset at 8 h
    lines.push(JSON.stringify({ t, v: 1, a }));
  }
  fs.writeFileSync(path.join(data, 'history', 'samples-2026-11-10.jsonl'), lines.join('\n') + '\n{"t":1,"v":1');
  const hist = readHistory(data);
  check('history reads every round, skips a half line', hist.length === 121);
  const sa = series(hist, 'ash'), sc = series(hist, 'cedar');
  check('series sums skills and skips errors', sa[0][1] === 1500 && sc.length === 120);
  check('a steady window gives the rate per minute', Math.abs(windowRate(sa, t0 + H, t0 + 2 * H).value - 10) < 1e-9);
  check('a window over a sampling gap is not measured', windowRate(sa, t0 + 3 * H, t0 + 4 * H).why === 'sampling gap');
  check('a reset adds nothing (never negative)', windowRate(sc, t0 + 7.5 * H, t0 + 8.5 * H).value >= 0 && windowRate(sc, t0 + 8 * H, t0 + 9 * H).value === 0);
  check('readings must bracket the window', windowRate(sa, t0 + 10 * H, t0 + 11 * H).why === 'sampling gap');
  const row = { ...F.row({ id: 'nets', treatment: ['ash'], control: ['cedar'], liveSince: new Date(t0 + 2 * H + 30 * MIN).toISOString(), barWrittenAt: new Date(t0).toISOString(), backstop: '2026-11-30' }), source: { type: 'fleet-dashboard', dataDir: '../data', windowMinutes: 60 }, baseline: { from: new Date(t0).toISOString() } };
  fs.mkdirSync(exp);
  const r1 = collectRow(exp, row, { now: t0 + 11 * H });
  const got = readOutcomes(exp, { exp: 'nets' });
  check('collect writes a window per agent per hour', r1.written === got.length && got.length === 2 * 9, `${got.length}`);
  check('the window across go-live is left out', !got.some((r) => r.t === t0 + 2 * H));
  check('windows before go-live are the baseline', got.filter((r) => r.arm === 'baseline').length === 4);
  check('gaps are written as not measured, not as zero', got.filter((r) => r.ok === false).every((r) => r.why === 'sampling gap' && r.value === undefined) && r1.gaps >= 1);
  check('the last window waits for its closing reading', !got.some((r) => r.t === t0 + 10 * H));
  check('a second collect writes nothing new', collectRow(exp, row, { now: t0 + 11 * H }).written === 0);
  check('collectAll skips rows without a fleet-dashboard source', Object.keys(collectAll(exp, [row, { ...row, id: 'x', source: undefined }], { now: t0 + 11 * H })).join() === 'nets');
  check('collect without a dataDir says so', throws(() => collectRow(exp, { ...row, id: 'y', source: { type: 'fleet-dashboard' } }, { now: t0 + 11 * H }), 'dataDir'));

  // the real thing: fleet-dashboard's own demo history, if that skill sits next to this one
  const fd = path.resolve(HERE, '../../fleet-dashboard/scripts/lib/demo.mjs');
  if (fs.existsSync(fd)) {
    const { buildDemo: fdDemo } = await import(pathToFileURL(fd).href);
    const fdir = tmp('xk-fd-');
    const { config } = await fdDemo(fdir, { now: NOW });
    const e2 = path.join(fdir, 'exp'); fs.mkdirSync(e2);
    const fr = { ...F.row({ id: 'fd', treatment: ['wren', 'juniper'], control: ['moss', 'pike'], liveSince: new Date(NOW - 20 * H).toISOString(), barWrittenAt: new Date(NOW - 21 * H).toISOString(), backstop: '2026-11-30' }), source: { type: 'fleet-dashboard', windowMinutes: 30 } };
    const res = collectRow(e2, fr, { dataDir: config.dataDir, now: NOW });
    const ev = evaluate({ ...fr, minSample: 10 }, readOutcomes(e2, { exp: 'fd' }), NOW);
    check('reads fleet-dashboard\'s own demo history (format v1)', res.written > 100 && ev.sample >= 30 && ev.number !== null, `${res.written} written, ${ev.sampleText}`);
    const q = collectRow(e2, { ...fr, id: 'fdq', treatment: ['quill'], control: ['sable'] }, { dataDir: config.dataDir, now: NOW });
    check('and marks quill\'s sampling gap in it as not measured', q.gaps >= 1, `${q.gaps}`);
  } else console.log('skip fleet-dashboard history check (that skill is not next to this one)');
}

// ── bars ──
{
  const rr = { ...F.row(), bar: { type: 'lift', min: 0.15, stopBelow: -0.2, stopAfter: 50 } };
  const losing = F.liftRecs({ lift: -0.3, n: 60 });
  check('a lift bar stops a big loss early', evaluate(rr, losing, F.NOW).state === 'stop');
  const pr = { ...F.pairedRow, bar: { ...F.pairedRow.bar, looks: [60, 100, 150], maxSample: 70 } };
  check('the next look is reported', evaluate(pr, F.pairRecs({ n: 30, lift: 0.08, spread: 0.05 }), F.NOW).nextLook === 60);
  check('at maxSample a bar that never got there is not met', evaluate(pr, F.pairRecs({ n: 75, lift: 0.01, spread: 0.01 }), F.NOW).state === 'not-met');
  const cnt = { ...F.row({ design: 'single', control: undefined, metric: 'calls', bar: { type: 'count', min: 10 }, minSample: 7 }) };
  const calls = (k) => Array.from({ length: k }, (_, i) => ({ t: F.NOW - 7 * DAY + i * H, exp: 'faster-nets', agent: 'ash', arm: 'T', metric: 'calls', value: 1, confirmed: true, proof: 'log' }));
  const c1 = evaluate(cnt, calls(12), F.NOW);
  check('a count bar reads per week, in days of sample', c1.state === 'met' && c1.sample === 8 && Math.round(c1.number) === 11, `${c1.state} ${c1.sample} ${c1.number}`);
  check('a count bar under its minimum is not met', evaluate(cnt, calls(6), F.NOW).state === 'not-met');
  const p = evaluate(F.row(), F.liftRecs({ n: 20 }), F.NOW);
  check('the pace projection is computed while too early', p.state === 'too-early' && p.projected !== null && p.projected < 100);
  check('a row not live yet reads "not live yet"', evaluate(F.row({ liveSince: null }), [], F.NOW).numberText === 'not live yet');
  const base = F.liftRecs({ n: 30 }).map((x) => ({ ...x, arm: 'baseline' }));
  check('baseline outcomes are summarised, not scored', evaluate(F.row(), base, F.NOW).baseline?.n === 60 && evaluate(F.row(), base, F.NOW).sample === 0);
}

// ── review on the demo ──
{
  const d = tmp('xk-demo-');
  const { exp } = buildDemo(d, { now: NOW });
  const reg = loadRegister(exp);
  check('the demo register is valid', reg.errors.length === 0, reg.errors.join('; '));
  check('the demo has 5 open rows, 1 decided, 1 closed', reg.rows.filter(isOpen).length === 5 && reg.rows.length === 7);
  collectAll(exp, reg.rows, { now: NOW });
  const res = review(exp, { now: NOW });
  const v = Object.fromEntries(res.rows.map((r) => [r.row.id, r]));
  check('tide-table: READY TO DECIDE, bar met', v['tide-table'].verdict === 'READY TO DECIDE' && v['tide-table'].readout.state === 'met', v['tide-table'].text);
  check('tide-table: the glitch was dropped by the guard and said so', v['tide-table'].readout.unscored.guard === 1 && res.md.includes('dropped by the reward guard'));
  check('tide-table: moss\'s sampling gap is not measured, not zero', v['tide-table'].readout.unscored.gap === 3);
  check('tide-table: the pinned baseline is shown', /Baseline \(pinned, before go-live\): median [\d.]+ over 192/.test(res.md));
  check('short-rest: OK, volume settled in decisions.json', v['short-rest'].verdict === 'OK' && v['short-rest'].suppressed.includes('volume'));
  check('market-helper: LOOKS WRONG (evidence empty) and REPEAT at the top', v['market-helper'].verdict === 'LOOKS WRONG' && v['market-helper'].repeat.includes('evidence-empty') && res.md.indexOf('## REPEAT') < res.md.indexOf('## Rows'));
  check('pantry-canary: READY TO DECIDE, fallback under 1%', v['pantry-canary'].verdict === 'READY TO DECIDE' && v['pantry-canary'].readout.state === 'met');
  check('barter-board: LOOKS WRONG, claims not confirmed', v['barter-board'].verdict === 'LOOKS WRONG' && v['barter-board'].flags.includes('claims'));
  check('the review never decides (statuses unchanged)', loadRegister(exp).rows.filter(isOpen).length === 5);
  check('raw lines are shown, not only counts', res.md.includes('✓ fleet-dashboard history') && res.md.includes('✗ unconfirmed'));
  const file = writeReview(exp, res);
  check('the review writes <date>.md and .json', fs.existsSync(file) && fs.existsSync(file.replace(/\.md$/, '.json')));
  const tomorrow = review(exp, { now: NOW + DAY });
  check('the next day reads today\'s review as "last"', tomorrow.md.includes('the last review (2026-11-17)'));

  // a STOP, a broken decisions entry, and masking
  const raw = JSON.parse(fs.readFileSync(path.join(exp, 'register.json'), 'utf8'));
  raw.rows.find((r) => r.id === 'pantry-canary').bar.none = ['harmful'];
  fs.writeFileSync(path.join(exp, 'register.json'), JSON.stringify(raw));
  appendOutcome(exp, { t: NOW - 10 * MIN, exp: 'pantry-canary', agent: 'ember', arm: 'T', metric: 'decision', value: 1, flags: ['harmful'], confirmed: true, proof: 'shadow log' }, NOW);
  appendOutcome(exp, { t: NOW - 9 * MIN, exp: 'barter-board', agent: 'basil', arm: 'T', metric: 'trades', value: 1, confirmed: false, claimed: 'paid with token=' + 'Zq9'.repeat(8) }, NOW);
  fs.writeFileSync(path.join(exp, 'decisions.json'), JSON.stringify([{ row: 'market-helper', flag: 'evidence-empty', status: 'KNOWN' }]));
  const r2 = review(exp, { now: NOW });
  const v2 = Object.fromEntries(r2.rows.map((r) => [r.row.id, r]));
  check('one harmful disagreement turns the canary into STOP', v2['pantry-canary'].verdict === 'STOP' && r2.md.indexOf('## STOP') < r2.md.indexOf('## Rows'));
  check('a decisions entry without "until" is skipped and reported', v2['market-helper'].verdict === 'LOOKS WRONG' && r2.md.includes('needs row, flag, status and until'));
  check('raw lines are masked', !r2.md.includes('Zq9Zq9Zq9') && r2.md.includes('token=[masked]'));
  check('loadDecisions drops expired entries', loadDecisions(exp, '2026-11-17').active.length === 0);

  // the register problem path
  raw.rows.find((r) => r.id === 'barter-board').treatment = ['juniper'];
  fs.writeFileSync(path.join(exp, 'register.json'), JSON.stringify(raw));
  const r3 = review(exp, { now: NOW });
  check('an agent in two open rows makes both LOOKS WRONG [register]', r3.rows.filter((r) => r.flags.includes('register')).length === 2 && r3.md.includes('## Register problems'));
  const fresh = tmp('xk-fresh-');
  saveRegister(fresh, { rows: [F.row({ liveSince: new Date(NOW - 3 * H).toISOString(), barWrittenAt: new Date(NOW - 4 * H).toISOString(), backstop: '2026-11-30' })] });
  const fr = review(fresh, { now: NOW }).rows[0];
  check('a row live under 24 h with no outcomes yet is OK, not "evidence empty"', fr.verdict === 'OK' && !fr.flags.length, fr.verdict + ' ' + fr.flags);
  check('the same row 25 h in with no outcomes is LOOKS WRONG', review(fresh, { now: NOW + 22 * H }).rows[0].flags.includes('evidence-empty'));
  check('rawFlags volume flag', rawFlags(F.row(), [], { projected: 40, enough: false, backstopPassed: false }).some(([k]) => k === 'volume'));
}

// ── gates ──
{
  const res = await runGates(BUILTIN_GATES);
  check('every built-in gate says no to its known-bad cases', res.ok, res.results.filter((r) => !r.ok).map((r) => r.name + ': ' + r.problems.join('; ')).join(' | '));
  check('there are 10 built-in gates, each with bad cases', BUILTIN_GATES.length === 10 && BUILTIN_GATES.every((g) => g.bad.length >= 3));
  const yes = await runGate({ name: 'always-yes', accept: () => true, good: [{ label: 'a', input: 1 }], bad: [{ label: 'b', input: 2 }] });
  check('a gate that says yes to everything FAILS', !yes.ok && yes.problems[0].includes('let through'));
  const untested = await runGate({ name: 'untested', accept: (x) => x > 0, good: [{ label: 'a', input: 1 }], bad: [] });
  check('a gate never shown a bad case FAILS', !untested.ok && untested.problems[0].includes('never rejected anything'));
  const no = await runGate({ name: 'always-no', accept: () => false, good: [{ label: 'a', input: 1 }], bad: [{ label: 'b', input: 2 }] });
  check('a gate that refuses everything FAILS', !no.ok && no.problems[0].includes('refused a known-good'));
  const blind = await runGate({ name: 'blind', accept: (c) => c.coins === 40, good: [{ label: 'r', input: { id: 'M-1', coins: 40 } }], bad: [{ label: 'b', input: { id: 'M-1', coins: 41 } }], mutants: [['id', 'flip'], ['coins', 'bump']] });
  check('a gate that ignores a field: the mutant survives and it FAILS', !blind.ok && blind.mutants.killed === 1 && blind.problems.some((p) => p.includes('survived: flip id')));
  const thrower = await runGate({ name: 't', accept: (x) => { if (x < 0) throw new Error('boom'); return true; }, good: [{ label: 'a', input: 1 }], bad: [{ label: 'b', input: -1 }] });
  check('throwing counts as "no"', thrower.ok);
  const nofn = await runGate({ name: 'n', good: [], bad: [] });
  check('a gate with no accept() FAILS', !nofn.ok);
  check('a mutant on a missing field is reported', (await runGate({ name: 'm', accept: (x) => x.a === 1, good: [{ label: 'g', input: { a: 1 } }], bad: [{ label: 'b', input: { a: 2 } }], mutants: [['zz', 'flip']] })).problems[0].includes('does not apply'));
  check('mutate: flip, drop, bump, future, nested path', mutate({ s: 'abc' }, 's', 'flip').input.s === 'axc' && !('s' in mutate({ s: 1 }, 's', 'drop').input) && mutate({ n: 100 }, 'n', 'bump').input.n === 102 && mutate({ d: '2026-01-01' }, 'd', 'future').input.d === '2026-01-31' && mutate({ a: [{ b: 2 }] }, 'a.0.b', 'negate').input.a[0].b === -2);
  check('mutate never changes the original', (() => { const o = { a: { b: 1 } }; mutate(o, 'a.b', 'zero'); return o.a.b === 1; })());
  const ex = await runGates(receiptGates);
  check('the example receipt gate passes, mutants all killed', ex.ok && ex.results[0].mutants.killed === ex.results[0].mutants.n && ex.results[0].mutants.n === 12, formatGates(ex));
  check('receiptMatches refuses a reused receipt', !receiptMatches({ receipt: 'M-7301', agent: 'wren', item: 'nets', qty: 10, coins: 40 }, new Set(['M-7301'])));
  check('formatGates prints FAIL and the reason', formatGates({ ok: false, results: [yes] }).includes('FAIL') && formatGates({ ok: false, results: [yes] }).includes('do not trust'));
}

// ── command line ──
{
  const demo = await run(['--demo', '--now', '2026-11-17T20:00:00Z']);
  check('--demo runs, prints the review and the gates, exit 0', demo.code === 0 && demo.out.includes('## REPEAT') && demo.out.includes('gates: 10 ok'), demo.err.slice(0, 200));
  check('--demo removes its temporary folder', !/kept:/.test(demo.out));
  const keep = path.join(tmp('xk-keep-'), 'k');
  const kd = await run(['--demo', '--keep', keep, '--now', '2026-11-17T20:00:00Z']);
  const E = path.join(keep, 'experiments');
  check('--demo --keep leaves the folders', kd.code === 0 && fs.existsSync(path.join(E, 'register.md')) && fs.existsSync(path.join(keep, 'fleet-data', 'history')));
  check('--keep refuses a folder that is not empty', (await run(['--demo', '--keep', keep])).code === 2);
  const g = await run(['gates', '--gates', path.join(HERE, 'examples', 'receipt-gate.mjs')]);
  check('gates with your own file: 11 ok, exit 0', g.code === 0 && g.out.includes('gates: 11 ok'));
  const badFile = path.join(tmp('xk-g-'), 'bad.mjs');
  fs.writeFileSync(badFile, "export default [{ name: 'lenient', accept: () => true, good: [{ label: 'g', input: 1 }], bad: [] }];\n");
  const gb = await run(['gates', '--gates', badFile]);
  check('a gate file with an untested gate: exit 1, named', gb.code === 1 && gb.out.includes('lenient') && gb.out.includes('FAIL'));
  const rd = await run(['readout', '--dir', E, 'tide-table', '--now', '2026-11-17T20:00:00Z']);
  check('readout prints the state, number and sample', rd.code === 0 && /tide-table: MET .* hour windows \(min 150\)/.test(rd.out), rd.out + rd.err);
  const early = await run(['decide', '--dir', E, 'short-rest', 'KEEP', '--now', '2026-11-17T20:00:00Z']);
  check('decide refuses on half the sample', early.code === 2 && early.err.includes('--early'));
  const dk = await run(['decide', '--dir', E, 'tide-table', 'KEEP', '--why', 'bar met, raw lines clean', '--now', '2026-11-17T20:00:00Z']);
  const after = loadRegister(E).rows.find((r) => r.id === 'tide-table');
  check('decide records KEEP with number and sample, and the note', dk.code === 0 && /^DECIDED 2026-11-17: KEEP \(median xp_per_min \+[\d.]+%.*hour windows\)$/.test(after.status) && after.notes.at(-1).kind === 'decision', after.status);
  check('register.md shows the decision', fs.readFileSync(path.join(E, 'register.md'), 'utf8').includes('DECIDED 2026-11-17: KEEP'));
  check('a decided row cannot be decided again', (await run(['decide', '--dir', E, 'tide-table', 'REVERT'])).code === 2);
  const cl = await run(['decide', '--dir', E, 'market-helper', 'CLOSE', '--why', 'the helper sat on a path the crew never takes', '--now', '2026-11-17T20:00:00Z']);
  check('CLOSE with a reason closes the row', cl.code === 0 && loadRegister(E).rows.find((r) => r.id === 'market-helper').status.startsWith('CLOSED 2026-11-17: the helper sat'));
  const lg = await run(['log', '--dir', E, '--exp', 'barter-board', '--agent', 'basil', '--arm', 'T', '--metric', 'trades', '--value', '1', '--proof', 'receipt B-9001']);
  const lc = await run(['log', '--dir', E, '--exp', 'barter-board', '--agent', 'basil', '--arm', 'T', '--metric', 'trades', '--claimed', 'sold salt']);
  const ln = await run(['log', '--dir', E, '--exp', 'short-rest', '--agent', 'quill', '--arm', 'C', '--metric', 'coins_per_min', '--pair', '35', '--not-measured', 'agent restarted']);
  const last3 = readOutcomes(E).slice(-3);
  check('log: confirmed, claimed and not-measured outcomes', lg.code === 0 && lc.code === 0 && ln.code === 0 && last3.some((r) => r.proof === 'receipt B-9001' && r.confirmed) && last3.some((r) => r.claimed === 'sold salt' && !r.confirmed) && last3.some((r) => r.ok === false && r.why === 'agent restarted'));
  check('log refuses a row that is not registered', (await run(['log', '--dir', E, '--exp', 'nope', '--agent', 'a', '--arm', 'T', '--metric', 'm', '--value', '1', '--proof', 'x'])).code === 2);
  check('log refuses a value with no proof and no claim', (await run(['log', '--dir', E, '--exp', 'barter-board', '--agent', 'basil', '--arm', 'T', '--metric', 'trades', '--value', '1'])).err.includes('proof'));
  const ar = await run(['arm', 'short-rest', '3']);
  check('arm prints the pair and the arm', ar.code === 0 && JSON.parse(ar.out).pair === 2 && ['T', 'C'].includes(JSON.parse(ar.out).arm));
  const rv = await run(['review', '--dir', E, '--dry', '--now', '2026-11-18T08:00:00Z']);
  check('review --dry prints and writes nothing', rv.code === 0 && rv.out.includes('# Daily review: 2026-11-18') && !fs.existsSync(path.join(E, 'verdicts', '2026-11-18.md')));
  const tz = await run(['review', '--dir', E, '--dry', '--now', '2026-11-18T03:00:00Z', '--tz', 'America/New_York']);
  check('review --tz names the day in that zone', tz.out.includes('# Daily review: 2026-11-17'));
  const rg = await run(['register', '--dir', E]);
  check('register checks and rewrites register.md', rg.code === 0 && rg.out.includes('✓ 7 rows (3 open)'));
  const raw = JSON.parse(fs.readFileSync(path.join(E, 'register.json'), 'utf8'));
  raw.rows[0].barWrittenAt = '2026-12-31T00:00:00Z'; fs.writeFileSync(path.join(E, 'register.json'), JSON.stringify(raw));
  const rb = await run(['register', '--dir', E]);
  check('register exits 1 and names a bar written after go-live', rb.code === 1 && rb.out.includes('written after the change went live'));
  check('--help prints the usage', (await run(['--help'])).out.includes('xk.mjs gates'));
  check('no --dir is an error, exit 2', (await run(['review'])).code === 2);
  const empty = tmp('xk-empty-');
  check('collect with no open fleet-dashboard row says so', (await run(['collect', '--dir', E])).out.includes('nothing to collect'));
  check('a missing register.json is a clear error', (await run(['review', '--dir', empty])).err.includes('register.json: not found'));
}

for (const d of TEMPS) fs.rmSync(d, { recursive: true, force: true });
console.log(`\nselftest: ${ok} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
