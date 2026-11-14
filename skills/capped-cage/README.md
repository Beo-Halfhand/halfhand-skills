# capped-cage skill

Teaches an AI agent to design or review a Midnight (Compact) contract that holds other people's funds while an operator key acts on them. The worked example is the public [hall-cage](https://github.com/Beo-Halfhand/hall-cage) cage at a pinned commit: one deposit binds the payout address, settles only reshuffle balances and must balance, the operator acts alone only under a capped and expiring permit, rescue pays only the bound address, and no operator transaction can block a way out. Each invariant comes with the line that enforces it and the attack test that tries to break it.

| File | For |
|---|---|
| `SKILL.md` | The agent: when to use it, the steps, the safety rules, what to report |
| `references/invariants.md` | The six invariants in the code, with line links and tests |
| `references/attacks.md` | Every attack test, and the check that they fail on the old contract |
| `references/race-harness.md` | Testing front-running offline: build now, land later |
| `references/limits.md` | What the cage does not guarantee |
| `references/tests.md` | Running hall-cage's tests offline, expected results |
| `references/hall-cage.md` | The files at the pinned commit, and the words used in them |
| `scripts/run-cage-tests.mjs` | Clones hall-cage at the pin and runs its tests (no chain, no keys) |
| `scripts/harness/` | The race harness for your own contract, with an example contract and four tests |

**Needs:** nothing to read the skill. To run the tests: git, Node 22+, pnpm 10, and the Compact compiler 0.31.1. No wallet, no endpoints, no keys.

**Status:** in development. See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
