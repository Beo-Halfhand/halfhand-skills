#!/usr/bin/env node
// demo.mjs: all four controls on one made-up agent ("scout") and its owner, in a temporary folder, in fast time
// (about 20 seconds). Nothing real is touched: no network, no real agent, the folder is removed at the end.
//   node demo.mjs          run it
//   node demo.mjs --keep   keep the folder to look at the files
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watchPause, hold } from './lib/pause.mjs';
import { openAsk, resolveAsk, closeAsk, outcomeLine, answerAsk, openAsks, approvalFrom } from './lib/asks.mjs';
import { fileHandback, ingestHandbacks, recentSelf, promptBlock } from './lib/handback.mjs';
import { createLimits } from './lib/limits.mjs';
import { makeGate } from './lib/gate.mjs';
import { writeJson } from './lib/files.mjs';

const keep = process.argv.includes('--keep');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-controls-demo-'));
const agentDir = path.join(root, 'scout'), asksDir = path.join(root, 'asks'), events = path.join(agentDir, 'events.jsonl');
fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
const t0 = Date.now();
const say = (who, msg) => console.log(`${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(5)}s  ${who.padEnd(7)} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const heading = (s) => console.log(`\n── ${s}`);

writeJson(path.join(agentDir, 'policy.json'), {
  mode: 'on', tz: 'UTC', spend: { perAction: 50, perDay: 100 },
  allow: ['work', 'buy_tool', 'speak'], readOnly: ['look'], needsHuman: ['send_coins'], approvals: 'asks', floors: { food: 1 },
});
const limits = createLimits(agentDir);
const gate = makeGate({ maxChars: 200, banned: ['guaranteed'] });

// The driver: a pause watcher on its own timer, and a resume step that reads in what happened.
const driver = watchPause(agentDir, {
  intervalMs: 200,
  onPause: async (p) => { say('driver', `PAUSE by ${p.by}: stopping work, hands off, writing RELEASED`); return { stoppedWork: true, released: true }; },
  onResume: async ({ by, expired, since }) => {
    say('driver', expired ? `the pause by ${by} expired: taking the agent back` : `PAUSE removed: resuming`);
    const { events: got, placeholder } = ingestHandbacks(events, { since, by });
    for (const e of got) say('driver', `HANDBACK from ${e.by}: ${e.text}${placeholder ? '  (placeholder: nobody filed one)' : ''}`);
  },
});
const act = (action, ctx = {}) => {
  if (driver.paused) { say('driver', `${action}: not now, paused`); return false; }
  const c = limits.check(action, ctx);
  say('driver', c.ok ? `${action}${ctx.amount ? ` (${ctx.amount} coins)` : ''}: allowed` : `${action}${ctx.amount ? ` (${ctx.amount} coins)` : ''}: REFUSED [${c.rule}] ${c.reason}`);
  if (c.ok && ctx.amount) limits.record(ctx.amount);
  return c.ok;
};

heading('1. owner-limits: caps, a floor, and an action that needs the owner');
act('buy_tool', { amount: 40 });
act('buy_tool', { amount: 70 });
act('buy_tool', { amount: 40 });
act('buy_tool', { amount: 40 });
act('work', { after: { food: 0 } });
act('send_coins', { amount: 10, to: 'pip' });

heading('2. ask-the-owner: three asks, each with a deadline and a default for silence');
const money = openAsk(asksDir, { id: 'A1', agent: 'scout', kind: 'money', onTimeout: 'nothing', minutes: 0.06,
  question: 'Pip asks scout to send 10 coins for a shared boat. Send them?', draft: 'Sent 10 coins for the boat.', context: ['pip: want to share a boat?', 'scout: maybe, how much?'] }).ask;
say('agent', `ask #${money.id} [money]: "${money.question}" default if silent: nothing`);
const friend = openAsk(asksDir, { id: 'A2', agent: 'scout', kind: 'friend', onTimeout: 'send', minutes: 0.06,
  question: 'Moss says hi and asks what scout is up to.', draft: 'Hi Moss! Fishing at the north pier today.' }).ask;
say('agent', `ask #${friend.id} [friend]: draft "${friend.draft}" default if silent: send it`);
const pay = openAsk(asksDir, { id: 'A3', agent: 'scout', kind: 'money', onTimeout: 'nothing', minutes: 0.06,
  question: 'Pip asks scout to send 10 coins for the boat. May scout send exactly 10 coins to pip?', action: { name: 'send_coins', amount: 10, to: 'pip' } }).ask;
say('agent', `ask #${pay.id} [money]: send_coins 10 to pip? default if silent: nothing`);
answerAsk(asksDir, { id: 'A3', verdict: 'ok' });
say('owner', 'answers #A3: ok');
const fake = ['sk', 'live', 'Q'.repeat(24)].join('_');            // a fake key, built here at run time
answerAsk(asksDir, { id: 'A1', verdict: 'own', text: `ok, use my key ${fake} to pay` });
say('owner', 'answers #A1 with their own words (which happen to contain a key)');
await sleep(4000);
for (const ask of openAsks(asksDir, 'scout')) {
  const r = resolveAsk(asksDir, ask, { gate });
  say('driver', outcomeLine(ask, r));
  if (r.say) say('agent', `says: "${r.say}"`);
  const approved = approvalFrom(ask, r);
  if (approved) act(approved.name, approved.ctx);
  if (r.status !== 'waiting') closeAsk(asksDir, ask, outcomeLine(ask, r));
}

heading('3. pause-with-expiry + handback-memory: a script takes the agent, files a note, lets go');
const race = await hold(agentDir, { minutes: 0.5, by: 'race-script', pollMs: 100, waitSeconds: 10 });
say('race', race.ok ? 'got RELEASED for its own pause: the agent is mine' : `no release: ${race.reason}`);
act('work');
await sleep(500);
fileHandback(events, 'race-script', 'You ran the harbour race in 3:05 and came second.', { pin: true });
say('race', 'filed a handback, then lets go');
race.done();
await sleep(700);

heading('4. a hold that files nothing: the driver writes an honest placeholder');
const quiet = await hold(agentDir, { minutes: 0.5, by: 'test-script', pollMs: 100, waitSeconds: 10 });
await sleep(400);
quiet.done();
await sleep(700);

heading('5. a PAUSE that runs out: the driver takes the agent back on its own');
writeJson(path.join(agentDir, 'PAUSE'), { by: 'owner', at: new Date().toISOString(), until: new Date(Date.now() + 1500).toISOString() });
say('owner', 'touches PAUSE with an end time 1.5 s away, then forgets about it');
await sleep(2500);

heading('6. what the agent knows now, and the owner\'s hard stop');
console.log(promptBlock(recentSelf(events)).split('\n').map((l) => `         ${l}`).join('\n'));
writeJson(path.join(agentDir, 'STOP'), { by: 'owner', at: new Date().toISOString() });
say('owner', 'writes STOP');
act('work');
act('look');
fs.rmSync(path.join(agentDir, 'STOP'));
const rogue = limits.check('rogue_test', { amount: 1e12 });
say('check', rogue.ok ? 'ALERT: the rogue test passed' : `rogue test refused (${rogue.rule}), as it must be`);

driver.stop();
const refusals = fs.readFileSync(path.join(agentDir, 'refusals.jsonl'), 'utf8').trim().split('\n').length;
console.log(`\nFiles: ${refusals} refusals logged, ${fs.readdirSync(path.join(asksDir, 'done')).length} asks closed in asks/done/, ${fs.readFileSync(events, 'utf8').trim().split('\n').length} notes in events.jsonl.`);
if (keep) console.log(`Kept: ${root}`); else fs.rmSync(root, { recursive: true, force: true });
