#!/usr/bin/env node
// selftest.mjs: runs driver.mjs against fake-city.mjs in temporary folders. No account, no network
// (the model check uses a tiny server on 127.0.0.1). Prints one line per check and a summary.
//   node selftest.mjs        expect "selftest: N ok, 0 failed"
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, checkLine, readPause, foodIds, loadConfig, errorLine } from './driver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPS = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TEMPS.push(d); return d; };
let ok = 0, failed = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : `  (${extra})`}`); };

const MERCHANTS = [
  { name: 'Noodle Cart', source: 'outlet', offer: { acceptsItemId: 'crystal', acceptsQuantity: 3, paysItemId: 'noodles', paysQuantity: 1 } },
  { name: 'Wood Buyer', source: 'npc', offer: { acceptsItemId: 'log', acceptsQuantity: 5, paysItemId: 'crystal', paysQuantity: 2 } },
  { name: 'Ore Buyer', source: 'npc', offer: { acceptsItemId: 'ore', acceptsQuantity: 4, paysItemId: 'crystal', paysQuantity: 3 } },
];
const SOURCES = [
  { sourceId: 'deep_ore', skill: 'mining', level: 1, requiredLevel: 10, availableNodeIds: [], failureReason: 'level_too_low', yields: 'gem' },
  { sourceId: 'pine_logs', skill: 'woodcutting', level: 1, requiredLevel: 1, availableNodeIds: ['n1'], failureReason: null, yields: 'log' },
  { sourceId: 'surface_ore', skill: 'mining', level: 1, requiredLevel: 1, availableNodeIds: ['n2'], failureReason: null, yields: 'ore' },
];
const world = (over = {}) => ({ agent: { id: 'agent-test-1', profession: 'lumberjack', isPerformingJob: false, activeAction: null, activeModule: null },
  connected: false, hunger: { state: 'normal', value: 10 }, items: { crystal: 10 }, loadAt: 30, merchants: MERCHANTS, sources: SOURCES, ...over });

async function drive({ w, cfg = {}, args = [], env = {}, before }) {
  const dir = tmp('driver-test-');
  const state = path.join(dir, 'world.json'), calls = path.join(dir, 'calls.log');
  fs.writeFileSync(state, JSON.stringify(w));
  fs.writeFileSync(path.join(dir, 'driver.json'), JSON.stringify({ agentId: 'agent-test-1', tickSeconds: 60, jobs: ['deep_ore', 'pine_logs'], ...cfg }));
  if (before) before(dir);
  const res = await new Promise((resolve) => execFile(process.execPath, [path.join(HERE, 'driver.mjs'), '--config', path.join(dir, 'driver.json'), '--fast', ...args],
    { env: { ...process.env, MCITY_HELPER: path.join(HERE, 'fake-city.mjs'), FAKE_CITY_STATE: state, FAKE_CITY_CALLS: calls, ...env }, timeout: 60_000 },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stderr })));
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
  const log = read('log.jsonl').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { ...res, dir, log, calls: read('calls.log').trim().split('\n').filter(Boolean), world: JSON.parse(read('world.json')), raw: read('log.jsonl'), read };
}
const acts = (r) => r.log.filter((e) => e.event === 'act');
const sent = (r, cmd) => r.calls.filter((c) => c.split(' ')[0] === cmd);

// ---- the pure decision ----
const S = (o) => ({ notes: [], context: { agent: { isPerformingJob: false, activeAction: null } }, needs: { hunger: { state: 'normal' } },
  inventory: { items: {}, load: { state: 'normal' } }, merchants: { merchants: MERCHANTS }, progression: { capabilities: { sources: SOURCES } }, ...o });
const C = { mode: 'gather', jobs: [], keep: [], food: [] };
check('food is what outlets sell for crystal', JSON.stringify(foodIds(C, MERCHANTS)) === '["noodles"]');
check('food list in config wins', JSON.stringify(foodIds({ ...C, food: ['fish'] }, MERCHANTS)) === '["fish"]');
check('hungry with food: eat', decide(S({ needs: { hunger: { state: 'hungry' } }, inventory: { items: { noodles: 1 }, load: { state: 'normal' } } }), C).act?.[0] === 'eat');
check('hungry, no food, can pay: buy the cheapest food',
  JSON.stringify(decide(S({ needs: { hunger: { state: 'starving' } }, inventory: { items: { crystal: 5 }, load: { state: 'normal' } } }), C).act) === '["trade","Noodle Cart","crystal",3]');
{ const s = S({ needs: { hunger: { state: 'hungry' } }, inventory: { items: { crystal: 1 }, load: { state: 'normal' } } });
  const d = decide(s, C);
  check('hungry, no food, can\'t pay: works to earn and says so', d.act?.[0] === 'gather' && s.notes.some((n) => n.includes('no affordable seller'))); }
check('loaded: sells whole batches of the heaviest item',
  JSON.stringify(decide(S({ inventory: { items: { log: 12, ore: 3 }, load: { state: 'loaded', heaviestItem: 'log' } } }), C).act) === '["trade","Wood Buyer","log",10]');
check('loaded: never sells a kept item',
  JSON.stringify(decide(S({ inventory: { items: { log: 12, ore: 9 }, load: { state: 'loaded', heaviestItem: 'log' } } }), { ...C, keep: ['log'] }).act) === '["trade","Ore Buyer","ore",8]');
check('loaded: never sells food or crystal',
  decide(S({ inventory: { items: { noodles: 40, crystal: 90 }, load: { state: 'loaded', heaviestItem: 'noodles' } } }), C).act?.[0] === 'gather');
check('already working: waits', !!decide(S({ context: { agent: { isPerformingJob: true } } }), C).wait);
check('mid-action: waits', !!decide(S({ context: { agent: { activeAction: { kind: 'gather' } } } }), C).wait);
check('event lock: waits even when hungry', !!decide(S({ context: { agent: { activeModule: { locksCommonActions: true } } }, needs: { hunger: { state: 'starving' } } }), C).wait);
{ const s = S(); const d = decide(s, { ...C, jobs: ['deep_ore', 'pine_logs'] });
  check('job list: skips a blocked source and says why', d.act?.[1] === 'pine_logs' && s.notes.some((n) => n.includes('deep_ore') && n.includes('level_too_low'))); }
{ const s = S(); const d = decide(s, { ...C, jobs: ['moon_rock'] });
  check('job list: unknown source logged, then waits', !!d.wait && s.notes.some((n) => n.includes('moon_rock') && n.includes('not offered'))); }
check('work mode: profession work', decide(S(), { ...C, mode: 'work' }).act?.[0] === 'work');
check('mid-action: no eat or trade either (a new action would replace it)',
  !!decide(S({ context: { agent: { activeAction: { kind: 'move' } } }, needs: { hunger: { state: 'starving' } }, inventory: { items: { noodles: 2, log: 40 }, load: { state: 'loaded', heaviestItem: 'log' } } }), C).wait);
check('on a profession job: eating may interrupt it', decide(S({ context: { agent: { isPerformingJob: true } }, needs: { hunger: { state: 'hungry' } }, inventory: { items: { noodles: 1 }, load: { state: 'normal' } } }), C).act?.[0] === 'eat');
check('hungry, no food, can\'t pay, has something to sell: sells first',
  JSON.stringify(decide(S({ needs: { hunger: { state: 'starving' } }, inventory: { items: { crystal: 1, log: 6 }, load: { state: 'normal', heaviestItem: 'log' } } }), C).act) === '["trade","Wood Buyer","log",5]');
check('overburdened with nothing to sell: waits instead of gathering more',
  !!decide(S({ inventory: { items: { log: 99 }, load: { state: 'overburdened', heaviestItem: 'log' } } }), { ...C, keep: ['log'] }).wait);
{ const m = [{ name: 'Wood Buyer', source: 'npc', offer: { acceptsItemId: 'log', acceptsQuantity: 5, paysItemId: 'crystal', paysQuantity: 2 }, trade: { merchantName: 'Wood Buyer (east)', itemId: 'log', quantity: 5 } }];
  check('trade: copies merchantName and quantity from the offer\'s own trade object',
    JSON.stringify(decide(S({ merchants: { merchants: m }, inventory: { items: { log: 11 }, load: { state: 'loaded', heaviestItem: 'log' } } }), C).act) === '["trade","Wood Buyer (east)","log",10]'); }
check('helper errors: the error line wins over Node\'s version line',
  errorLine('file:///x/fake.mjs:3\n    at foo (x.mjs:1)\nError: ENOENT: no such file\n\nNode.js v26.12.1\n', 'x') === 'Error: ENOENT: no such file');
const facts = ['hunger is normal', 'carrying 12 log'];
check('journal: an invented number is rejected', !checkLine('I chopped 40 logs at dawn', facts, []).ok);
check('journal: a number from the facts is fine', checkLine('Twelve? No: 12 log on my back.', facts, []).ok);
check('journal: "2" is not accepted just because "12" is in the facts', !checkLine('I felled 2 pines.', facts, []).ok);
check('journal: empty is rejected', checkLine('  ', facts, []).why === 'empty reply');
check('journal: a repeat is rejected', !checkLine('Same old day.', facts, ['same old day.']).ok);
check('journal: too long is rejected', !checkLine('x'.repeat(201), facts, []).ok);

// ---- PAUSE file ----
{ const d = tmp('pause-');
  fs.writeFileSync(path.join(d, 'PAUSE'), '');
  const p = readPause(d);
  check('PAUSE: an empty file (touch) pauses, by unknown', p && !p.expired && p.by.startsWith('unknown'));
  fs.writeFileSync(path.join(d, 'PAUSE'), JSON.stringify({ by: 'me', until: new Date(Date.now() - 1000).toISOString() }));
  check('PAUSE: past its until is expired', readPause(d).expired); }

// ---- whole runs against the fake City ----
{ const r = await drive({ w: world(), args: ['--ticks', '2'] });
  check('run: connects first and disconnects at the end', r.calls[0] === 'connect agent-test-1' && r.calls.at(-1) === 'disconnect');
  check('run: gathers the first open job in the list', acts(r)[0]?.act?.join(' ') === 'gather pine_logs' && acts(r)[0].result === 'confirmed');
  check('run: the gain is measured from inventory, not assumed', r.log.some((e) => e.event === 'inventory_changed' && e.delta.log === 1)); }
{ const r = await drive({ w: world({ hunger: { state: 'hungry', value: 80 }, items: { crystal: 9 } }), args: ['--ticks', '3'] });
  const a = acts(r).map((e) => e.act[0]);
  check('run: hungry with no food buys, then eats, then works', a.join(',') === 'trade,eat,gather', a.join(',')); }
{ const r = await drive({ w: world({ next: { gather: 'pending' } }), args: ['--once'] });
  check('run: a pending outcome is logged as pending, not done', acts(r)[0]?.result === 'pending' && acts(r)[0].submitted === true); }
{ const r = await drive({ w: world({ next: { gather: 'pending' } }), args: ['--ticks', '4'] });
  const waits = r.log.filter((e) => e.event === 'wait').map((e) => e.why);
  check('run: after pending it waits (mid-action, then holds) and does not resend at once',
    sent(r, 'gather').length === 2 && waits.some((w) => w.startsWith('mid-action')) && waits.some((w) => w.includes('still pending')), `${sent(r, 'gather').length} gathers; ${waits.join(' | ')}`); }
{ const r = await drive({ w: world({ agent: { ...world().agent, profession: null } }), cfg: { mode: 'work' }, args: ['--ticks', '6'] });
  check('run: the same failure 3 times in a row backs off', sent(r, 'work').length === 3 && r.log.some((e) => e.event === 'backoff')); }
{ const r = await drive({ w: world(), args: ['--ticks', '3'] });
  check('run: a note is logged when it changes, not every tick', r.log.filter((e) => e.event === 'note' && e.note.startsWith('skipped deep_ore')).length === 1); }
{ const r = await drive({ w: world({ refuseConnectAfter: 1, expireOn: 'gather' }), args: ['--ticks', '10'] });
  const rc = r.log.filter((e) => e.event === 'reconnect');
  check('lease: a refused reconnect is logged with its reason', rc.length > 0 && rc.every((e) => e.ok === false && /lease expired|not connected/.test(e.because)));
  check('lease: after 3 refused reconnects it stops instead of fighting', r.code === 1 && r.log.some((e) => e.event === 'giving_up') && sent(r, 'disconnect').length === 0 && sent(r, 'connect').length === 4); }
{ const r = await drive({ w: world({ skillUpdate: { updated: true, installedVersion: '2099-01-01T00:00:00Z' } }), args: ['--ticks', '3'] });
  check("skill update: the City's skill updated itself, so the driver stops and says why", r.code === 3 && r.log.some((e) => e.event === 'skill_updated' && e.installedVersion) && acts(r).length === 0 && /Re-read its SKILL.md/.test(r.stderr)); }
{ const r = await drive({ w: world({ next: { gather: 'failed:node_reserved' } }), args: ['--once'] });
  check('run: a failed outcome is logged with its reason', acts(r)[0]?.result === 'failed' && acts(r)[0].reason === 'node_reserved'); }
{ const r = await drive({ w: world(), args: ['--once', '--dry-run'] });
  check('dry run: no connect, no actions', sent(r, 'connect').length === 0 && ['gather', 'eat', 'trade', 'work', 'stop-work', 'disconnect'].every((c) => sent(r, c).length === 0));
  check('dry run: logs what it would do', r.log.some((e) => e.event === 'would' && e.act.join(' ') === 'gather pine_logs')); }
{ const r = await drive({ w: world(), cfg: { agentId: '' }, args: ['--once', '--dry-run'] });
  check('dry run: refuses without an agent id', r.code === 2 && /needs "agentId"/.test(r.stderr)); }
{ const r = await drive({ w: world({ agent: { ...world().agent, isPerformingJob: true } }), args: ['--ticks', '3'],
    before: (d) => fs.writeFileSync(path.join(d, 'PAUSE'), JSON.stringify({ by: 'owner', until: new Date(Date.now() + 600_000).toISOString() })) });
  const rel = JSON.parse(r.read('RELEASED') || '{}');
  check('pause: stops work, hands back control, writes RELEASED', sent(r, 'stop-work').length === 1 && sent(r, 'disconnect').length === 1 && rel.by === 'owner' && rel.stoppedWork && rel.released);
  check('pause: no world action while paused', acts(r).length === 0 && sent(r, 'gather').length === 0);
  check('pause: logged once, not every tick', r.log.filter((e) => e.event === 'paused').length === 1); }
{ let second;
  const r = await drive({ w: world({ agent: { ...world().agent, isPerformingJob: true } }), args: ['--ticks', '40'], before: (d) => {
    fs.writeFileSync(path.join(d, 'PAUSE'), JSON.stringify({ by: 'me', at: new Date().toISOString(), until: new Date(Date.now() + 600_000).toISOString() }));
    setTimeout(() => {   // the human connected and started work, then extends the pause
      const st = path.join(d, 'world.json'), w = JSON.parse(fs.readFileSync(st, 'utf8')); w.connected = true; w.agent.isPerformingJob = true; fs.writeFileSync(st, JSON.stringify(w));
      second = new Date().toISOString();
      fs.writeFileSync(path.join(d, 'PAUSE'), JSON.stringify({ by: 'me', at: second, until: new Date(Date.now() + 900_000).toISOString() }));
    }, 600); } });
  check('pause: a renewed PAUSE is answered and nothing is sent', r.log.some((e) => e.event === 'pause_renewed') && sent(r, 'stop-work').length === 1 && sent(r, 'disconnect').length === 1 && sent(r, 'connect').length === 1
    && r.world.agent.isPerformingJob === true && JSON.parse(r.read('RELEASED')).for === second); }
{ const r = await drive({ w: world(), args: ['--ticks', '40'],
    before: (d) => fs.writeFileSync(path.join(d, 'PAUSE'), JSON.stringify({ by: 'test', until: new Date(Date.now() + 1500).toISOString() })) });
  const ev = r.log.map((e) => e.event);
  check('pause: resumes by itself when until passes', ev.indexOf('paused') < ev.indexOf('pause_expired') && ev.indexOf('pause_expired') < ev.indexOf('act'), ev.join(','));
  check('pause: RELEASED is removed on resume', !fs.existsSync(path.join(r.dir, 'RELEASED'))); }
{ const r = await drive({ w: world(), args: ['--ticks', '60'], before: (d) => {
    fs.writeFileSync(path.join(d, 'PAUSE'), '{}');
    setTimeout(() => fs.rmSync(path.join(d, 'PAUSE')), 700); } });
  check('pause: resumes when the owner deletes PAUSE', r.log.some((e) => e.event === 'resumed') && sent(r, 'connect').length === 2); }
{ const r = await drive({ w: world({ expireOn: 'gather' }), args: ['--once'] });
  check('lease: an expired lease reconnects once and the action goes through', r.log.some((e) => e.event === 'reconnect') && sent(r, 'connect').length === 2 && acts(r)[0]?.result === 'confirmed'); }
{ const d = tmp('cfg-'), f = path.join(d, 'driver.json'), seen = [];
  fs.writeFileSync(f, '{"mode":"work"}');
  const good = loadConfig(f, null, () => {});
  fs.writeFileSync(f, '{ broken');
  const kept = loadConfig(f, good, (e) => seen.push(e));
  check('config: a broken edit keeps the last good config and logs it', kept.mode === 'work' && seen[0]?.event === 'config_error');
  fs.writeFileSync(f, '{"mode":"gather"}');
  const back = loadConfig(f, kept, (e) => seen.push(e));
  check('config: fixing the file is logged too', back.mode === 'gather' && seen[1]?.event === 'config_ok'); }
{ const r = await drive({ w: world(), cfg: { mode: 'fly' }, args: ['--once'] });
  check('config: a bad first config stops with a clear message', r.code === 2 && /mode must be/.test(r.stderr)); }
{ const r = await drive({ w: world(), args: ['--once'], env: { MCITY_HELPER: '/nonexistent/mcity-control.mjs' } });
  check('setup: a missing helper says what to set', r.code === 2 && /skillDir/.test(r.stderr)); }
{ const r = await drive({ w: world({ agent: { ...world().agent, activeModule: { locksCommonActions: true } } }), args: ['--once'] });
  check('event lock: no action sent', acts(r).length === 0 && r.log.some((e) => e.event === 'wait')); }

// ---- pause.mjs against a running driver ----
{ const dir = tmp('pause-run-'), state = path.join(dir, 'world.json');
  fs.writeFileSync(state, JSON.stringify(world({ agent: { ...world().agent, isPerformingJob: true } })));
  fs.writeFileSync(path.join(dir, 'driver.json'), JSON.stringify({ agentId: 'agent-test-1', tickSeconds: 60, jobs: ['pine_logs'] }));
  const env = { ...process.env, MCITY_HELPER: path.join(HERE, 'fake-city.mjs'), FAKE_CITY_STATE: state };
  const drv = spawn(process.execPath, [path.join(HERE, 'driver.mjs'), '--config', path.join(dir, 'driver.json'), '--fast', '--ticks', '600'], { env, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const run = (...a) => new Promise((resolve) => execFile(process.execPath, [path.join(HERE, 'pause.mjs'), dir, ...a], { env: { ...env, PAUSE_WAIT_SECONDS: '20' } }, (err, stdout) => resolve({ code: err ? err.code : 0, stdout })));
  const p = await run('5', '--by', 'selftest');
  const w1 = JSON.parse(fs.readFileSync(state, 'utf8'));
  check('pause.mjs: waits for RELEASED and reports it', p.code === 0 && /RELEASED: work stopped, control handed back/.test(p.stdout), p.stdout.trim());
  check('pause.mjs: the agent really stopped and was let go', w1.agent.isPerformingJob === false && w1.connected === false);
  const off = await run('off');
  await new Promise((r) => setTimeout(r, 1500));
  const log = fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8');
  check('pause.mjs off: the driver resumes and reconnects', off.code === 0 && /"resumed"/.test(log) && JSON.parse(fs.readFileSync(state, 'utf8')).connected === true);
  drv.kill('SIGTERM'); await new Promise((r) => drv.on('exit', r));
  check('Ctrl-C: the driver disconnects and logs stop', /"stop"/.test(fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8')) && JSON.parse(fs.readFileSync(state, 'utf8')).connected === false); }
{ const r = await new Promise((resolve) => execFile(process.execPath, [path.join(HERE, 'pause.mjs'), os.tmpdir(), '0'], (err) => resolve(err ? err.code : 0)));
  check('pause.mjs: refuses a pause with no end', r === 2); }
{ const dir = tmp('pause-fail-'), state = path.join(dir, 'world.json');
  fs.writeFileSync(state, JSON.stringify(world({ failDisconnect: true })));
  fs.writeFileSync(path.join(dir, 'driver.json'), JSON.stringify({ agentId: 'agent-test-1', tickSeconds: 60, jobs: ['pine_logs'] }));
  const env = { ...process.env, MCITY_HELPER: path.join(HERE, 'fake-city.mjs'), FAKE_CITY_STATE: state };
  const drv = spawn(process.execPath, [path.join(HERE, 'driver.mjs'), '--config', path.join(dir, 'driver.json'), '--fast', '--ticks', '600'], { env, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const code = await new Promise((resolve) => execFile(process.execPath, [path.join(HERE, 'pause.mjs'), dir, '5'], { env: { ...env, PAUSE_WAIT_SECONDS: '20' } }, (err) => resolve(err ? err.code : 0)));
  check('pause.mjs: exits 3 when the driver could not hand back control', code === 3);
  drv.kill('SIGTERM'); await new Promise((r) => drv.on('exit', r)); }

// ---- words from a model (OpenAI-style and Ollama-style), never actions ----
{ const replies = ['I chopped 99 logs.', '', 'Carrying my first log; hunger is normal.', 'Carrying my first log; hunger is normal.'];
  let auth = '', n = 0;
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    auth = req.headers.authorization || ''; const text = replies[n++] ?? 'Quiet day.';
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url.endsWith('/api/chat') ? { message: { content: text } } : { choices: [{ message: { content: text } }] }));
  }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const r = await drive({ w: world(), args: ['--ticks', '4'], env: { TEST_MODEL_KEY: 'sk-test-not-real-0000' },
    cfg: { words: { enabled: true, url: `${url}/v1/chat/completions`, model: 'any', everyMinutes: 0, apiKeyEnv: 'TEST_MODEL_KEY' } } });
  const why = r.log.filter((e) => e.event === 'journal_rejected').map((e) => e.why);
  check('words: invented number, empty and repeat are all rejected', why.some((w) => w.startsWith('number 99')) && why.includes('empty reply') && why.includes('repeats a recent line'), why.join('|'));
  check('words: one good line reaches journal.md', (r.read('journal.md').match(/^- /gm) || []).length === 1);
  check('words: the key is sent to the model and never logged', auth === ['Bearer', 'sk-test-not-real-0000'].join(' ') && !r.raw.includes('sk-test') && !r.read('journal.md').includes('sk-test'));
  check('words: the model never causes an action', acts(r).every((e) => ['gather', 'eat', 'trade', 'work'].includes(e.act[0])));
  n = 2;
  const o = await drive({ w: world(), args: ['--once'], cfg: { words: { enabled: true, url: `${url}/api/chat`, model: 'any', everyMinutes: 0 } } });
  check('words: Ollama /api/chat works too', o.log.some((e) => e.event === 'journal'));
  srv.close();
  const down = await drive({ w: world(), args: ['--once'], cfg: { words: { enabled: true, url: 'http://127.0.0.1:9/v1/chat/completions', model: 'any' } } });
  check('words: a dead model is logged and the loop goes on', down.log.some((e) => e.event === 'journal_failed') && acts(down).length === 1); }

for (const d of TEMPS) fs.rmSync(d, { recursive: true, force: true });
console.log(`\nselftest: ${ok} ok, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
