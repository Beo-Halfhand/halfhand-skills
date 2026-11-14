# The race harness: build now, land later

Front-running and griefing are about **order**: two transactions built against the same state, and the attacker's lands first. A unit test that calls circuits one after another can't show that. hall-cage's tests can, with no chain: they build a transaction against the state of the moment, keep it, let other transactions land, and then replay the kept one against the state as it is now, the way the chain would.

The code is `world()` in [`test/attacks.test.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/attacks.test.mjs#L32-L61) at `e5ce2d1`. Read it there. What follows explains its parts.

## The three verbs

| Verb | Does | Changes the state? |
|---|---|---|
| `build(who, circuit, ...args)` | runs the compiled circuit as `who` (their private state supplies the `secretKey()` witness) against the current state and block time. Returns the result, including the public transcript and its effects. Throws if an `assert` fails, which is the "refused when built" case | no |
| `call(who, circuit, ...args)` | `build`, then adopt its resulting state: built and landed at once | yes |
| `land(built)` | replays `built`'s public transcript and effects against the **current** state with `QueryContext.runTranscript`. Returns `true` if it applied, `false` if the chain would reject it now | yes, if it applied |

Plus `at(t)` to move the block clock, and read helpers (`bal`, `seat`, `state`).

## Writing a race

```text
const victim = w.build(player, 'stand', table, w.now);     // the player's transaction, built now
w.call(judge, 'settleBatch', ..., w.now);                   // the attacker lands first
assert.ok(w.land(victim), 'the stand still lands');         // the chain runs the player's against the new state
```

And the other direction, for a transaction that **must not** land late:

```text
const prepared = depositOf(w, loser, 1n);   // built while not seated
sit(w, loser, 1, ...);                       // then sits and loses
assert.equal(w.land(prepared), false);       // the old deposit can't sneak in
```

Every attack test asserts both halves: the attack failed **and** the honest transaction landed.

## What the replay needs

From the harness at the pin (it imports these from `@midnight-ntwrk/compact-runtime` through the repo's `cage-l8/runtime` shim, runtime 0.16.0 for the 0.31.1 builds):

- `createConstructorContext` and `contract.initialState(...)` for the starting state;
- `createCircuitContext(address, coinPublicKey, state, privateState, ..., blockTimeSeconds)` for the context each `build` runs in, with `currentQueryContext.block.secondsSinceEpoch` set to the test's clock;
- `new QueryContext(currentState, address)` and `qc.runTranscript({ gas, effects, program }, CostModel.initialCostModel())` for `land`, where `program` is the built call's `proofData.publicTranscript` and `effects` its `context.currentQueryContext.effects`. A throw means "rejected".

These signatures are the ones hall-cage uses with compact-runtime 0.16.0. Check them against the runtime version your contract compiles for: they're not promised stable across versions.

## Using the template

[`scripts/harness/`](../scripts/harness/) is the same harness made generic, so you don't need hall-cage's workspace or its `cage-l8/runtime` shim:

```sh
cp -R <this skill>/scripts/harness my-cage-tests && cd my-cage-tests
npm install                      # compact-runtime 0.16.0, for compactc 0.31.1 output
npm run compile:example          # compact compile --skip-zk example/pot.compact example/managed/pot
npm test                         # 4 tests, all pass
```

Checked 13 November 2026 with Node 26 and compactc 0.31.1: 4 of 4 pass, including a withdraw that lands across another player's deposit and one that does not land across the same player's.

For your contract: compile it with `--skip-zk` into a folder, then `makeWorld({ build: '<that folder>', witnesses, args: [<constructor args>] })`. A caller is the private state your witnesses read.

**Compiler and runtime go together.** The generated `contract/index.js` checks the compact-runtime version it was built for and refuses another. compactc 0.31.1 output needs compact-runtime 0.16.0 (hall-cage pins it in `contracts/package.json` for this reason). If you use another compiler, set `@midnight-ntwrk/compact-runtime` in `package.json` to the version your output names when it refuses, and re-check the four example tests: the runtime functions the harness uses may change between versions.

## Limits of the simulator

- **No proofs.** The tests check the circuit's logic and transcript, not that a proof verifies. hall-cage checks the proof side separately with the zkir checker (`test/zkir.test.mjs`), and the live contract on Preprod.
- **No fees, no mempool, no block size.** Whether a transaction fits a block or can be dismissed in time is a separate check (hall-cage's batch width of 4 comes from one: see the comment above `settleBatch`).
- **Gas is set huge** in `land`, so a transaction that would run out of gas on chain still lands here.
- **Your clock.** `at(t)` sets block time for everything after it. The real chain's clock only goes up; keep tests that way, or you're testing something the chain can't do.
