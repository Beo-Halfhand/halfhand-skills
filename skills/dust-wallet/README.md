# dust-wallet skill

Teaches an AI agent to set up a Midnight wallet that pays its own fees: make a seed, fund it from the faucet, sync, register its NIGHT for DUST once, wait for spendable DUST, and know what a call costs. Ledger 9 stack (wallet SDK 2, ledger-v9). Preprod and preview only; mainnet is refused.

| File | For |
|---|---|
| `SKILL.md` | The agent: when to use it, the steps, safety rules, what to report |
| `scripts/dust-wallet.mjs` | One command per step: `init`, `address`, `balance`, `dust` (dry run), `dust --send`, `self-test` |
| `scripts/package.json` | The pinned versions it was tested with |
| `references/flow.md` | The states a wallet goes through, timings, files |
| `references/errors.md` | Errors and what to do |
| `references/cost.md` | Fees, measuring cost per call, paying a contract call from this wallet |
| `references/endpoints.md` | Node, indexer, proof server, and keeping keys out of logs |
| `references/hall-cage.md` | The same pattern in a public project, at a pinned commit |

**Needs:** Node 22+, a node and indexer for the network (no public default), and a faucet request (a web page). No account with us, no keys from us.

**Status:** in development. See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
