// Race tests for example/pot.compact with harness.mjs. Run from scripts/harness:  node --test example/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, bytes32, refused } from '../harness.mjs';

const BUILD = new URL('./managed/pot', import.meta.url).pathname;
const witnesses = { secretKey: ({ privateState }) => [privateState, privateState.sk] };
const player = () => ({ sk: bytes32(), addr: { bytes: bytes32() } });
const world = () => makeWorld({ build: BUILD, witnesses });

test('I1: the payout address is fixed at the first deposit', async () => {
  const w = await world(); const a = player();
  w.call(a, 'deposit', a.addr, 100n);
  assert.ok(refused(() => w.call(a, 'deposit', { bytes: bytes32() }, 1n)), 'a second deposit naming another address is refused');
  w.call(a, 'deposit', a.addr, 1n);
  assert.equal(w.state().balance.lookup(w.module.pureCircuits.playerId(a.sk)), 101n);
});

test('race: a withdraw built before someone else\'s deposit still lands after it', async () => {
  const w = await world(); const a = player(), b = player();
  w.call(a, 'deposit', a.addr, 100n);
  const out = w.build(a, 'withdraw', 100n);          // built now
  w.call(b, 'deposit', b.addr, 5n);                   // another player lands first
  assert.equal(w.land(out), true, 'it read only its own entries, so it still applies');
});

test('race: a withdraw built before the same player\'s deposit does not land after it (stale read)', async () => {
  const w = await world(); const a = player();
  w.call(a, 'deposit', a.addr, 100n);
  const out = w.build(a, 'withdraw', 100n);
  w.call(a, 'deposit', a.addr, 1n);                   // the balance it read has changed
  assert.equal(w.land(out), false);
});

test('a stranger with no deposit cannot withdraw at all', async () => {
  const w = await world(); const a = player(), s = player();
  w.call(a, 'deposit', a.addr, 100n);
  assert.ok(refused(() => w.build(s, 'withdraw', 1n)));
});
