// harness.mjs: the "build now, land later" race harness for any compiled Compact contract, in the simulator.
// No chain, no proofs, no keys. The pattern is hall-cage's world() (test/attacks.test.mjs at e5ce2d1, Apache-2.0),
// made generic. Read references/race-harness.md first.
//
//   const w = await makeWorld({ build: './managed/pot', witnesses, args: [...constructor args] });
//   const tx = w.build(alice, 'withdraw', 10n);   // built against the state of the moment, not landed
//   w.call(bob, 'deposit', ...);                   // built and landed at once
//   w.land(tx);                                    // true if the chain would still apply it now
//
// A caller ("who") is the private state your witnesses read, e.g. { sk: Uint8Array(32) }.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConstructorContext, createCircuitContext, sampleContractAddress, QueryContext, CostModel } from '@midnight-ntwrk/compact-runtime';

const COIN = '00'.repeat(32); // a coin public key; the simulator doesn't check it
const HUGE_GAS = { readTime: 10n ** 12n, computeTime: 10n ** 12n, bytesWritten: 10n ** 9n, bytesDeleted: 10n ** 9n };

export const bytes32 = () => new Uint8Array(randomBytes(32));

/**
 * @param {object} o
 * @param {string} o.build       folder `compact compile` wrote (it holds contract/index.js), relative to the cwd or absolute
 * @param {object} o.witnesses   your witness functions, as the compiled Contract expects them
 * @param {Array}  [o.args]      constructor arguments, in order
 * @param {object} [o.deployer]  private state for the constructor (default: a random { sk })
 * @param {bigint} [o.time]      starting block time in seconds (default 1_900_000_000n)
 */
export async function makeWorld({ build, witnesses, args = [], deployer = { sk: bytes32() }, time = 1_900_000_000n }) {
  const mod = await import(pathToFileURL(path.resolve(build, 'contract/index.js')).href);
  const contract = new mod.Contract(witnesses);
  const addr = sampleContractAddress();
  const init = contract.initialState(createConstructorContext(deployer, COIN), ...args);
  let now = BigInt(time);
  let ctx = createCircuitContext(addr, COIN, init.currentContractState.data, deployer, undefined, undefined, Number(now));
  const atNow = (block) => ({ ...block, secondsSinceEpoch: now });

  const w = {
    module: mod,
    get now() { return now; },
    /** Move the block clock. Keep it going up: the chain's does. */
    at(t) { now = BigInt(t); return w; },
    /** Run a circuit as `who` against the current state. Throws if an assert fails (refused when built). Changes nothing. */
    build(who, circuit, ...a) {
      const fn = contract.impureCircuits[circuit];
      if (!fn) throw new Error(`no circuit ${circuit}`);
      const cc = { ...ctx, currentPrivateState: who };
      cc.currentQueryContext.block = atNow(cc.currentQueryContext.block);
      return fn(cc, ...a);
    },
    /** Build and land at once. */
    call(who, circuit, ...a) { const r = w.build(who, circuit, ...a); ctx = r.context; return r; },
    /** Replay something built earlier against the state now. true = it applied; false = the chain would reject it. */
    land(built) {
      const qc = new QueryContext(ctx.currentQueryContext.state, addr);
      qc.block = atNow(ctx.currentQueryContext.block);
      try {
        const after = qc.runTranscript({ gas: HUGE_GAS, effects: built.context.currentQueryContext.effects, program: built.proofData.publicTranscript }, CostModel.initialCostModel());
        ctx = { ...ctx, currentQueryContext: after };
        return true;
      } catch { return false; }
    },
    /** The public ledger, as the compiled `ledger()` reads it. */
    state: () => mod.ledger(ctx.currentQueryContext.state),
  };
  return w;
}

/** true if f() throws: a transaction refused when built. */
export const refused = (f) => { try { f(); return false; } catch { return true; } };
