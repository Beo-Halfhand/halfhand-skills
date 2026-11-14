---
name: capped-cage
description: Design or review a Midnight (Compact) contract that holds other people's funds while an operator key acts on them, using the public hall-cage "cage" as the worked example. Covers the invariants (one deposit binds the payout address, settles only move balances inside the contract and must balance, a capped and expiring permit is the only way the operator acts without the player's wallet, rescue pays only the bound address, ways out that no operator transaction can block) and the attack tests that prove them, including the "build now, land later" race harness and the check that the tests fail on the old contract. Use it when a contract has a judge, house, operator, escrow agent or relayer key next to user balances, or when someone asks how to test a Compact contract against front-running or griefing. Offline only: no chain, no wallet, no keys.
---

# capped-cage

**What it is.** A *cage* is a contract that holds players' money while a trusted-but-limited operator (here, a **judge** key) moves it between them. The hard part isn't the happy path. It is making sure the operator, a stolen operator key, a losing player or a stranger can't take money out, hold it in, or block someone's way out. Each of those turns into an invariant you can state and a test that tries to break it.

The worked example is [hall-cage](https://github.com/Beo-Halfhand/hall-cage) (Apache-2.0): `contracts/sealed-cage.compact` (v4b, 11 circuits) and its tests, read at the pinned commit **`e5ce2d1`**. This skill explains it. It doesn't copy it: link to the commit, and read the code there.

| You get | Where |
|---|---|
| The invariants, each with the line that enforces it and the test that proves it | [references/invariants.md](references/invariants.md) |
| Every attack test, what it tries and why it fails on the current contract | [references/attacks.md](references/attacks.md) |
| The race harness: build a transaction now, land it after the attacker's | [references/race-harness.md](references/race-harness.md) |
| What the cage does **not** guarantee (pinned as `KNOWN` tests) | [references/limits.md](references/limits.md) |
| A race harness for **your** contract, with a tested example | [`scripts/harness/`](scripts/harness/) |
| Running hall-cage's own tests offline, and what passing looks like | [references/tests.md](references/tests.md), [`scripts/run-cage-tests.mjs`](scripts/run-cage-tests.mjs) |
| A map of the hall-cage files at the pin | [references/hall-cage.md](references/hall-cage.md) |

**Not covered:** deploying, wallets and fees (see the [dust-wallet](../dust-wallet/) skill), the dice proof in the same repo, the off-chain judge service, mainnet. The cage is a **Preprod prototype on test NIGHT, not audited**. Treat it as a pattern to reason with, not code to deploy with real funds.

## When to use

- You're writing or reviewing a Compact contract where users deposit and some other key (judge, house, operator, escrow agent, relayer, bot) can change who holds what.
- You need to answer "what is the most the operator can take?", "can anyone stop me withdrawing?", "what happens if I lose my key?" or "what if the operator key is stolen?"
- You want tests that show a front-running or griefing attack fails, not just that the honest path works.

## Steps

### 1. Draw the money paths

List every circuit that moves the native token (in hall-cage: `deposit` in, `withdraw` and `rescue` out) and every circuit that changes a balance without moving tokens (`settleBatch`). For each, write who may call it and where the money can go. A cage's first invariant is that this list is short: in hall-cage **a settle moves no NIGHT**, and only three circuits do.

### 2. Check the six invariants against your contract

For each, ask the question. If your contract can't answer it the way the right-hand column does, that's a finding. Details, line links and tests are in [references/invariants.md](references/invariants.md).

| # | Invariant | The question | hall-cage's answer |
|---|---|---|---|
| I1 | **One deposit binds the payout address** | Can anyone, ever, send a player's money somewhere other than where they chose? | `payTo` is written at the first deposit and every later deposit must name the same address. `withdraw` and `rescue` send only to `payTo` |
| I2 | **Settles only reshuffle, and must balance** | Can the operator create, destroy or take money in a settle? | Debits = credits + rake; rake ≤ `maxRake`; each debit ≤ `roundCap`, ≤ the seat's remaining `atRisk`, ≤ balance; only players seated at that table and epoch; rounds in order |
| I3 | **The operator acts alone only under a capped, expiring permit** | Without the player's wallet, what's the most the operator can lose for them, and for how long? | A permit the player writes: one judge key, `cap` per seat, a `floor` of balance − cap it can never place below, `until` at most `maxGrant` past the block's clock. A stand or a revoke ends it, and nothing can block a revoke |
| I4 | **Rescue pays only the bound address** | If a player loses their key, can they still get out, and can a stranger misuse that? | Anyone may call `rescue(id)`. It sends the whole balance to `payTo` and nowhere else. It is refused while seated and while a permit is live, so a stranger can't kick a player out between seats |
| I5 | **No operator transaction can block a way out** | Can the operator (or a stolen key) keep a player's exit off the chain? | Exits read only what operator transactions don't write (split ledger maps). A stand can't be outrun by settles. A table with no settle for `escapeSecs` goes dead; a stand runs out after `escapeSecs` however long the table lives |
| I6 | **The operator can't change the rules quickly** | Can a new operator key take over, or the contract be upgraded, before players can leave? | Judge rotation waits a timelock ≥ escape window + clock slack, and the old key can cancel. Deployed with a maintenance authority nobody can use |

### 3. Write the attacks as tests, with the race harness

Happy-path tests can't show I3 and I5. You need the attacker's transaction and the victim's built against the **same** state and landed in the order the attacker wants. hall-cage's tests do that offline with the compiled circuits in the Compact simulator: `build` returns a transaction made against the state of the moment, and `land` replays it against whatever the state is later, the way the chain would. See [references/race-harness.md](references/race-harness.md).

To do the same for your contract, copy [`scripts/harness/`](scripts/harness/) into your project: `harness.mjs` gives you `makeWorld`, `build`, `call`, `land` and `at` for any compiled contract, and `example/` is a small contract with four race tests that pass. Compile your contract with `compact compile --skip-zk` (no proving keys needed for the simulator) and install the compact-runtime version your compiler's output checks for ([references/race-harness.md](references/race-harness.md#using-the-template)).

Name each test after the attack, not the function (`a seated loser who deposits 1 STAR first cannot make the settle fail`), and assert both halves: the attack failed, and the honest transaction still landed.

### 4. Prove the tests have teeth

Run the attack tests against the contract **before** the fix. Each one must fail there. hall-cage keeps the old cage #3 for this and has a test that runs `attacks.test.mjs` against it and requires every attack test to fail ([references/attacks.md](references/attacks.md#the-check-that-the-tests-have-teeth)). An attack test that also passes on the vulnerable contract proves nothing.

### 5. Pin what you don't guarantee

Write the limits down as passing tests named `KNOWN, ...`, so a later change that closes or widens them shows up. hall-cage has two; [references/limits.md](references/limits.md) lists them with the other gaps a reviewer should know about.

### 6. (Optional) Run hall-cage's tests yourself

Offline: GitHub and npm only, no chain and no keys. Needs git, Node 22+, pnpm 10 and the Compact compiler 0.31.1. Run it from your own work folder (not inside the skill), with the path to the script:

```sh
cd <your work folder>
node <this skill>/scripts/run-cage-tests.mjs hall-cage-e5ce2d1              # every test: about 30 s to compile, 1 min to test
node <this skill>/scripts/run-cage-tests.mjs hall-cage-e5ce2d1 --attacks    # attack, permit and rule tests: 8 s to test
```

It clones the public repo, checks out the pinned commit and refuses anything else, installs from the lockfile, compiles the three contracts, and runs the tests. It ends with `PASS: ...` and exit 0, or `FAILED: ...` with the reason. A skipped test counts as a failure, and an unknown option stops it before anything runs. Expected numbers and fixes are in [references/tests.md](references/tests.md).

## Safety rules

- **No chain.** Everything here runs in the simulator. Don't deploy hall-cage, or a contract modelled on it, to hold anything of value. It's unaudited and on test NIGHT only.
- **Link the pinned commit, not `main`.** Line numbers and test names in this skill are for `e5ce2d1`.
- **Don't claim an invariant you haven't tested.** If step 2 finds your contract answers a question the same way, say which test shows it. If there's no test, it's a hypothesis.
- **State the limits.** A review that lists invariants without the `KNOWN` gaps overstates the guarantee.

## What to report

1. The money paths (step 1) as a short table: circuit, who calls it, tokens in or out, where the money can go.
2. I1 to I6, one row each:

   | # | Verdict | Severity | Where | Test |
   |---|---|---|---|---|
   | I1 | holds / fails / not applicable | critical (money can leave to the wrong place or be taken), high (money can be held in or a way out blocked), medium (griefing that costs time or fees), low | circuit and line | the test that shows it, or "no test" |

   For a contract that fails most of them, lead with the critical rows and say the design needs the missing pieces (a bound address, a cap, a way out) before line-level fixes are worth listing.
3. The attacks you wrote, each with its result. Against a fixed contract, an attack test passes when the attack **fails**. Against the original, run it and record that the attack works (step 4); with only one version, write the tests so they assert the attack succeeds, and flip them when it's fixed.
4. The limits you're accepting.
5. If you ran step 6, the final `PASS` or `FAILED` line and the test counts.
