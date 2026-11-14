# hall-cage at the pinned commit

[hall-cage](https://github.com/Beo-Halfhand/hall-cage) is public under Apache-2.0. This skill was checked against commit **`e5ce2d1`** (12 November 2026). Link to the commit, not `main`: later commits may move lines and rename tests.

| File at `e5ce2d1` | What it is |
|---|---|
| [`contracts/sealed-cage.compact`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/sealed-cage.compact) | the cage, v4b, 11 circuits, Compact language 0.23. The comments at the top and above each circuit give the reasons |
| [`contracts/legacy/cage3.compact`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/contracts/legacy/cage3.compact) | cage #3, the version with the two holes, kept for the attack tests |
| [`test/attacks.test.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/attacks.test.mjs) | attacks A and B, and the race harness (`world()`) |
| [`test/attacks-cage3.test.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/attacks-cage3.test.mjs) | runs the attacks against cage #3 and requires each to fail there |
| [`test/permit.test.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/permit.test.mjs) | the permit: floor, cap, `until`, revoke, F5, L1, the `KNOWN` limits |
| [`test/cage.test.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/cage.test.mjs) | the rules: deposit, sit, stand, settle, escape, rotation, same-block races |
| [`test/zkir.test.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/test/zkir.test.mjs) | the circuits through the zkir checker: circuit count, the L1 clock query in the proof, time to dismiss |
| [`scripts/deploy-locked.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/scripts/deploy-locked.mjs) | the deploy with a maintenance authority nobody can use |
| [`docs/CAGE-V4-PLAN.md`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/docs/CAGE-V4-PLAN.md) | the design and findings (F4, F5, L1) behind v4 |
| [`README.md`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/README.md) | the rules table, the escape hatches, "what can make what fail", the live contract address on Preprod |

## Words used in the code

| Word | Means |
|---|---|
| judge | the operator key that settles rounds |
| seat, table, epoch | where a player's `atRisk` is locked. A dead table's next sit starts a new epoch, which voids old seats |
| `atRisk` | the most a seat can still lose |
| stand | a request to leave; done at the next settle naming the seat, or after `escapeSecs` |
| permit, cap, floor, `until` | the player's grant letting the judge seat them without a wallet prompt |
| revoke | `deposit` of 0 with the empty permit |
| rescue | anyone's call that sends a player's whole balance to their bound address |
| F4, F5, L1 | findings in the v4 work: F5 = rescue blocked while a permit is live; L1 = a permit runs at most `maxGrant` |
| STAR | the smallest unit of NIGHT (1 NIGHT = 1,000,000 STAR) |
