# The attack tests

hall-cage at `e5ce2d1`. Two files: [`test/attacks.test.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/attacks.test.mjs) (12 tests: the two holes found in cage #3) the attack-shaped tests in [`test/permit.test.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/permit.test.mjs) (the permit's own attacks: the `attack:` tests and the `floor:` and `F5:` tests that play an attacker). All run offline in the simulator with the [race harness](race-harness.md).

## Attack A: a loser makes the settle fail

**The attack.** A settle reads every named player's balance. If a losing player changes their own balance (a 1 STAR deposit) before the settle lands, the judge's settle was built on a stale read and fails. Repeat every round and the loser never pays. A friend can try the same by sitting at the table, or leaving it.

**The fix (I5).** A seated player can't deposit. Seat counts are a `Counter` that a settle reads only as "is anyone here", so sits and exits by others don't touch what it read. The only move left is the loser's own `stand`, once, which breaks one settle and then the next settle frees the seat and takes the loss.

| Test | Shows |
|---|---|
| `attack A: a seated loser who deposits 1 STAR first cannot make the settle fail` | the deposit is refused; the settle lands; the loss is taken |
| `attack A: a deposit built before sitting, sent after the loss, cannot land and cannot make the settle fail` | a deposit prepared while unseated read "no seat", so it can't land after the sit |
| `attack A: a loser at one table cannot fail a whole batch by depositing` | one batch, two tables; a loser at one can't fail both |
| `attack A: the griefing runs out. Of everything a loser and their friends can do, only one stand by the loser breaks a settle` | 40 tries, 10 friends: at most one settle broken, then it lands |
| `attack A: a friend who sits at the table cannot make the settle fail` | the Counter keeps sits apart from settles |
| `attack A: a friend whose stand ran out, leaving for another table, cannot make the settle fail` | an exit doesn't disturb the settle either |

## Attack B: the judge keeps a player from leaving

**The attack.** A stolen (or dishonest) judge key wants to keep a player's money in. It can land transactions before the player's: settles at the player's table, debits of 1 STAR on the player's seat, settles at a new epoch. If the player's `stand`, `withdraw` or `rescue` reads anything those write, it never lands.

**The fix (I5).** A stand reads only the seat, and a debit writes `risks`, not `seat`. A stand runs out `escapeSecs` after its declared time, whatever the table does. An expired stand's exit, and a stale epoch's, read neither `tables` nor `seats`.

| Test | Shows |
|---|---|
| `attack B: a standing seat goes free after escapeSecs, however long the judge keeps the table alive` | nine hours of settles naming others; the whole balance still comes out |
| `attack B: a stolen judge key cannot push a stand off the chain by landing settles that name others` | a stand built before a settle still lands after it |
| `attack B: a stolen judge key cannot push the way out off the chain either, once the stand has run out` | same, for the withdraw |
| `attack B: the rescue path is just as out of reach` | same, for a rescue by someone else |
| `attack B: a stolen judge key cannot keep a stand off the chain by debiting the seat 1 STAR at a time` | a debit on this very seat doesn't break the stand |
| `attack B: a void seat can leave across settles at the new epoch of its table, with or without its key` | a seat from a dead table's old epoch can withdraw, or be rescued, across settles at the new one |

## Permit attacks (permit.test.mjs)

| Test | Attack | Result |
|---|---|---|
| `floor: the drain is closed. A stolen key with mules takes the cap and no more, by moves or by release and seat` | stolen judge key seats the victim, loses `cap` to a mule, then tries to place more by moving or by release and re-seat | refused at every amount down to 1 STAR: "below the permit's floor" |
| `attack: a stolen judge key can keep a stand off the chain by moving the seat. Revoke can't be stopped, and it ends that` | judge moves the seat to a new table each time the player builds a stand, so the stand's read is always stale | it works (that's why the name starts "can"), until the player sends a revoke, which reads only their permit; then no move can be built and the stand lands |
| `attack: a seat or move built before a revoke, landing after it, does not land` | judge races the revoke | the seat or move fails |
| `attack: with a permit live, a seat by the judge can knock out a withdraw built just before it. The stand that follows ends the permit, so that is the last time` | judge front-runs a withdraw with a seat | works once; the stand ends the permit |
| `attack: the judge's seat fails safely if the player's money moved first, so a deposit or withdraw beats it. A rescue can't come between, since F5` | | the player's own move wins the race |
| `attack A still closed: a deposit built before the judge seats you can't land after, and can't fail the settle` | attack A through a judge seat | closed |
| `F5: a stranger can't send a granted player home, between the deposit and the seat or between two seats, while the permit is live` | griefing by rescue | refused while live; the player's own withdraw is untouched |

Two of those rows describe attacks that **partly work** and are bounded instead of closed. That's the honest shape of a cage: say what an attacker gets, and what ends it.

## The check that the tests have teeth

[`test/attacks-cage3.test.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/attacks-cage3.test.mjs) runs `attacks.test.mjs` again in a child process against the compiled **cage #3** (`contracts/legacy/cage3.compact`, the version with the holes), via the `MANAGED` env var. It fails if any attack test **passes** there: such a test would pass whatever the contract did, so it proves nothing.

The harness supports this by falling back to cage #3's older circuit signatures (`depositOf`, `standOf`) so that each test reaches the attack and fails on it, not on an argument error.

Checked from a fresh clone (13 November 2026, Compact 0.31.1):

| Contract | attacks.test.mjs |
|---|---|
| cage #3 (`MANAGED=contracts/managed/cage3`) | 0 passed, **12 failed** |
| v4b (default) | **12 passed**, 0 failed |

To do the same for your contract: keep the vulnerable version compiled next to the fixed one, make the build path an env var in your tests, and add one test that runs the attack file against the old build and requires every attack test to fail.
