# The flow, step by step

## Three wallets in one

A Midnight wallet on wallet SDK 2 is three wallets behind one facade (`WalletFacade`), all derived from one seed (account 0, key index 0 for each role):

| Part | Holds | Role used |
|---|---|---|
| shielded | private tokens | Zswap |
| unshielded | NIGHT (tNIGHT on test networks), your funding address `mn_addr_<network>1…` | NightExternal |
| dust | DUST, the fee resource | Dust |

`WalletSeeds.fromMasterSeed(seed)` gives the three role keys. The unshielded key also signs the DUST registration.

## States a new wallet goes through

```
init ─► address file ─► faucet (user) ─► first sync (slow) ─► tNIGHT > 0, registered 0, DUST 0
      ─► dust (dry run) ─► dust --send ─► registration lands ─► DUST grows ─► DUST READY
```

| What `balance` shows | Meaning | Next |
|---|---|---|
| tNIGHT 0 · NIGHT coins 0 | Not funded yet, or the faucet transfer hasn't been synced | Fund it; run `balance` again |
| tNIGHT > 0 · registered 0 · DUST 0 | Funded, not registered | `dust` (dry run), then `dust --send` |
| registered = coins · DUST 0 | Registered, DUST still accruing (or the dust side is behind) | Wait; run `balance` in a few minutes |
| registered = coins · DUST > 0 | Ready to pay fees | Use it |
| registered < coins | A new NIGHT coin arrived (another faucet drop, a payment) | `dust --send` registers just the new ones |

## Timings measured (November 2026, Ledger 9)

| Step | Time |
|---|---|
| `init` / `address` | about 1 s (no network) |
| First sync from genesis | Preprod: 1 h 40 min for one wallet, about 3 h for another on a busier day. Most of it is the DUST events (about 1.9 million at the time), at 70 to 150 events a second. Preview (reset 6 November): 65 s for about 25,000 DUST events |
| Later syncs from `state.json` | seconds to a few minutes, depending on how long since the last save |
| Registration: build and prove | 2 s with the in-process prover (Preview) |
| Registration: land on chain | 20 s from submit to SUCCESS on the indexer (Preview) |
| First spendable DUST after registration | at once: DUST counts from the NIGHT coin's creation. 2.6 DUST for a 5,000 tNIGHT coin a minute old, then about 0.041 DUST a second |

## Why "synced" is awaited twice on a fresh wallet

On wallet SDK 2 a fresh wallet's first `waitForSyncedState()` can resolve while the dust part is still behind the Ledger 9 fork point. On that early view, NIGHT that is already registered can read as unregistered. The script waits five seconds and asks for a synced state again before it trusts the numbers, and before `dust --send` decides what to register.

## What `dust --send` does

1. Picks the NIGHT coins without `meta.registeredForDustGeneration`.
2. `estimateRegistration(coins)` gives the fee.
3. `registerNightUtxosForDustGeneration(coins, verifyingKey, sign)` builds and signs the transaction. A first registration pays its fee from DUST the coins have already generated; if that isn't enough yet, the SDK throws `InsufficientDustForFeeError` with an estimate. When the estimate is `Reachable`, the script waits that long with `waitForGeneratedDust` and tries again.
4. `finalizeRecipe(recipe)` proves it.
5. The bytes go to the node **once** (`author_submitExtrinsic`). A refusal before the pool releases the booking (`revert`), so nothing is spent. A lost reply is followed by 90 s of indexer checks, never by a resend.
6. The indexer is polled up to 4 minutes for the transaction's block and status.
7. Then it waits for DUST above 0 and prints `DUST READY`.

## Files

```
.dust-wallet/            700
  <name>/                700
    seed                 600   64 hex characters. Never printed, never overwritten
    address              644   the funding address, safe to share
    state.json           600   the synced state (restores in seconds). Holds no seed, but it does hold your coins and history: keep it private
    lock                 600   the pid of the process using the wallet; removed on exit, Ctrl-C and SIGTERM. After a kill -9 or a crash it stays behind, and the next run takes it over once that pid is gone
```

Losing `state.json` costs one slow sync. Losing `seed` loses the wallet. Back up the seed the way you'd back up any key (offline, encrypted), not in the repo.
