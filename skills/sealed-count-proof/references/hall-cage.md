# The dice proof in hall-cage, at the pinned commit

[hall-cage](https://github.com/Beo-Halfhand/hall-cage) is public under Apache-2.0. This skill was checked against commit **`e5ce2d1`** (12 November 2026). Link to the commit, not `main`: later commits may move lines and rename tests.

| File at `e5ce2d1` | What it is |
|---|---|
| [`contracts/dice-proof.compact`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/dice-proof.compact) | the dice proof, v1: 8 circuits, Compact language 0.23, compiled with compactc 0.31.1. The comment at the top gives the round's order |
| [`test/dice-proof.test.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/dice-proof.test.mjs) | 72 tests: honest rounds, swaps, timeouts, 1s wild, fairness, the mirror, privacy, same block, stale builds, the checker (cheat client and 8 changed circuits) |
| [`scripts/dice-mutants.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/scripts/dice-mutants.mjs) | the mutant sweep: 99 one-line changes |
| [`scripts/dice-fair.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/scripts/dice-fair.mjs) | the hashes and dice in plain JavaScript (`node:crypto` only) |
| [`test/dice-vectors.json`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/dice-vectors.json) | fixed inputs and outputs, so other code (the site's checker) is held to the same bits |
| [`docs/DICE-PROOF.md`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/docs/DICE-PROOF.md) | how it proves it, in plain words; silence; what's still trusted; limits of the deployment |
| [`docs/DICE-PROOF-V2.md`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/docs/DICE-PROOF-V2.md) | the next version, designed and not built: the verdict moves the money, the caller posts the call, the fixes |
| [`README.md`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/README.md) | the live contract address on Preprod and public receipts with a "Check this round" button |

The other files in hall-cage (the cage, the judge, the house service, the deploy and chain scripts) aren't needed for this skill. The runner compiles only the dice proof.

## Words used in the code

| Word | Means |
|---|---|
| cup | one seat's five dice, and the secret seed they come from |
| seal / commit | `commitOf(seed, cup, contract)`: the cup's commitment on chain |
| preseal | `preSealOf(seal, cup)`: the hash of the seal a player will post, named when the round opens |
| house | the operator: opens rounds, posts calls, runs its own seats ("bots"). Its key is fixed at deployment |
| house-run seat | a seat the round says is the house's; it answers first and loses for the house by silence |
| salt | `saltOf(house seed, round, every seal, contract)`: mixed into every cup's dice once the house opens its seed |
| call | the bid being challenged: a count of a face (2 to 6), with a bidder seat and a caller seat |
| prove / show | answer a call with a count only (`proveCount`), or with the dice on chain (`showCup`) |
| verdict | `holds`, `falls` or `voided`, with a reason (`Why`): computed by `finish` from what was proven |
| window | a deadline fixed at deployment: seal, open, call, house's answers, players' answers; plus the clock slack |
| `houseFaults` | rounds voided because the house never opened its seed |
