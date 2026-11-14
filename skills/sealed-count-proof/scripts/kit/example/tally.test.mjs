// Tests for example/tally.compact with kit.mjs. Run from scripts/kit:  npm run compile:example && node --test example/
// Three levels of "refused", as in hall-cage's dice-proof tests:
//   1. refused()        the contract's own code says no. What an honest client sees before it spends anything.
//   2. checker, cheat   the client's JavaScript with every assert taken out builds it anyway; the circuit checker must refuse it.
//   3. checker, changed a changed source, really compiled, builds it; the checker over the REAL circuit must refuse it.
// Level 1 alone proves nothing about a cheat. Levels 2 and 3 are what the chain's verifier enforces.
// BUILD=<folder> runs the tests against another build (the mutant sweep does this). SWEEP=1 skips level 3, which compiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeChecker, cheatBuild, compileChanged, refused, refusedAsync, bytes32, hex, hasBytes, publicPart, privatePart, scan } from '../kit.mjs';
import * as J from './tally-mirror.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const BUILD = process.env.BUILD ?? `${HERE}managed/tally`;
const SOURCE = `${HERE}tally.compact`;
const SWEEP = process.env.SWEEP === '1';
const mod = await import(`${BUILD}/contract/index.js`);
const { pureCircuits: P, Phase } = mod;
const ck = makeChecker(BUILD);

const ANSWER = 300n, SLACK = 60n, ZERO = new Uint8Array(32);
const witnesses = {
  askerKey: ({ privateState }) => [privateState, privateState.sk ?? ZERO],
  handOf: ({ privateState }) => [privateState, privateState.hand ?? { nonce: ZERO, values: [0n, 0n, 0n, 0n, 0n] }],
};
const asker = { sk: bytes32() };
const world = (address) => makeWorld({ build: mod, witnesses, args: [P.keyId(asker.sk), ANSWER, SLACK], ...(address ? { address } : {}) });
const roll = () => Array.from({ length: 5 }, () => BigInt(1 + Math.floor(Math.random() * 6)));
/** A slot's owner: its private state is the hand. */
const owner = (slot, values = roll()) => ({ slot: BigInt(slot), hand: { nonce: bytes32(), values: values.map(BigInt) } });
const sealOf = (w, o) => P.commitOf(o.hand, o.slot, w.self);
const seal = (w, o) => w.call(o, 'seal', o.slot, sealOf(w, o));
const ask = (w, t) => w.call(asker, 'ask', BigInt(t), w.now);
const countOf = (w, o) => P.countOf(o.hand.values, w.state().target);
const prove = (w, o, n = countOf(w, o)) => w.call(o, 'proveCount', o.slot, n);
/** Three slots sealed and the question asked: answering can start. */
async function asked(t = 3, values = [[3, 3, 1, 2, 6], [4, 4, 4, 4, 4], [3, 6, 3, 6, 3]]) {
  const w = await world();
  const os = values.map((v, i) => owner(i, v));
  for (const o of os) seal(w, o);
  ask(w, t);
  return { w, os };
}

// The cheat build (level 2) is made once, here, because a few level-1 tests check level 2 as well.
const cheat = await cheatBuild(BUILD);
const cheatOn = (w, who, circuit, ...a) => w.buildWith(new cheat.Contract(witnesses), who, circuit, ...a);

// ---------- honest ----------

test('honest tally: the chain adds what was proven, and nobody tells it the total', async () => {
  const { w, os } = await asked(3);
  for (const o of os) prove(w, o);
  w.call({}, 'finish');
  assert.equal(w.state().phase, Phase.done);
  assert.equal(w.state().result, 2n + 0n + 3n);
  assert.equal(w.state().result, BigInt(os.reduce((n, o) => n + J.countOf(o.hand.values, 3), 0)));
});

test('finish waits for every slot, or for the window; after the window a silent slot just adds nothing', async () => {
  const { w, os } = await asked(3);
  prove(w, os[0]);
  prove(w, os[2]);
  assert.ok(refused(() => w.build({}, 'finish')), 'one slot can still answer');
  w.wait(SLACK + ANSWER);
  w.call({}, 'finish');
  assert.equal(w.state().result, 5n);
  assert.equal(w.state().answers.member(1n), false);
});

// ---------- level 1: the contract's own code ----------

test('a wrong count is refused, one more and one fewer', async () => {
  const { w, os } = await asked(3);
  const n = countOf(w, os[0]);
  assert.ok(refused(() => w.build(os[0], 'proveCount', os[0].slot, n + 1n), /not this slot's count/));
  assert.ok(refused(() => w.build(os[0], 'proveCount', os[0].slot, n - 1n)));
  prove(w, os[0]);
});

test('another hand is refused, even one with the same values and so the same count', async () => {
  const { w, os } = await asked(3);
  const twin = { slot: os[0].slot, hand: { nonce: bytes32(), values: os[0].hand.values } };
  assert.ok(refused(() => w.build(twin, 'proveCount', twin.slot, countOf(w, twin)), /not the hand sealed/), 'the values match but the seal does not');
});

test('a slot answers once, only after the question, and only inside the window', async () => {
  const w = await world();
  const a = owner(0), b = owner(1);
  seal(w, a); seal(w, b);
  assert.ok(refused(() => w.build(a, 'proveCount', a.slot, 0n)), 'no question yet');
  ask(w, 4);
  prove(w, a);
  assert.ok(refused(() => w.build(a, 'proveCount', a.slot, countOf(w, a))), 'not twice');
  // Level 1 only: even the cheat build throws here, at commits.lookup on a missing key, so there is no transaction to check.
  assert.ok(refused(() => w.build(owner(5), 'proveCount', 5n, 0n), /no seal at this slot/), 'not from a slot nobody sealed');
  w.wait(SLACK + ANSWER);
  assert.ok(refused(() => w.build(b, 'proveCount', b.slot, countOf(w, b))), 'not after the window');
});

test('only the asker asks, once, with a time that is neither in the future nor stale', async () => {
  const w = await world();
  seal(w, owner(0));
  assert.ok(refused(() => w.build({ sk: bytes32() }, 'ask', 3n, w.now), /asker only/), 'another key');
  assert.ok(refused(() => w.build(asker, 'ask', 3n, w.now + 10n), /in the future/), 'a time in the future');
  assert.ok(refused(() => w.build(asker, 'ask', 3n, w.now - SLACK), /stale/), 'a stale time');
  ask(w, 3);
  assert.ok(refused(() => w.build(asker, 'ask', 5n, w.now)), 'twice');
});

test('nothing can be sealed once the question is out, so nobody seals after seeing the target', async () => {
  const w = await world();
  const a = owner(0), late = owner(1);
  seal(w, a);
  const early = w.build(late, 'seal', late.slot, sealOf(w, late)); // built in time
  ask(w, 3);
  assert.ok(refused(() => w.build(late, 'seal', late.slot, sealOf(w, late))));
  assert.equal(w.land(early), false, 'and one built before the question cannot land after it');
});

test('a seal is tied to its slot and to its deployment', async () => {
  const w = await world();
  const a = owner(0, [3, 3, 3, 3, 3]);
  w.call(a, 'seal', 1n, sealOf(w, a)); // slot 0's seal posted at slot 1
  ask(w, 3);
  const moved = { slot: 1n, hand: a.hand };
  assert.ok(refused(() => w.build(moved, 'proveCount', 1n, 5n)), 'the seal names slot 0');
  const other = await world();
  assert.notEqual(other.address, w.address);
  assert.notEqual(hex(P.commitOf(a.hand, 0n, other.self)), hex(sealOf(w, a)), 'the same hand seals differently on another deployment');
});

test('a sealed slot can\'t be sealed again, by anyone, so nobody can overwrite another\'s seal', async () => {
  const w = await world();
  const a = owner(0), stranger = owner(0);
  seal(w, a);
  assert.ok(refused(() => w.build(stranger, 'seal', 0n, sealOf(w, stranger)), /already sealed/));
  assert.ok(refused(() => w.build(a, 'seal', 0n, sealOf(w, a)), /already sealed/), 'not even by its owner');
  await ck.refuses('seal', cheatOn(w, stranger, 'seal', 0n, sealOf(w, stranger)));
});

test('a seal must be something: the zero seal is refused', async () => {
  const w = await world();
  assert.ok(refused(() => w.build(owner(0), 'seal', 0n, ZERO)));
});

// ---------- the same block ----------

test('same block: answers built against the same state all land, in any order', async () => {
  const { w, os } = await asked(3);
  const built = os.map((o) => w.build(o, 'proveCount', o.slot, countOf(w, o)));
  assert.equal(w.land(built[2]), true);
  assert.equal(w.land(built[0]), true);
  assert.equal(w.land(built[1]), true, 'each read only its own slot; the shared totals are counters, which nothing reads when it adds');
  w.call({}, 'finish');
  assert.equal(w.state().result, 5n);
});

test('why Counters: with a plain number for the total, answers in the same block knock each other out', { skip: SWEEP && 'compiles', timeout: 120_000 }, async () => {
  const plain = (await compileChanged(SOURCE, [
    ['export ledger total: Counter;', 'export ledger total: Uint<64>;'],
    ['total.increment(n as Uint<16>);', 'total = (total + n) as Uint<64>;'],
    ['result = total.read();', 'result = total;'],
  ])).module;
  const w = await makeWorld({ build: plain, witnesses, args: [P.keyId(asker.sk), ANSWER, SLACK] });
  const os = [0, 1, 2].map((i) => owner(i, [3, 3, 1, 2, 6]));
  for (const o of os) seal(w, o);
  ask(w, 3);
  const built = os.map((o) => w.build(o, 'proveCount', o.slot, 2n));
  assert.deepEqual(built.map((b) => w.land(b)), [true, false, false], 'each read the total the others changed');
});

test('an answer built in time but landing after the window is refused when it lands', async () => {
  const { w, os } = await asked(3);
  w.wait(SLACK + ANSWER - 1n);
  const slow = w.build(os[0], 'proveCount', os[0].slot, countOf(w, os[0]));
  w.wait(1n);
  assert.equal(w.land(slow), false);
  assert.equal(w.state().answers.member(os[0].slot), false);
});

test('two finishes built at once: one lands, the other is stale', async () => {
  const { w, os } = await asked(3);
  for (const o of os) prove(w, o);
  const f1 = w.build({}, 'finish'), f2 = w.build({}, 'finish');
  assert.equal(w.land(f1), true);
  assert.equal(w.land(f2), false, 'it read the phase, which f1 changed');
});

// ---------- privacy and the plain-JavaScript mirror ----------

test('a hand stays private: its nonce is nowhere public, and the ledger holds only the count', async () => {
  const { w, os } = await asked(3);
  const a = os[0];
  const r = w.build(a, 'proveCount', a.slot, countOf(w, a));
  assert.equal(hasBytes(publicPart(r), a.hand.nonce), false, 'not in what the chain sees');
  assert.equal(hasBytes(privatePart(r), a.hand.nonce), true, 'the same scan finds it in the private part, so the scan works');
  w.land(r);
  const L = w.state();
  assert.equal(hasBytes(scan([...L.commits, ...L.answers]), a.hand.nonce), false);
  assert.equal(L.answers.lookup(a.slot), BigInt(J.countOf(a.hand.values, 3)));
});

test('the scan still finds a secret that ends in zero bytes (the encoding drops them)', async () => {
  const w = await world();
  const a = owner(0);
  a.hand.nonce[31] = 0; a.hand.nonce[30] = 0;
  seal(w, a);
  ask(w, 3);
  const r = w.build(a, 'proveCount', a.slot, countOf(w, a));
  assert.equal(privatePart(r).includes(hex(a.hand.nonce)), false, 'a search for the full hex misses it');
  assert.equal(hasBytes(privatePart(r), a.hand.nonce), true, 'hasBytes finds it');
  assert.equal(hasBytes(publicPart(r), a.hand.nonce), false);
});

test('kit: a misspelt circuit or the wrong circuit fails the test instead of passing as refused', async () => {
  const w = await world();
  const a = owner(0);
  assert.throws(() => refused(() => w.build(a, 'seel', 0n, sealOf(w, a))), /no circuit seel/);
  const ok = w.build(a, 'seal', 0n, sealOf(w, a));
  await assert.rejects(ck.refuses('seel', ok), /no ZKIR/);
  await assert.rejects(ck.refuses('ask', ok), /built with seal, not ask/);
  assert.throws(() => refused(() => w.build({ sk: bytes32() }, 'ask', 3n, w.now), /sealing has closed/), /not for the expected reason/);
});

test('the deployment: windows outside the bounds are refused', async () => {
  const deploy = (answer, slack) => makeWorld({ build: mod, witnesses, args: [P.keyId(asker.sk), answer, slack] });
  assert.ok(await refusedAsync(() => deploy(119n, SLACK), /answer window/));
  assert.ok(await refusedAsync(() => deploy(3601n, SLACK), /answer window/));
  assert.ok(await refusedAsync(() => deploy(ANSWER, 29n), /clock slack/));
  assert.ok(await refusedAsync(() => deploy(ANSWER, 301n), /clock slack/));
  assert.equal(await refusedAsync(() => deploy(120n, 30n)), false);
});

test('plain JavaScript matches the circuits, bit for bit', async () => {
  const w = await world();
  for (let i = 0; i < 200; i++) {
    const o = owner(i % 6, Array.from({ length: 5 }, () => BigInt(Math.floor(Math.random() * 256))));
    const self = bytes32();
    assert.equal(hex(J.commitOf(o.hand, o.slot, self)), hex(P.commitOf(o.hand, o.slot, self)));
    const sk = bytes32();
    assert.equal(hex(J.keyId(sk)), hex(P.keyId(sk)));
    const t = BigInt(i % 7);
    assert.equal(BigInt(J.countOf(o.hand.values, t)), P.countOf(o.hand.values, t));
  }
  const o = owner(2);
  assert.equal(hex(J.commitOf(o.hand, o.slot, w.self)), hex(sealOf(w, o)), 'with the deployment address as kernel.self() gives it');
});

// ---------- level 2: a cheat's own client code, through the circuit checker ----------


test('checker: first, honest transactions pass, through the cheat\'s code too, so the refusals below mean something', async () => {
  const { w, os } = await asked(3);
  await ck.passes('proveCount', cheatOn(w, os[0], 'proveCount', os[0].slot, countOf(w, os[0])));
  await ck.passes('proveCount', w.build(os[0], 'proveCount', os[0].slot, countOf(w, os[0])));
});

test('checker: a wrong count is refused, whatever the client\'s code says', async () => {
  const { w, os } = await asked(3);
  const n = countOf(w, os[1]);
  await ck.refuses('proveCount', cheatOn(w, os[1], 'proveCount', os[1].slot, n + 1n));
  await ck.refuses('proveCount', cheatOn(w, os[1], 'proveCount', os[1].slot, n === 0n ? 1n : n - 1n));
});

test('checker: a hand that is not the sealed one is refused', async () => {
  const { w, os } = await asked(3);
  const other = { hand: { nonce: bytes32(), values: [3n, 3n, 3n, 3n, 3n] } };
  await ck.refuses('proveCount', cheatOn(w, other, 'proveCount', os[1].slot, 5n));
});

test('checker: asking without the asker\'s key, sealing after the question, finishing early: all refused', async () => {
  const w = await world();
  const a = owner(0);
  seal(w, a);
  await ck.refuses('ask', cheatOn(w, { sk: bytes32() }, 'ask', 3n, w.now));
  await ck.passes('ask', cheatOn(w, asker, 'ask', 3n, w.now));
  ask(w, 3);
  await ck.refuses('seal', cheatOn(w, owner(1), 'seal', 1n, bytes32()));
  await ck.refuses('finish', cheatOn(w, {}, 'finish'));
  w.wait(SLACK + ANSWER);
  await ck.refuses('proveCount', cheatOn(w, a, 'proveCount', a.slot, countOf(w, a)));
  await ck.passes('finish', cheatOn(w, {}, 'finish'));
});

test('every circuit took the check on a real path', async () => {
  const w = await world();
  const a = owner(0), b = owner(1);
  const runs = [];
  const run = (who, c, ...x) => { const r = w.call(who, c, ...x); runs.push([c, r]); };
  run(a, 'seal', a.slot, sealOf(w, a));
  run(b, 'seal', b.slot, sealOf(w, b));
  run(asker, 'ask', 3n, w.now);
  run(a, 'proveCount', a.slot, countOf(w, a));
  run(b, 'proveCount', b.slot, countOf(w, b));
  run({}, 'finish');
  for (const [c, r] of runs) await ck.passes(c, r);
  assert.deepEqual([...new Set(runs.map(([c]) => c))].sort(), Object.keys(new mod.Contract(witnesses).impureCircuits).sort(), 'every exported circuit ran');
});

// ---------- level 3: a house running its own circuit ----------
// Each change is compiled for real. What it builds is checked against the real circuit's ZKIR, which is all the chain has.

const CHANGED = {
  'the count ignores the target': ['(v == t ? 1 : 0)', '(v == v ? 1 : 0)'],
  'no seal check': ['assert(disclose(commitOf(h, s, kernel.self().bytes) == commits.lookup(s)), "this is not the hand sealed at this slot");', ''],
  'the total gets one more than the count': ['total.increment(n as Uint<16>);', 'total.increment((n + 1) as Uint<16>);'],
  'finish ignores the window': ['assert(answeredCount.read() == sealedCount.read() || blockTimeGte(answerBy), "slots can still answer");', ''],
};
test('changed circuit, control: a changed build still passes the real checker where it changed nothing', { skip: SWEEP && 'compiles', timeout: 120_000 }, async () => {
  // Without this, a refusal below could mean only that a build from another source can't be checked against this one at all.
  const evil = (await compileChanged(SOURCE, ...CHANGED['the total gets one more than the count'])).module;
  const w = await world();
  const on = (who, c, ...x) => w.buildWith(new evil.Contract(witnesses), who, c, ...x);
  const a = owner(0);
  await ck.passes('seal', on(a, 'seal', a.slot, sealOf(w, a)));
  w.call(a, 'seal', a.slot, sealOf(w, a));
  await ck.passes('ask', on(asker, 'ask', 3n, w.now));
});
for (const [name, [from, to]] of Object.entries(CHANGED)) {
  test(`changed circuit: ${name}`, { skip: SWEEP && 'the sweep runs the other levels against each mutant', timeout: 120_000 }, async () => {
    const evil = (await compileChanged(SOURCE, from, to)).module;
    const { w, os } = await asked(3);
    const on = (who, c, ...x) => w.buildWith(new evil.Contract(witnesses), who, c, ...x);
    const a = os[0];
    if (name === 'the count ignores the target') return ck.refuses('proveCount', on(a, 'proveCount', a.slot, 5n));
    if (name === 'no seal check') return ck.refuses('proveCount', on({ hand: { nonce: bytes32(), values: [3n, 3n, 3n, 3n, 3n] } }, 'proveCount', a.slot, 5n));
    if (name === 'the total gets one more than the count') return ck.refuses('proveCount', on(a, 'proveCount', a.slot, countOf(w, a)));
    if (name === 'finish ignores the window') return ck.refuses('finish', on({}, 'finish'));
  });
}
