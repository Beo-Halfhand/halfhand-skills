# The kit: testing your own contract

[`scripts/kit/`](../scripts/kit/) is self-contained. Copy the folder into your project (or work inside it), then:

```sh
cd kit
npm install                     # compact-runtime 0.16.0 and zkir-v2 2.2.0, for compactc 0.31.1 output
npm run compile:example         # compact compile --skip-zk example/tally.compact example/managed/tally
node --test example/            # 29 tests, under 3 s
npm run sweep:example           # 24 mutants, about 35 s
```

Needs Node 22+ and the Compact compiler 0.31.1 as the default. No network after `npm install`, no keys, no proof server.

## What's in it

| File | What |
|---|---|
| `kit.mjs` | `makeWorld` (a simulated chain for one deployment: `build`, `buildWith`, `call`, `land`, `at`, `wait`, `state`, `self`), `refused`, `refusedAsync`, `makeChecker` (`passes`, `refuses`), `cheatBuild`, `compileChanged`, `publicPart`, `privatePart`, `scan`, `hasBytes` |
| `mutants.mjs` | the sweep: `node mutants.mjs <contract.compact> <mutations.json> <test file> [--only <text>]` |
| `example/tally.compact` | the smallest useful sealed-count contract: seal, ask, proveCount, finish |
| `example/tally-mirror.mjs` | its hashes and count in plain JavaScript |
| `example/tally.test.mjs` | 29 tests across the three levels and the four checks, plus the deployment bounds and the kit's own guards |
| `example/mutations.json` | 24 changes, each of which a test must catch (one marked equivalent, with the reason) |

## Using it on your contract

1. **Compile** with `compact compile --skip-zk <yours>.compact <kit>/managed/<name>`. The build has to be in a folder where Node finds `@midnight-ntwrk/compact-runtime` (under the kit, or a project with it installed). Your `.compact` source can be anywhere: `compileChanged` and `mutants.mjs` write their builds under `<kit>/managed/`. `--skip-zk` skips proving keys; the `.zkir` files the checker needs are still written.
2. **Match the runtime to the compiler.** compactc 0.31.1's output checks for compact-runtime **0.16.0** when imported. Another compiler names another version: install that one.
3. **World and witnesses.** `makeWorld({ build, witnesses, args })`. A caller's private state is whatever your witnesses read: `{ sk }`, `{ hand }`, `{ seed }`. Give each party its own object.
4. **Level 1.** `refused(() => w.build(who, 'circuit', ...args), /the assert's message/)` for each rule. Give the regex: without it, a refusal for another reason (a wrong argument type) passes too. A misspelt circuit name always throws instead of counting as refused. For the constructor's bounds, `await refusedAsync(() => makeWorld({ ..., args: [bad] }), /message/)`.
5. **Level 2.** `const cheat = await cheatBuild(BUILD)`, then `w.buildWith(new cheat.Contract(witnesses), who, 'circuit', ...)` builds almost anything; `await ck.refuses('circuit', built)` with `const ck = makeChecker(BUILD)`. Start with the control: `ck.passes` on an honest transaction built through the cheat's code. `refuses` and `passes` throw (rather than pass) when the circuit has no `.zkir` file or the transaction was built with another circuit. **One gap:** a cheat that needs a map entry that isn't there (`lookup` of a missing key) can't be built, because the runtime throws `expected a cell, received null` with or without asserts. Those rules stay at level 1, unless you build the transcript by hand.
6. **Level 3.** `const evil = (await compileChanged(SOURCE, from, to)).module`, or `compileChanged(SOURCE, [[from, to], ...])` for several changes; either form takes `{ out }` last to choose the folder. Build with it, and `ck.refuses` against the **real** build's checker. Add a control that a changed build passes where it changed nothing.
7. **The four checks.** Copy the privacy scan, the mirror, the stale-build and same-block tests from `tally.test.mjs`, with your secret, your hashes and your shared state. Search for a secret with `hasBytes(text, secret)`, not `text.includes(hex(secret))`: with compact-runtime 0.16.0 a `Bytes<32>` that ends in zero bytes appears in the built proof data without them, so a plain search misses it about 1 time in 256, both in the "the scan works" check and in the leak check itself.
8. **The sweep.** Make the test file read `process.env.BUILD` for its build and skip level 3 when `process.env.SWEEP === '1'` (the sweep compiles each mutant itself). Write `mutations.json`: one entry per rule, `from` copied exactly from the source (it must appear once). Run it; every mutant must be caught, or marked `"equivalent": "<why it can't matter>"`. If a mutant marked equivalent is caught, the run fails, because the reason was wrong.

## Notes

- The cheat build replaces `__compactRuntime.assert(` in the compiled JavaScript. If a future compiler names it differently, `cheatBuild` throws rather than quietly build a cheat that still refuses.
- Scratch folders (`.cheat-*` next to the build, `<kit>/managed/.changed-*` and `.sweep-*`) are per process and removed on exit, so test runs can run side by side.
- `land()` is the chain's view: it replays the public transcript against the state of the moment. A transaction "built in time" that reads something which has since changed doesn't land. That's how the stale-build tests work, and why shared totals are `Counter`s.
- The block clock moves only when you move it (`at`, `wait`). Keep it going up.
- The patterns are hall-cage's (`test/dice-proof.test.mjs` and `scripts/dice-mutants.mjs` at `e5ce2d1`), made generic. The [capped-cage](https://github.com/Beo-Halfhand/halfhand-skills/tree/main/skills/capped-cage) skill's race harness is the same `makeWorld` idea without the checker.
