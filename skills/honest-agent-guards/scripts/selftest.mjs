#!/usr/bin/env node
// selftest.mjs: every guard rule, with no network and no model (the redraft is a stand-in function).
//   node selftest.mjs        expect "selftest: N ok, 0 failed"
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseList, loadList, claimWhy, placeWhy, placeCandidates, stateWhy, actionWhy, checkLine, tell, dropBad, guard, scan, sentencesOf, EXAMPLE_LIST } from './guards.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let ok = 0, failed = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : `  (${extra})`}`); };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const TEMPS = []; const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hag-')); TEMPS.push(d); return d; };
const L = loadList(EXAMPLE_LIST);

// ── the list ──
{
  check('the example list parses with no errors', L.errors.length === 0 && L.claims.length === 5 && L.places.length === 2 && L.map.length > 100, L.tag + ' ' + L.errors.join('; '));
  const p = parseList(['## Claims', '- [B01] any: `drift` — tell: no drift', '- [B02] all: `a` + `(` — tell: x', '- [B03] off any: `queue` — tell: q', '- [B04] some other line', '- [B01] any: `again` — tell: dup',
    '## Places not on the map', '- [P01] Glow Market — say: the market', '## Map', '- Areas: Central Plaza, Bison Valley'].join('\n'));
  check('list: a bad regex and a broken line are reported, not fatal', p.errors.some((e) => e.startsWith('B02: bad regex')) && p.errors.some((e) => e.startsWith('unparsed claim line')));
  check('list: off keeps a line switched off; an ID used twice keeps the first', p.claims.find((c) => c.id === 'B03').on === false && p.claims.filter((c) => c.id === 'B01').length === 1 && p.errors.some((e) => e.includes('used twice')));
  check('list: places and the map', p.places[0].key === 'glow market' && p.map.join() === 'Central Plaza,Bison Valley');
  const d = tmp(), f = path.join(d, 'list.md');
  fs.writeFileSync(f, '## Claims\n- [B01] any: `\\bwidgets?\\b` — tell: no widgets\n');
  check('list: your list is used, and re-read when it changes', claimWhy('I sell widgets.', { list: loadList(f) }) === 'banned:B01');
  fs.writeFileSync(f, '## Claims\n- [B01] any: `\\bgizmos?\\b` — tell: no gizmos\n'); const later = new Date(Date.now() + 5000); fs.utimesSync(f, later, later);
  check('list: an edit takes effect with no restart', claimWhy('I sell widgets.', { list: loadList(f) }) === null && claimWhy('I sell gizmos.', { list: loadList(f) }) === 'banned:B01');
  const miss = loadList(path.join(d, 'nope.md'));
  check('list: a missing list falls back to the example and says so', miss.source === 'example (your list: not found)' && miss.claims.length === 5);
  fs.writeFileSync(f, '# nothing here\n'); fs.utimesSync(f, new Date(Date.now() + 9000), new Date(Date.now() + 9000));
  check('list: a list with no claims falls back too', loadList(f).source === 'example (your list: no claims in it)');
}

// ── listed claims ──
{
  eq('B01: a percentage on price drift is refused', claimWhy('Merchant prices drift about 15% in a few minutes, Wren.', { list: L }), 'banned:B01');
  eq('B01: a percentage alone is fine', claimWhy('I finished 80% of the block.', { list: L }), null);
  eq('B02: "rates move" is refused', claimWhy('Sell your ore before the rates drift.', { list: L }), 'banned:B02');
  eq('B02 unless: a denial passes, the same words without it do not', [claimWhy('Meme coin prices never drift, it is the same rate every sale.', { list: L }), claimWhy('Meme coin prices drift all day.', { list: L })], [null, 'banned:B02']);
  eq('B03: "waiting on my own turn" is refused', claimWhy('Still waiting on my own turn, Pip.', { list: L }), 'banned:B03');
  eq('B04: inventing a queue is refused', claimWhy('The queues can get long when everyone wants a quick trade.', { list: L }), 'banned:B04');
  eq('B04 echo: answering their own question about queues is fine', claimWhy('The queues can get long at noon.', { list: L, them: 'is there a queue at the forge?' }), null);
  const STOCK = ["I see, Moth. I rotate trades; today I am spreading it evenly. Hacking at the terminals is steady work.", "I've been rotating trades today and hacking a bit too.",
    "I've been rotating my trades to keep things steady.", 'Rotating evenly between trades today.', 'I ROTATE TRADES most days.', 'I rotate between my trades.'];
  eq('S01: every logged stock-line variant is caught', STOCK.map((l) => claimWhy(l, { list: L })), STOCK.map(() => 'banned:S01'));
  const CLEAN = ['I trade ore at the merchants in Central.', "I've been fishing at the canal most of today.", 'Trades in Central are quiet tonight.', 'I switch between fishing and mining.', 'Rotation at the forge is slow tonight.'];
  eq('S01: ordinary lines pass', CLEAN.map((l) => claimWhy(l, { list: L })), CLEAN.map(() => null));
  eq('a switched-off claim never fires', claimWhy('the widget', { list: parseList('## Claims\n- [B09] off any: `widget` — tell: x') }), null);
}

// ── places ──
{
  eq('a place not on the map is refused', placeWhy('Head to the Glow Market for cheap ore.', { list: L }), 'banned:place:Glow Market');
  eq('a listed place is refused with its own ID', placeWhy('I keep my coins at the Central Bank.', { list: L }), 'banned:P01');
  eq('a listed place switched off is allowed', placeWhy('I smelt at the Central Forge.', { list: L }), null);
  eq('a real place passes, and so does a run of words from inside one', [placeWhy('The Central Crypto Merchant pays well.', { list: L }), placeWhy('Try the Crypto Merchant.', { list: L })], [null, null]);
  eq('a place they named first passes', placeWhy('The Glow Market? Never been.', { list: L, them: 'have you seen the Glow Market?' }), null);
  eq('filler words before a place are dropped ("Visit the …")', placeCandidates('Visit the Glow Market today.'), ['Glow Market']);
  eq('lead words come from the map, so "Central Moonfield" (no place word) is checked', placeWhy('Meet me at Central Moonfield.', { list: L }), 'banned:place:Central Moonfield');
  eq('a name being addressed is not a place ("…, Crypto Prophets.", "Hey Hacker T,")', [placeWhy('Farming is steady work, Crypto Prophets.', { list: L }), placeWhy('Hey Hacker Tom, good to see you.', { list: L }), placeWhy('Try the Glow Market, it is cheap.', { list: L })], [null, null, 'banned:place:Glow Market']);
  eq('no map: only the listed places are checked', placeWhy('Head to the Glow Market.', { list: parseList('## Claims\n- [B01] any: `x` — tell: x') }), null);
}

// ── the agent's own state: levels and gear ──
{
  const me = { levels: { mining: 12, fishing: 4 }, inv: { iron_pickaxe: 1, wood_log: 40 } };
  eq('level: his real level passes', stateWhy("I'm level 12 at mining.", me), null);
  eq('level: a wrong level for a named skill is refused', stateWhy('My mining is level 30.', me), 'state:level:mining 30');
  eq('level: "mining" is not "min." (a requirement word)', stateWhy('I do mining at level 30.', me), 'state:level:mining 30');
  eq('first person: "My …" at the start of a sentence counts', [stateWhy('My fishing is level 9.', me), stateWhy('My mining is level 12.', me)], ['state:level:fishing 9', null]);
  eq('level: "fishing 9" in a first-person clause is refused', stateWhy("I'm on fishing 9 these days.", me), 'state:level:fishing 9');
  eq('level: a target is never his to give', stateWhy("I'm working up to level 20 in mining.", me), 'state:goal-level:mining 20');
  eq('level: what a spot needs is not his level', stateWhy('The deep vein needs level 25 mining.', me), null);
  eq('level: a bound is not his level ("under level 5")', stateWhy("I'd say it's for players under level 5.", me), null);
  eq('level: about them, not him', stateWhy("You're level 30 already?", me), null);
  eq('level: number words, compound too ("level twenty-two" is 22, not 20)', [stateWhy("I'm level twenty-two.", { levels: { mining: 22 } }), stateWhy("I'm level twenty-two.", { levels: { mining: 20 } }), stateWhy("I'm level nine at mining.", { levels: { mining: 9 } })], [null, 'state:level:22', null]);
  eq('level: no levels known → any level for himself is refused', stateWhy("I'm level 3.", { levels: {} }), 'state:level:3');
  eq('gear: a pickaxe he carries passes', stateWhy('I use my iron pickaxe for that.', me), null);
  eq('gear: a rod he does not carry is refused', stateWhy('I carry a fishing rod just in case.', me), 'state:item:fishing rod');
  eq('gear: "I still need an axe" when he has none passes', stateWhy('I still need an axe.', me), null);
  eq('gear: "I still need a pickaxe" when he has one is refused', stateWhy('I still need a pickaxe.', me), 'state:owned:pickaxe');
  eq('gear: wanting to craft one is not a claim', stateWhy("I'd like to craft my own axe someday.", me), null);
  const items = [{ id: 'cinder_axe', name: 'Cinder Axe', cat: 'tool' }, { id: 'wood_log', name: 'Wood Log', cat: 'raw_resource' }];
  eq('catalog: a count of what he carries must be his real count', [stateWhy('I have 40 wood logs.', { ...me, items }), stateWhy('I have 90 wood logs.', { ...me, items })], [null, 'state:count:wood log 90']);
  eq('catalog: a named tool he lacks is refused', stateWhy('My cinder axe is sharp.', { ...me, items }), 'state:item:cinder axe');
  eq('inventory as a list of { item, qty } works too', stateWhy('I use my iron pickaxe.', { inv: [{ item: 'iron_pickaxe', qty: 1 }] }), null);
}

// ── the agent's own state: what it does (the 29 cases from the crew samples, 11-18) ──
{
  const R = { specialty: 'woodcutting', inv: { cinder_axe: 1, meme_coin: 12, matcha_smoothie: 2, wood_log: 40 }, trades: ['meme coins', 'coins', 'matcha', 'smoothie', 'food'] };
  const D = { specialty: 'farming', inv: [{ item: 'farming_kit', qty: 1 }], trades: ['meme coins'] };
  const T = [
    ["You can't craft a pickaxe, but you can craft tools for gathering. I craft cinder axes at the tree stands.", R, 'invented:craft:craft'],
    ["Mining's a tough job, especially with the weather we've been having lately.", R, 'invented:world:weather'],
    ["You catch a lot of fish at the canal eddy, don't you? I've been there too, and it's a good spot for training your fishing skills.", R, null],
    ['I cut wood at the tree stands.', R, null], ["I'm one of the test crew, an agent playing the City.", R, null],
    ['Meme coins sell for 4 crystal each at the Central Crypto Merchant.', R, null],
    ['I usually make planks before I sell them.', R, 'invented:craft:make'], ["I've built a small workshop near the plaza.", R, 'invented:craft:built'],
    ['I sell my wood to the merchants.', R, 'invented:trade:sell'], ['I sell my meme coins at the Central Crypto Merchant.', R, null], ['I bought a matcha smoothie on the way.', R, null],
    ['I keep my axe sharp.', R, null], ['My axe has seen better days.', R, null], ['I use an iron pickaxe for that.', R, 'invented:own:pickaxe'], ['My shop is open late.', R, 'invented:own:shop'],
    ['I carry a fishing rod just in case.', R, 'invented:own:rod'], ['I have a farming kit in my bag.', D, null], ['I have a farming kit in my bag.', R, 'invented:own:kit'],
    ['I fish the canal most mornings.', R, 'invented:skill:fishing'], ["I've been mining ore all week.", R, 'invented:skill:mining'], ['I farm the citrus arbor.', D, null],
    ['I chop wood all day.', D, 'invented:skill:woodcutting'], ['I chop wood all day.', R, null],
    ['Do you craft your own tools?', R, null], ['You can build one at a forge.', R, null], ['What do you sell?', R, null],
    ['That sounds like steady work. What do you make with it?', R, null], ['Fishing at the canal can be a good way to get some decent fish.', R, null], ["It's a lot to take in. What brings you to the City?", R, null],
  ];
  const bad = T.filter(([t, c, w]) => actionWhy(t, c) !== w).map(([t, c, w]) => `${t.slice(0, 40)} → ${actionWhy(t, c)} (want ${w})`);
  check(`action: the ${T.length} crew-sample cases`, bad.length === 0, bad.join(' | '));
  eq('action: a craft it really does passes', actionWhy('I make planks at the bench.', { specialty: 'woodcutting', crafts: ['planks'] }), null);
  eq('action: "my crew" only when it is allowed', [actionWhy('My crew works the north side.', R), actionWhy('My crew works the north side.', { ...R, ownOk: ['crew'] })], ['invented:own:crew', null]);
  eq('action: weather allowed when the world has it', actionWhy("It's raining again.", { ...R, world: true }), null);
  eq('action: allowed trades match whole words ("Kingofcoins" is not "coins")', actionWhy('I rotate trades, Kingofcoins.', { specialty: 'woodcutting', trades: ['coins'] }), 'invented:trade:trades');
  eq('action: no trades listed → any trade claim is refused', actionWhy('I sell my meme coins.', { specialty: 'woodcutting' }), 'invented:trade:sell');
}

// ── all checks, the tells, the loop ──
{
  const self = { specialty: 'woodcutting', levels: { woodcutting: 9 }, inv: { cinder_axe: 1 }, trades: ['meme coins'] };
  const ctx = { list: L, self };
  eq('checkLine: the list first, then places, then state, then actions', [checkLine('Prices drift 15% in minutes.', ctx), checkLine('Try the Glow Market.', ctx), checkLine("I'm level 30 at woodcutting.", ctx), checkLine('I fish all day.', ctx), checkLine('I cut wood at the tree stand.', ctx)],
    ['banned:B01', 'banned:place:Glow Market', 'state:level:woodcutting 30', 'invented:skill:fishing', null]);
  eq('checkLine: no self → only the list is checked', checkLine('I fish all day.', { list: L }), null);
  const tells = ['banned:B01', 'banned:P01', 'banned:place:Glow Market', 'state:level:woodcutting 30', 'state:goal-level:mining 20', 'state:item:fishing rod', 'invented:craft:craft', 'invented:trade:sell', 'invented:skill:fishing', 'invented:world:weather'].map((w) => tell(w, ctx));
  check('tell: every reason gets plain words, and none quotes a line to copy', tells.every((t) => t.length > 20 && !/["“][A-Z][^"”]{20,}["”]/.test(t)), tells.join(' | '));
  check('tell: a level tell gives his real levels', /woodcutting 9/.test(tells[3]) && /you only trade meme coins/.test(tells[7]) && /yours is woodcutting/.test(tells[8]));
  eq('dropBad: keeps the true sentences', dropBad('Prices drift 15% in minutes. The Central Crypto Merchant pays the same every time.', (s) => checkLine(s, ctx)), 'The Central Crypto Merchant pays the same every time.');
  eq('dropBad: too little left → null (skip, never a fragment)', dropBad('Prices drift 15%. Hi.', (s) => checkLine(s, ctx)), null);
  const seen = [];
  const good = async (reason, line) => { seen.push(reason); return 'The Central Crypto Merchant pays the same 4 crystal every time.'; };
  const stillBad = async () => 'Prices still drift 20% every hour.';
  const throws = async () => { throw new Error('model down'); };
  const r0 = await guard('I cut wood at the tree stand every day.', ctx, { redraft: good });
  check('guard: a clean line is sent as it is, with no model call', r0.how === 'clean' && seen.length === 0);
  const r1 = await guard('Prices drift 15% in minutes.', ctx, { redraft: good });
  check('guard: a refused line gets one redraft, told why', r1.how === 'redrafted' && r1.line.startsWith('The Central Crypto') && seen.length === 1 && /percentage/.test(seen[0]));
  const r2 = await guard('Prices drift 15% in minutes. I cut wood at the tree stand most days.', ctx, { redraft: stillBad });
  check('guard: a still-bad redraft → the bad sentence is dropped', r2.how === 'trimmed' && r2.line === 'I cut wood at the tree stand most days.');
  const r3 = await guard('Prices drift 15% in minutes.', ctx, { redraft: stillBad });
  check('guard: nothing true left → skip', r3.skip === true && r3.why === 'banned:B01');
  const r4 = await guard('Prices drift 15% in minutes. I cut wood at the tree stand most days.', ctx, { redraft: throws });
  check('guard: a model that fails counts as no redraft', r4.how === 'trimmed');
  const r5 = await guard('Prices drift 15% in minutes.', ctx, { redraft: async () => 'I fish at the canal now.' });
  check('guard: a redraft that breaks another check is not accepted', r5.skip === true);
  const r6 = await guard('Hello there, I cut wood at the tree stand.', ctx, { extra: (l) => (/hello/i.test(l) ? 'mine:greeting' : null) });
  check('guard: your own extra check is part of the loop', r6.skip === true && r6.why === 'mine:greeting');
  const hits = scan(['Prices drift 15%. Try the Glow Market.', 'I cut wood.', { text: 'The queues get long.', them: 'is there a queue?' }], ctx);
  check('scan: every hit per line, and "them" from a JSON line', hits.length === 1 && hits[0].hits.join() === 'banned:B01,banned:place:Glow Market');
  eq('sentences: "Dr." does not end a sentence', sentencesOf('Ask Dr. Vex. She knows.').length, 2);
}

// ── the command line ──
{
  const run = (a, env = {}) => new Promise((res) => execFile(process.execPath, [path.join(HERE, 'guards.mjs'), ...a], { env: { ...process.env, ...env } }, (e, so, se) => res({ code: e ? e.code : 0, out: so + se })));
  const d = tmp(), sf = path.join(d, 'state.json'), lf = path.join(d, 'sent.jsonl');
  fs.writeFileSync(sf, JSON.stringify({ specialty: 'woodcutting', levels: { woodcutting: 9 }, inv: { cinder_axe: 1 } }));
  fs.writeFileSync(lf, [JSON.stringify({ text: 'Prices drift 15% in minutes.' }), 'I cut wood at the tree stand.', 'I fish all day.'].join('\n'));
  const a = await run(['check', 'Prices drift 15% in minutes.']), b = await run(['check', 'I cut wood.']), c = await run(['check', 'I fish all day.', '--state', sf]);
  check('cli check: refused → exit 1 with the reason and the tell; ok → exit 0', a.code === 1 && /refused: banned:B01/.test(a.out) && /tell: /.test(a.out) && b.code === 0 && b.out.trim() === 'ok' && c.code === 1 && /invented:skill:fishing/.test(c.out), a.out + b.out + c.out);
  const s = await run(['scan', lf, '--state', sf]);
  check('cli scan: counts per reason', s.code === 0 && /scan: 2 of 3 line\(s\) refused · banned:B01 1, invented:skill 1/.test(s.out), s.out);
  const l = await run(['list']);
  check('cli list: shows the list and its tag', l.code === 0 && /list: example · 5 claims/.test(l.out) && /– P02: Central Forge/.test(l.out));
  const bad = path.join(d, 'bad.md'); fs.writeFileSync(bad, '## Claims\n- [B01] any: `(` — tell: x\n- [B02] any: `ok` — tell: y\n');
  const lb = await run(['list', '--list', bad]);
  check('cli list: a broken line in your list → exit 1, named', lb.code === 1 && /✗ B01: bad regex/.test(lb.out), lb.out);
  const e = await run(['check', 'x', '--state', path.join(d, 'none.json')]);
  check('cli: a missing state file says so (exit 2)', e.code === 2 && /not found/.test(e.out));
  const g = await run(['check', 'I sell widgets.'], { GUARDS_LIST: bad });
  check('cli: GUARDS_LIST picks the list', g.code === 0);
}

for (const d of TEMPS) fs.rmSync(d, { recursive: true, force: true });
console.log(`\nselftest: ${ok} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
