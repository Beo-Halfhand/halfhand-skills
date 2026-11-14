---
name: sealed-count-proof
description: Design, build or review a Midnight (Compact) contract where several parties each seal private values on chain and later prove a count over them (how many match a public question) without showing the values, and the chain adds the counts itself. Uses the public hall-cage dice proof as the worked example (sealed dice, a count proven with 1s wild, the verdict computed on chain) and ships a small generic example contract with a test kit. Covers the seal (domain tag, random nonce, slot, round and contract address), fair randomness nobody can grind (named seals, the house seed sealed first, a salt from every seal), the proof circuit, adding counts with Counters, silence and time windows, and testing at three levels (the contract's own refusals, a cheat's client through the circuit checker, a changed circuit against the real one), plus a privacy scan, a plain-JavaScript mirror and a mutant sweep. Use it for sealed hands, dice, ballots, bids or inventories where a count must be trusted unseen. No chain, no keys.
---

# sealed-count-proof

**What it is.** Each party seals some private values on chain (a hand of dice, a ballot, a bid, a stock count). Later, a public question is asked ("how many 4s?", "how many yes?"), and each party answers with a zero-knowledge proof that says: *this count comes from the values I sealed*. Only the count goes on chain. The chain adds the counts and states the result, so nobody's word decides it, the operator's included.

The worked example is the dice proof in [hall-cage](https://github.com/Beo-Halfhand/hall-cage) (Apache-2.0): `contracts/dice-proof.compact` (8 circuits) and `test/dice-proof.test.mjs` (72 tests), read at the pinned commit **`e5ce2d1`**. It runs Cup & Claim, a bluffing dice game, on Midnight Preprod. This skill explains it and links to it; it doesn't copy it.

| You get | Where |
|---|---|
| The pattern, piece by piece, each with the lines in the dice proof that do it | [references/pattern.md](references/pattern.md) |
| Testing it: the three levels of "refused", the privacy scan, the plain-JavaScript mirror, stale builds, the mutant sweep | [references/tests.md](references/tests.md) |
| A small generic contract (`tally`) and a test kit for **your** contract, 29 tests and a 24-mutant sweep that pass | [`scripts/kit/`](scripts/kit/), [references/kit.md](references/kit.md) |
| What the proof does **not** settle: what stays trusted | [references/limits.md](references/limits.md) |
| A map of the dice proof's files at the pin, and the words used in them | [references/hall-cage.md](references/hall-cage.md) |
| Running hall-cage's dice tests (no chain, no keys) | [`scripts/run-dice-tests.mjs`](scripts/run-dice-tests.mjs) |

**Not covered:** deploying, wallets and fees (see the [dust-wallet](https://github.com/Beo-Halfhand/halfhand-skills/tree/main/skills/dust-wallet) skill), the money side (see [capped-cage](https://github.com/Beo-Halfhand/halfhand-skills/tree/main/skills/capped-cage)), proving servers, mainnet. The dice proof is a **Preprod prototype on test NIGHT, not audited**. Use it as a pattern to reason with.

## When to use

- Several parties hold private values, and a count, tally or "does anyone have more than N" must be trusted without revealing the values: card or dice games, sealed ballots, sealed-bid thresholds, private inventories, attestations.
- You're reviewing such a contract and need to ask: can a party change their values after seeing others? Can anyone pick their own random values? Can a party lie about their count? Can the operator? What does silence do?
- You need tests that show a cheat is refused by the circuit, not just by the client's own code.

## Steps

### 1. Decide what's sealed, what's public, and when the question is fixed

Write down: the owner of each sealed value, the question and **when** it becomes known, and exactly what goes public. In this pattern **each owner's count is public**, and that is by design: each owner proves their own count, so no single prover holds everyone's secrets. A design that publishes only the total (or only yes/no) needs one prover to know every secret, which is what this pattern exists to avoid.

**If each party seals one value and the question is about that value, the count *is* the value.** A yes/no ballot counted this way publishes every vote at counting time, linked to its slot: it gives *sealed until the count*, not a secret ballot. For secrecy, the slots themselves must be unlinkable to people (for example anonymous membership proofs), or use another design. Say this in the review whenever a party has one value.

Then decide which kind of values you have:

| Kind | Example | What has to be fair |
|---|---|---|
| **Chosen** by the owner | ballots, bids, inventory, the `tally` example | Values can't change after the seal; the question is asked after sealing closes |
| **Random**: nobody may choose them | dice, cards | The above, and nobody (owner or operator) can steer the values, so they must come from secrets everyone committed to before anyone could see the others (step 3) |

### 2. Design the seal

A seal is `persistentHash(domain tag, secret, ids, contract address)`, written once. Each part closes a hole; the [pattern reference](references/pattern.md#the-seal) links the dice proof's lines and the tests that prove each one.

- **A random 32-byte nonce or seed** inside it. Without one, a small set of values can be guessed: five dice are 7,776 possibilities.
- **A domain tag** per hash (`pad(32, "app:commit:v1")`), so a hash made for one purpose can't stand in for another.
- **The slot, round and seat** (whatever names the place), so a seal or proof can't be replayed at another place or in another round.
- **The contract's address** (`kernel.self().bytes`), so a seal or proof from another deployment, including a decoy the operator deployed, means nothing here.
- **Written once, and never zero**: refuse a second seal on the same slot (otherwise anyone can overwrite another's) and refuse the all-zero value.
- **Only the slot's holder seals it**, and the holders are fixed before sealing starts (named when the round opens, or at deployment), so nobody can take a slot first, seal many slots, or stuff a ballot. The dice proof names each player seat by a key hash at `openRound` and checks the key at `commitCup`. The `tally` example leaves slots open to anyone to stay small: don't copy that part.
- **Phase changes are authorised and happen once**: who may close sealing, ask the question, finish? Each should be one named key, or anyone only after a deadline, and never twice.

### 3. If the values must be random: make grinding impossible

For random values, derive them from the owner's seed **and** a salt everyone contributes to, in an order where nobody can see anything useful before they're locked in. The dice proof's order (details and lines in [pattern.md](references/pattern.md#fair-randomness-nobody-can-grind)):

1. The round opens with the house's seed sealed, the house's own seats sealed, and each player seat **named by the hash of the seal it will post** (the player's page sends it first). From here no seat can try seeds until the dice suit it.
2. Players post those seals from their own keys.
3. The house opens its seed (it must match its seal) only after every player has sealed or the window has closed. The chain computes `salt = H(house seed, round, every seal, contract address)`.
4. Each cup's values = `H(salt, that cup's seed, seat)`. Only the cup's owner can compute them.

Write down the choice that remains (the house can refuse to open after computing its own bots' dice): [limits.md](references/limits.md) has the dice proof's numbers for it.

### 4. Write the proof circuit

One circuit takes the private values from a witness, and it's the only place they enter:

```compact
const h = handOf(s);                                               // witness: private
assert(disclose(commitOf(h, s, kernel.self().bytes) == commits.lookup(s)), "not the sealed hand");
assert(disclose(countOf(h.values, target) == n), "not this slot's count");   // n is the public claim
answers.insert(s, n);                                              // only the count goes on chain
```

Prove the claimed count equals the computed one, rather than computing a count and publishing it, so the public input is the claim and the circuit is the check. Optionally add a "show" circuit with the same seal check that puts the values on chain (the dice proof's `showCup`). Keep the counting arithmetic in **pure** circuits so anyone can run it off chain. hall-cage wraps each witness-derived comparison in `disclose()` to mark the one bit the assert reveals; compactc 0.31.1 also accepts it without (checked), so treat it as documentation, not a compiler requirement.

### 5. Add on chain, with no one's word

- Keep running totals in **`Counter`s**. An increment reads nothing, so answers that land in the same block don't make each other stale. With a plain number, `total = total + n` reads the total, and only the first of three same-block answers lands (the kit's `why Counters` test shows `true false false`).
- **`finish` takes no argument.** The result is what was proven, not what the caller says.
- Settle early when the proven counts already decide it: the dice proof's `finish` holds the bid when `known >= bid` and fails it when even five of a kind from every silent cup couldn't reach it (`known + pending * 5 < bid`).

### 6. Decide what silence means, and fix the clock

- **Windows fixed at deployment**, inside bounds the constructor asserts, so the operator can't shorten them for one round. hall-cage's v2 design adds bounds between windows too ([limits.md](references/limits.md)).
- **A declared `now`**: the circuit checks `blockTimeGte(now)` and `blockTimeLt(now + slack)`. Add the slack to every deadline the caller sets, or back-dating eats into the other side's window.
- **Who answers first**: in the dice proof, the house's seats answer in their own window before the players, so the house can't read a player's count and then decide to go quiet.
- **What silence costs**: decide per seat. The dice proof: a silent bidder or caller loses; a silent house seat loses for the house; any other silent seat that could change the result voids the round; a house that never opens its seed can be voided by anyone, and that counts against it on chain.

### 7. Test at three levels, then sweep

Copy [`scripts/kit/`](scripts/kit/) and follow [references/kit.md](references/kit.md). The levels ([references/tests.md](references/tests.md)):

1. **The contract's own code refuses** (`refused(() => w.build(...), /the assert's message/)`). Necessary, and proves nothing about a cheat. Rules that read a map entry which isn't there stay at this level: even the cheat build throws at the lookup, so there is no transaction to check.
2. **A cheat's client**: the compiled JavaScript with every assert removed builds the bad transaction anyway, and the **circuit checker** over the real circuit's ZKIR must refuse it. Start with a control: the honest transaction passes through the cheat's code.
3. **A changed circuit**: a changed source, really compiled, builds it; the checker over the **real** circuit must refuse it. Include a control: the changed build still passes the real checker on a circuit it didn't change.

Plus: a **privacy scan** (the secret is absent from the public part of what was built, and present in the private part, so the scan works), a **plain-JavaScript mirror** matched bit for bit, **stale builds** (built in time, landed late), and the **mutant sweep** (`mutants.mjs`): delete or change one rule at a time and require a test to fail. A surviving mutant is a hole in the tests, or a change that can't matter, and it must say which (`"equivalent": "<why>"`).

### 8. Write down what stays trusted

A proof of a count proves that count, and nothing about the page that made the seed, the prover that saw it, which seats are really the operator's, or whether money follows the result. List these for your contract; [limits.md](references/limits.md) has the dice proof's list to start from.

### 9. (Optional) Run the dice proof's own tests

No chain and no keys; the network is used only for the GitHub clone and npm. Needs git, Node 22+, pnpm 10 and the Compact compiler 0.31.1. From your own work folder:

```sh
node <this skill>/scripts/run-dice-tests.mjs hall-cage-e5ce2d1              # clone, compile, 72 tests: about 30 s
node <this skill>/scripts/run-dice-tests.mjs hall-cage-e5ce2d1 --mutants    # and the 99-mutant sweep: about 11 min more
```

It ends with `PASS: ...` and exit 0, or `FAILED: ...` with the reason. A skipped test or a surviving mutant counts as a failure.

## Safety rules

- **No chain.** Everything here runs in the simulator and the circuit checker. Don't deploy the example, or the dice proof, to decide anything of value: neither is audited.
- **Link the pinned commit, not `main`.** Line numbers and test names are for `e5ce2d1`.
- **Never ship a seal without a random nonce or seed**, and never let the operator choose a party's seed. Generate it on the party's own device.
- **Don't claim a refusal you only tested at level 1.** Say which level each test reaches.
- **Don't publish secrets in tests or logs**: the kit's privacy scan prints nothing it finds.

## What to report

1. The shape (step 1): who seals what, what's public, when the question is fixed, chosen or random.
2. One row per property:

   | Property | Holds? | Where | Test, and its level |
   |---|---|---|---|
   | Only a slot's holder seals it; holders fixed before sealing | yes / no / n.a. | circuit and line | name, level 1/2/3 |
   | Values can't change after the seal | | | |
   | Seal bound to place, round and deployment | | | |
   | Nobody can grind random values | | | |
   | A wrong count or other values are refused | | | |
   | Only the count goes public (privacy scan) | | | |
   | The total is added on chain, `finish` takes no claim | | | |
   | Same-block answers all land | | | |
   | Windows fixed and bounded; silence decided per seat | | | |
   | Phase changes authorised, and once | | | |
   | What one party's count reveals (all of their value, if they hold one) | | | |

3. The mutant sweep's last line, and every equivalent mutant with its reason.
4. What stays trusted (step 8).
5. If you ran step 9, the final `PASS` or `FAILED` line.
