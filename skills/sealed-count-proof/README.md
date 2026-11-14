# sealed-count-proof skill

Teaches an AI agent to design, build or review a Midnight (Compact) contract where parties seal private values on chain and later prove a count over them without showing them, and the chain adds the counts itself. The worked example is the public [hall-cage](https://github.com/Beo-Halfhand/hall-cage) dice proof at a pinned commit: sealed dice, a count of a face proven with 1s wild, the verdict computed on chain. A small generic example contract and a test kit come with it.

| File | For |
|---|---|
| `SKILL.md` | The agent: when to use it, the steps, the safety rules, what to report |
| `references/pattern.md` | The pattern piece by piece, with the dice proof's lines and tests |
| `references/tests.md` | Three levels of "refused", privacy scan, mirror, stale builds, mutant sweep; expected numbers |
| `references/kit.md` | Using the kit on your own contract |
| `references/limits.md` | What a count proof does not settle |
| `references/hall-cage.md` | The dice proof's files at the pin, and the words used in them |
| `scripts/kit/` | `kit.mjs` (simulator world, circuit checker, cheat and changed builds), `mutants.mjs` (the sweep), and `example/` (the `tally` contract, 29 tests, 24 mutations) |
| `scripts/run-dice-tests.mjs` | Clones hall-cage at the pin and runs the dice tests, optionally the mutant sweep (no chain, no keys) |

**Needs:** nothing to read the skill. To run anything: Node 22+ and the Compact compiler 0.31.1; for the hall-cage runner also git and pnpm 10. No wallet, no endpoints, no keys.

**Status:** in development. See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
