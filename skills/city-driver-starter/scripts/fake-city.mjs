#!/usr/bin/env node
// fake-city.mjs: a stand-in for the City's mcity-control.mjs, for testing a driver with no account and
// no network. Same command names, same JSON shapes for the fields a starter driver reads, and the same
// error lines on stderr (exit 1). The world is a JSON file you can edit between ticks.
//
//   FAKE_CITY_STATE=world.json node fake-city.mjs <command> [args]
//   FAKE_CITY_CALLS=calls.log  (optional) appends every command line, so a test can see what was sent
//
// It is not the City: no movement, no time, no other agents. Use it to test your loop's decisions,
// then run --dry-run against your real agent before letting it act.
import fs from 'node:fs';

const file = process.env.FAKE_CITY_STATE;   // give a full path: the driver runs this from another folder
if (!file) { process.stderr.write('set FAKE_CITY_STATE to a world JSON file\n'); process.exit(1); }
const w = JSON.parse(fs.readFileSync(file, 'utf8'));
const [cmd, ...args] = process.argv.slice(2);
if (process.env.FAKE_CITY_CALLS) fs.appendFileSync(process.env.FAKE_CITY_CALLS, [cmd, ...args].join(' ') + '\n');
const out = (v) => { fs.writeFileSync(file, JSON.stringify(w, null, 2)); process.stdout.write(JSON.stringify(v, null, 2) + '\n'); };
const fail = (m) => { fs.writeFileSync(file, JSON.stringify(w, null, 2)); process.stderr.write(m + '\n'); process.exit(1); };
const items = (w.items ||= {});
const food = () => (w.merchants || []).filter((m) => m.source === 'outlet').map((m) => m.offer.paysItemId);
const heavy = () => Object.entries(items).filter(([id, n]) => id !== 'crystal' && n > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
const carried = () => Object.entries(items).filter(([id]) => id !== 'crystal').reduce((n, [, q]) => n + q, 0);
const agentFor = (id) => {
  if (id && id !== w.agent.id) fail(`agent ${id} not found (404)`);
  if (!id && !w.connected) fail('not connected; run connect <agentId> first');
};
const act = (fn) => {
  if (!w.connected) fail('not connected; run connect <agentId> first');
  if (w.expireOn === cmd) { delete w.expireOn; w.leaseExpired = true; }   // a test can expire the lease on one command
  if (w.leaseExpired) fail('direct-control lease expired; run connect <agentId> again');
  const forced = w.next?.[cmd];                      // a test can force the next outcome: "pending" or "failed:<reason>"
  if (forced) {
    delete w.next[cmd]; const [status, reason] = forced.split(':');
    if (status === 'pending') { w.agent.activeAction = { kind: cmd }; w.agent.activeActionReads = w.pendingReads ?? 1; }   // still going for N context reads
    return out({ submitted: true, outcome: { status, ...(reason ? { reason } : {}) } });
  }
  const reason = fn();
  out({ submitted: true, outcome: reason ? { status: 'failed', reason } : { status: 'confirmed' } });
};

switch (cmd) {
  case 'connect': {
    if (args[0] && args[0] !== w.agent.id) fail('agent is not claimable');
    w.connects = (w.connects || 0) + 1;
    if (w.refuseConnectAfter != null && w.connects > w.refuseConnectAfter) fail('control session changed');   // another controller holds it
    w.connected = true; w.leaseExpired = false;
    const skillUpdate = w.skillUpdate; delete w.skillUpdate;                                                   // a test can fake a self-update
    out({ connected: true, agentId: w.agent.id, ...(skillUpdate ? { skillUpdate } : {}) }); break;
  }
  case 'disconnect': if (!w.connected) fail('not connected; run connect <agentId> first'); if (w.failDisconnect) fail('Error: disconnect refused'); w.connected = false; out({ disconnected: true, released: true }); break;
  case 'context': {
    agentFor(args[0]);
    const agent = { id: w.agent.id, profession: w.agent.profession ?? null, isPerformingJob: !!w.agent.isPerformingJob, activeAction: w.agent.activeAction ?? null, activeModule: w.agent.activeModule ?? null, position: { spaceId: 'plaza' } };
    if (w.agent.activeActionReads != null && --w.agent.activeActionReads <= 0) { w.agent.activeAction = null; delete w.agent.activeActionReads; }
    out({ agent }); break;
  }
  case 'needs': agentFor(args[0]); out({ hunger: w.hunger || { state: 'normal', value: 0 } }); break;
  case 'inventory': agentFor(args[0]); out({ items, load: { state: carried() >= (w.loadAt ?? 999) ? 'loaded' : 'normal', heaviestItem: heavy(), workSpeedPercent: carried() >= (w.loadAt ?? 999) ? 80 : 100 } }); break;
  case 'progression': agentFor(args[0]); out({ capabilities: { sources: w.sources || [] } }); break;
  case 'merchants': out({ merchants: (w.merchants || []).map((m) => ({ ...m, trade: { merchantName: m.name, itemId: m.offer.acceptsItemId, quantity: m.offer.acceptsQuantity } })) }); break;
  case 'eat': act(() => {
    const f = food().find((id) => items[id] > 0);
    if (!f) return 'no_food';
    items[f] -= 1; w.hunger = { state: 'normal', value: 0 };
  }); break;
  case 'trade': act(() => {
    const [name, itemId, qtyS] = args, qty = Number(qtyS);
    const m = (w.merchants || []).find((x) => x.name === name);
    if (!m || m.offer.acceptsItemId !== itemId) return 'no_such_offer';
    if (!(qty > 0) || qty % m.offer.acceptsQuantity) return 'invalid_quantity';
    if ((items[itemId] || 0) < qty) return 'not_enough_items';
    items[itemId] -= qty; items[m.offer.paysItemId] = (items[m.offer.paysItemId] || 0) + (qty / m.offer.acceptsQuantity) * m.offer.paysQuantity;
  }); break;
  case 'gather': act(() => {
    const s = (w.sources || []).find((x) => x.sourceId === args[0]);
    if (!s) return 'unknown_source';
    if (s.failureReason) return s.failureReason;
    items[s.yields] = (items[s.yields] || 0) + 1;
  }); break;
  case 'work': act(() => { if (!w.agent.profession) return 'no_profession'; w.agent.isPerformingJob = true; }); break;
  case 'stop-work': act(() => { w.agent.isPerformingJob = false; }); break;
  default: fail(`fake-city: "${cmd}" is not faked (the real helper has many more commands)`);
}
