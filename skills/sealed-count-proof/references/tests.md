# Testing a count proof

A count proof is only as good as the cheats it has been shown to refuse. hall-cage's dice tests and the kit's example both test at three levels, then add four checks around them.

## The three levels of "refused"

| Level | How the bad transaction is made | Who says no | What it proves |
|---|---|---|---|
| 1. The contract's own code | the honest compiled JavaScript, with bad inputs | the JavaScript's own `assert`, before anything is built | An honest client refuses before it spends anything. **Nothing about a cheat**: a cheat edits their client |
| 2. A cheat's client | the compiled JavaScript with every assert made a no-op (`cheatBuild`), so it builds whatever it's asked | the **circuit checker** over the real circuit's ZKIR | The circuit itself enforces the rule, whatever the client's code does |
| 3. A house running its own circuit | a changed `.compact` source, really compiled (`compileChanged`), builds with its own rules | the checker over the **real** circuit's ZKIR | A changed circuit's transcript doesn't satisfy the real circuit, which is all the chain's verifier keys know |

The checker is `check` from `@midnight-ntwrk/zkir-v2` over `proofDataIntoSerializedPreimage(...)` from compact-runtime: it decides whether what was built (inputs, outputs, public transcript, private values) satisfies the circuit, with no proving keys. hall-cage's tests call it the check the proof server runs before proving. A compile with `--skip-zk` writes the `.zkir` files it needs.

**Controls.** A refusal means something only if the honest case passes the same way:
- Level 2 starts with `checker: first, the honest answer passes, through the cheat's code too` ([hall-cage T L987](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/dice-proof.test.mjs#L987)).
- Level 3 in the kit has `changed circuit, control: a changed build still passes the real checker where it changed nothing`. Without it, a refusal could mean only that a build from another source can't be checked against this one at all.
- `every circuit took the check on a real path` ([T L1122](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/dice-proof.test.mjs#L1122)) runs every circuit's honest transactions through the checker.

hall-cage's level-2 and level-3 tests, at [T L987–L1120](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/dice-proof.test.mjs#L987-L1120):

| Cheat | Level |
|---|---|
| a swapped seed | 2 |
| a wrong count, one more and one fewer | 2 |
| dice that aren't the cup's, including with the right seed | 2 |
| a different house seed | 2 |
| sealing a player's cup without their key; the house's work without the house key | 2 |
| finishing early; answering after the window | 2 |
| no wilds in the count · a shut cup counts one more · finish always says the bid holds · the dice ignore the sealed seed · no commitment check · the salt ignores the players · a seat can post any seal · a silent bot voids a call the house would lose | 3 (8 changed circuits) |

## Four checks around them

| Check | How | hall-cage | kit |
|---|---|---|---|
| **Privacy scan** | Serialize the public part of what was built (inputs, outputs, public transcript) and the ledger, and search for the secret's hex. Then search the **private** part and require the secret there, so a scan that finds nothing anywhere fails | `a shut cup: its seed appears nowhere public` ([T L875](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/dice-proof.test.mjs#L875)) | `a hand stays private` |
| **Plain-JavaScript mirror** | The hashes and counting rewritten with `node:crypto` only, compared with the pure circuits on random inputs, bit for bit. Clients and pages can then compute seals without Midnight code, and test vectors stay honest | `plain JavaScript matches the circuits, bit for bit` (T L840), `the vectors the Worker tests against are current` (T L855) | `plain JavaScript matches the circuits, bit for bit` |
| **Stale builds** | Build a transaction, change the state, then land it with `land()`: the chain replays its public transcript against the state of the moment | `a stale build can't land` (T L922), `the same-block case` (T L898) | `same block: ... all land, in any order`, `an answer built in time but landing after the window`, `two finishes built at once`, `why Counters` |
| **Mutant sweep** | Change one rule at a time, recompile, run every test against it; each mutant must make a test fail | `scripts/dice-mutants.mjs`: 99 mutants | `mutants.mjs` + `example/mutations.json`: 24 mutants |

The scan can only look for things that are unlikely to appear by chance: a 32-byte nonce or seed, not a small value like a die. Small values are hidden by the nonce in the seal, not by the scan.

**Trailing zero bytes.** With compact-runtime 0.16.0, a `Bytes<32>` that ends in `0x00` appears in the built proof data without its trailing zeros. A search for the full hex then misses it: about 1 run in 256 for a random secret, which fails the "the scan works" check, and in the public part it could hide a real leak. Search with the kit's `hasBytes(text, secret)`, which drops the trailing zeros from the needle. The kit's test `the scan still finds a secret that ends in zero bytes` pins this. hall-cage's privacy test (T L875) searches the full hex the same way, so it likely has the same 1-in-256 flake; that hasn't been reproduced there.

## Expected results

Checked on Node 26, pnpm 10.32.1, Compact 0.31.1, macOS arm64, on 13 November 2026.

| Run | Result | Time |
|---|---|---|
| `run-dice-tests.mjs <folder>` (fresh clone at `e5ce2d1`) | `tests: 72 passed, 0 failed, 0 skipped, of 72` | install 2 s, compile 13 s, tests 9 s |
| `run-dice-tests.mjs <folder> --mutants` | the above, then `99 mutants · 99 caught · 0 alive · 0 didn't apply` | sweep about 11 min |
| kit: `npm run compile:example && node --test example/` | 29 of 29 | under 3 s after the compile |
| kit: `npm run sweep:example` | `24 mutants · 23 caught · 1 equivalent · 0 alive · 0 didn't apply`, `PASS` | about 35 s |

The one equivalent mutant in the kit is `answer before the question`: `answerBy` is 0 until the question is asked, so the window check already refuses an early answer. The first run of the sweep also found a real hole: no test checked that a sealed slot can't be sealed again, which would let anyone overwrite another's seal. The test `a sealed slot can't be sealed again, by anyone` was added, and the sweep now catches it. That is what the sweep is for.

## When something fails

| Message | Cause | Fix |
|---|---|---|
| `the default Compact compiler is X; the pinned build needs 0.31.1` | another compiler is the default | `compact update 0.31.1` (or install it and set it as default) |
| `pnpm X: the lockfile at the pin is pnpm 10's` | pnpm 9 or 11 | `corepack use pnpm@10` |
| `Cannot find package '@midnight-ntwrk/compact-runtime'` from a `contract/index.js` | the build is in a folder where Node can't find the runtime | compile into a folder under the kit (or your project) that has `node_modules` with compact-runtime 0.16.0. `compileChanged` and `mutants.mjs` already build under `<kit>/managed/`, wherever the source is |
| `checkRuntimeVersion` error on import | compiler and runtime don't match | compactc 0.31.1 output checks for compact-runtime 0.16.0; another compiler needs the version its output names |
| `the change no longer applies` | the source changed under a mutation or changed-circuit test | update the `from` text; the sweep reports these as "didn't apply" |
| `the tests fail against the unchanged contract` (sweep) | the baseline is red | fix the tests first; a caught mutant means nothing otherwise |
| `the checker accepted this <circuit>` | a level-2 or level-3 test found the circuit doesn't enforce the rule | the rule is only in the client, or the test is wrong: read the circuit |
| `CompactError: expected a cell, received null` from a cheat build | the cheat needs a map entry that doesn't exist; the runtime's `lookup` throws with or without asserts | that rule can't reach level 2 with the kit: keep it at level 1 and say so |
| the privacy test's "the scan works" check fails about 1 run in 256 | the secret ended in a zero byte, which the encoding drops | search with `hasBytes`, not `includes(hex(...))` |
| `no ZKIR for circuit` / `built with X, not Y` / `no circuit X` | a typo, or a transaction checked against the wrong circuit | fix the test: these never count as a refusal |
| `refused, but not for the expected reason` | the regex given to `refused` didn't match the error | the call failed for another reason (often a wrong argument); fix the call or the regex |
