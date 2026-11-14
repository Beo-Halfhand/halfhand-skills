# The invariants, in the code

Everything here is hall-cage at commit `e5ce2d1`. Line links go to [`contracts/sealed-cage.compact`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact) at that commit. Tests are named as they appear in `test/` at that commit.

## The cast

| Who | Holds | Can call |
|---|---|---|
| **Player** | a cage key (the `secretKey()` witness). On chain they are `playerId = persistentHash("sealed-cage:player:v0", sk)`, never the key | `deposit`, `sit`, `stand`, `withdraw` |
| **Judge** | one key whose `playerId` is the ledger's `judge` | `settleBatch`, `release`, `seatByJudge` (only under a permit), `proposeJudge`, `cancelJudge` |
| **Proposed judge** | the key named in `proposeJudge` | `acceptJudge`, after the timelock |
| **Anyone** | nothing | `rescue(id)` |
| **House** | an ordinary player balance (`houseId`) that receives the rake and withdraws like a player | as a player |

The money: `balance` (a map of `playerId` → amount) inside the contract. Tokens come in on `deposit` (`receiveUnshielded`) and go out on `withdraw` and `rescue` (`sendUnshielded`). Nothing else touches tokens.

## I1. One deposit binds the payout address

- First deposit writes `payTo[id]`. Every later deposit must name the same address or it's refused: "payout address is fixed at first deposit" ([L157–158](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L157-L158)).
- `withdraw` ([L194–204](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L194-L204)) and `rescue` ([L206–223](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L206-L223)) pay `payTo.lookup(id)`. Neither takes an address.
- No circuit writes `payTo` except the first deposit, and a deposit needs the player's key (`me()`).
- **Why it matters:** the operator and anyone who calls `rescue` can decide *when* money leaves, but never *where* it goes.
- **Tests:** `deposit: balance grows, NIGHT comes in, payout address is fixed at the first deposit` (cage), `deposit: the rules from before still hold with a permit on it ...` (permit), `a permit never moves money: the judge has no withdraw, and rescue still pays only the bound address, once the permit has run out` (permit; it checks the claimed spend goes to the player's address).

"One deposit" has a second meaning: players deposit **once** and then play many rounds. Rounds don't move tokens, only balances. That's what keeps a settle cheap and lets the operator pay its fee.

## I2. Settles only reshuffle, and must balance

`settleBatch` → `settleOne` → `settleLine` ([L305–344](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L305-L344)). Judge only. Per entry:

| Rule | Line |
|---|---|
| The table is alive (someone seated, settled within `escapeSecs`) | L309 |
| `roundNo` = last + 1: no replays, no skipping | L310 |
| `houseCut ≤ maxRake` | L311 |
| Σ debits = Σ credits + houseCut | L312–314 |
| Each line names a player seated at **this** table in **this** epoch | L322–324 |
| A line is a debit or a credit, not both | L326 |
| Each debit ≤ `roundCap`, ≤ the seat's remaining `atRisk`, ≤ balance | L327–330 |

A seat's `atRisk` is chosen by the player when they sit (or the judge under a permit, I3), must be ≤ balance, and goes down with each debit (L333). So **the most a player can lose at a seat is the `atRisk` they declared**, however many rounds the judge settles.

- **Tests:** `settle: sum rule, rake ceiling, one round at a time, only sitting players, debit limits`, `grind attack: a judge settling roundCap losses every round is bounded by atRisk, not by balance`, `invariant: balance ≥ remaining atRisk for every seated player, through wins and losses`, `a line naming a seat left from an earlier epoch of the same table is refused ...` (all cage).

## I3. The operator acts alone only under a capped, expiring permit

Seating a player normally needs their wallet (`sit`). For a game that moves players between tables without a wallet prompt each time, the player can grant a **permit** with their deposit ([`deposit`, L144–167](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L144-L167)):

`Permit { judge, cap, until, floor }`, with `floor = balance after the deposit − cap` (0 if cap ≥ balance).

`seatByJudge` checks it every time ([`checkPermit`, L263–273](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L263-L273)):

- the caller is the judge **and** the permit names this judge key (a rotated-in judge can't use old permits);
- `until` hasn't passed **by the block's clock**, not the caller's declared time;
- `0 < atRisk ≤ cap`, `atRisk ≤ balance`, and `atRisk + floor ≤ balance`.

The floor is the point. A seat's `atRisk` caps one seat's loss, but a judge could seat, lose, release and seat again. The floor doesn't move when the player loses, so after the judge has placed `cap` worth of losses, nothing more can be placed: **the most a permit can lose is `cap`, wins aside.** A top-up deposit with the empty permit raises the floor by the same amount, so new money isn't exposed (L165).

Ending it:

- **Only the player writes a permit.** No judge circuit writes `permits` except to remove one on the player's own stand.
- `stand` ends the permit (L191).
- **Revoke** = `deposit` of 0 with the empty permit (L148–150). It reads only the caller's own permit, nothing the judge writes, so no judge transaction can make it fail.
- `until` ≤ block time + `maxGrant` at the grant (L1 check, L163). `maxGrant` is sealed at deploy (30 days in the live deploy) and the constructor refuses 0 and anything over 365 days, which also catches milliseconds (L65).

- **Tests (permit.test.mjs):** the `floor:` tests, especially `floor: the drain is closed. A stolen key with mules takes the cap and no more, by moves or by release and seat`; the `seatByJudge:` tests; `stand ends the permit: ...`; `no judge action can block a revoke: built first, it lands after settles, moves, a release, a new seat and a rotation proposal, all of that same player`; `rotation: a permit names a key, so the new judge can't use it ...`; the `L1:` tests.

## I4. Rescue pays only the bound address

[`rescue(id)`, L206–223](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L206-L223). Anyone may call it, with no key: that's the lost-key path. It sends the **whole** balance to `payTo[id]` (I1).

Refused:

- while the seat binds ("seated: the judge must release this seat first"), because a settle may still need that balance;
- **while a permit is live** (finding F5 in hall-cage's history): "a permit is live: rescue after it runs out". Without this, a stranger could send a granted player home in any gap between two seats, again and again, and the player would have to grant a fresh permit each time. Live means present and `until` not passed by the block's clock: the same test `seatByJudge` uses, so there's no second in which the judge can seat a player whom a stranger can also rescue.

Because only the player writes a permit, the judge can't use F5 to hold money in. L1 bounds how long F5 can hold a lost-key player: at most `maxGrant` after their latest grant.

- **Tests:** `rescue: anyone sends the whole balance to the bound address; refused while seated, with no address, or when empty` (cage); the `F5:` tests and `L1 with F5: a lost-key player with no seat waits at most maxGrant from the grant ...` (permit).

## I5. No operator transaction can block a way out

On Midnight a transaction is built and proven against the state its builder saw. The cage's own design note (L12–16) and its race tests rest on this: a transaction fails if anything it read has changed by the time it lands. So an attacker who can land a transaction first can knock out any victim transaction that **reads** what the attacker's **writes**. The defence is to split state so exits and settles don't read each other's writes:

| Map | Written by | Read by |
|---|---|---|
| `tables` (last round, heartbeat) | settles, a new epoch | settles; exits only through `alive()` on a seat of the current epoch |
| `epochs` | a new epoch | settles, seats |
| `seats` (a `Counter` per table) | sit, seat, release, expiry | settles read only "is anyone here" (`lessThan(1)`), not the number |
| `risks` | sits and debits | settle lines |
| `seat` (who sits where) | sit, stand, release, a settle that frees a standing seat | exits |
| `permits` | the player only (deposit, stand) | judge seats, `rescue` |

Then the ways out, which need nothing from the judge:

- **Per table:** no settle for `escapeSecs` → the table is dead, its seats stop binding, players withdraw ([`alive`, L96](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L96)). Only the operator's silence triggers it.
- **Per seat:** `stand` is intent only. The next settle naming the seat releases it, and if none comes within `escapeSecs` of the stand, the seat is free **however long the judge keeps the table alive** ([`standExpired`, L98](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L98)). The stand can't be immediate: the contract can't see whether a round is live, so an immediate exit would let a loser leave between the deal and the settle.
- **The other side:** a seated player can't deposit ("seated: deposit after you stand", L155), because a settle reads each named seat's balance and a loser's deposit would make it fail. Of everything a loser and friends can do, only the loser's one `stand` breaks one settle.

- **Tests:** all of [attacks.md](attacks.md); in cage.test.mjs `escape: no settle for 30 min → the table is dead ...`, `the stand edge: at standAt + E - 1 the judge can settle and the player cannot leave; at standAt + E it is the other way round`, `withdraw vs settle race: ...`.

## I6. The operator can't change the rules quickly

- **Rotation** ([L225–248](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L225-L248)): the judge proposes, waits `judgeDelay`, and only the **new** key can accept. The old key can cancel while it's pending. The constructor requires `judgeDelay ≥ escapeSecs + clockSlack` (L66), so a player who doesn't like the new key has time to stand and leave first.
- **No upgrade:** the deploy swaps the contract's maintenance authority for an empty committee with threshold 1, which no key can ever satisfy, and checks that on the public state after landing ([`scripts/deploy-locked.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/scripts/deploy-locked.mjs); the idea is credited there to Nightcast). Its test (`test/lock.l8.mjs`) needs the older Midnight.js 4 stack and isn't part of `npm test`.
- **Declared time** ([`checkedNow`, L84–89](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact#L84-L89)): Compact 0.23 can compare block time but not read it, so callers declare `now`, which must be not in the future and at most `clockSlack` old. Permit expiry is checked against the block directly, not against the declared `now`, which may lag.
- **Tests:** `judge rotation: propose (judge only, not self), cancel by the old key, accept by the new key only after the timelock`, `constructor: the judge timelock must cover the escape window and the clock slack, ...`, `declared time: not in the future, not older than clockSlack` (cage).

## Using these on your own contract

1. Write your cast table. If any role can call a circuit that sends tokens to an address it passes in, I1 fails.
2. For each operator circuit, write the bound on what it can move. If the bound is "the balance", you need an `atRisk` or a cap (I2, I3).
3. For each exit, list the ledger fields it reads, and for each operator circuit, the fields it writes. Any overlap is a place the operator can keep the exit off the chain (I5). Split the state or change what the exit reads.
4. For each new authority you grant the operator, write who can end it and whether the operator can block that.
