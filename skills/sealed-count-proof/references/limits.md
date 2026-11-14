# What a count proof doesn't settle

The proof says one thing: *this count comes from the values sealed here*. Everything around it is outside the proof. The dice proof's own list is in [docs/DICE-PROOF.md, "Still house-trusted"](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/docs/DICE-PROOF.md#still-house-trusted) and ["Limits of this deployment"](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/docs/DICE-PROOF.md#limits-of-this-deployment). In general terms:

| Gap | Why | In the dice proof |
|---|---|---|
| **Each owner's count is public** | Each owner proves their own count, so no single prover needs everyone's secrets. Publishing only a total would need one prover holding them all | By design |
| **One value per party = the value is public** | If a party seals one value and the question is about it (a yes/no vote), their count *is* their value. Counting this way gives "sealed until the count", not a secret ballot | Not the dice proof's case (five dice, a count of one face). For secrecy, slots must be unlinkable to people, or use another design |
| **Who may seal** | The proof says the count matches the seal, not that the sealer was entitled to the slot | Player seats are named by a key hash when the round opens; the house decides who sits |
| **Where the secret was made** | The proof can't tell whether the page or app that generated the seed was honest. A changed page could read it | The player's seed is made by a page the house serves. A wallet or open-source client would close it |
| **Who proves** | The seed goes to the prover in the clear. A hosted proof server sees it | Stated in the doc |
| **Who is really who** | A seat is "the operator's" only if the contract is told so. An operator holding a seat it calls a player's escapes the rules for its own seats | House-run seats answer first and lose by silence; a house-held "player" seat doesn't |
| **One last look** | Once the seals are on chain, whoever holds the last secret to open can compute its own values first and refuse to open. That's a choice to keep or re-deal, not a choice of values | The house can refuse to open its seed. It counts as a fault on chain. A house-held "player" seat can keep its seal back too: one held seat moves a bot's best-face count from 2.83 to 3.25 on average, four move it to 4.24 (hall-cage's figures) |
| **What the question was** | If the operator posts the question, the chain only knows what was posted | Only the house posts a call, so it can sit on a call it would lose (the round voids) or post a different bid; the page compares and says so |
| **The money** | Nothing makes a payout follow the verdict unless the contract that holds the money reads it | The cage doesn't read the dice verdict. hall-cage's v2 design binds them ([DICE-PROOF-V2.md](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/docs/DICE-PROOF-V2.md)), and records that compactc 0.31.1 refused a cross-contract call ("cross-contract calls are not yet supported"), so on that compiler the dice and the money would have to share one contract |
| **Silence** | Every deadline is a choice of who loses when someone goes quiet | Per seat; see [pattern.md](pattern.md#silence-and-time) |
| **Windows against each other** | Bounds on each window don't bound one against another | An hour for the house and two minutes for players would be legal; v2 caps the house's window at twice the players' |
| **Late checks** | A seal checked only when it's used can be posted and then never answer | A seal made for another deployment is accepted at `commitCup` and can never answer; v2 checks it at sealing ("Fix A") |
| **Zeros** | Refusing the literal zero doesn't refuse the hash of a zero key | v2 refuses `houseId == keyId(0)` and holders equal to `keyId(0)` |
| **Not audited** | Three rounds of independent adversarial review shaped v1; none found a false count or false dice landing. That isn't an audit | Preprod, test NIGHT only |

Writing these down is part of the job: a review that lists the properties without the gaps overstates what the proof gives.
