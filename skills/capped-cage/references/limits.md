# What the cage does not guarantee

hall-cage at `e5ce2d1`. A review that lists the invariants without these overstates them.

## Pinned as `KNOWN` tests (they pass, and describe a gap)

| Test (permit.test.mjs) | The gap | Mitigation in hall-cage |
|---|---|---|
| `KNOWN, F5 is not closed for a house float: its deposit carries the empty permit, so it can be sent home between the deposit and its sit` | A balance with no permit can be rescued (to its own bound address) by anyone whenever it isn't seated. For a house float deposited just before it sits, a stranger can send it home first. No money is lost, but the table doesn't open | Deposit floats with a short permit naming the judge itself; the same test shows that blocks the rescue |
| `KNOWN, L1 bounds F5, not a seat: a judge that seats a lost-key player before until, and keeps the table alive, holds them past maxGrant` | `maxGrant` bounds how long a **permit** holds a lost-key player. A seat holds them separately: a seat binds until the judge releases it or the table goes quiet, and a lost-key player can't stand. A judge key that seats them and keeps settling (even empty settles) holds the money as long as it does that | The honest judge releases players it no longer has a round for. Nothing on chain forces it |

## Other limits

- **One stand breaks one settle.** A seated loser can always break the settle in flight once, by standing. The next settle then frees the seat and takes the loss. Plan the operator to retry, not to give up.
- **The contract can't see a live round.** It doesn't know whether cards are dealt. So a stand isn't immediate, and the operator must settle a table before a `release` or a move off it, or a player could hop away from a loss. In hall-cage that guard lives in the off-chain judge, not the contract.
- **A permit's holder can front-run some of the player's moves.** The judge can land a seat before a withdraw built just before it (once: the stand that follows ends the permit), and can keep a stand off the chain by moving the seat until the player revokes. Both are tested, and both end with the player's own transaction.
- **Declared time.** Compact 0.23 can compare block time but not read it, so callers declare `now`. A declared `now` may lag the block by up to `clockSlack`, which lets a stand be back-dated by that much. The constructor forces `clockSlack < escapeSecs`.
- **The constructor checks run on the deployer's machine.** A deploy carries its own initial state, so the `maxGrant` and timelock checks in the constructor protect an honest deployer from mistakes. They don't stop a dishonest one. Read the deployed values from the public state before trusting a cage.
- **A builder whose clock runs ahead of the chain** can have a grant near the `maxGrant` bound refused when it lands. Keep grants well inside the bound.
- **Rotation timelock.** A new judge key, once accepted, can use permits that already name it. Players see the proposal on chain and have `judgeDelay` to leave.
- **Not audited.** hall-cage says so itself: v0 prototype, test NIGHT only, not for real funds.
- **Privacy.** Balances, seats, permits and settle lines are public ledger state, keyed by `persistentHash` of the player's key. Anyone can follow one `playerId` across rounds.
