# Cost per call

## The units

- **DUST** is counted in SPECK: 1 DUST = 10^15 SPECK.
- **NIGHT** is counted in STAR: 1 tNIGHT = 10^6 STAR.
- Fees are paid in DUST only. NIGHT is never spent on a fee; it generates the DUST.

## What we measured

On Midnight Preprod, Ledger 9, November 2026: **about 0.3 DUST per contract call** (a small notarisation circuit, paid by a self-funded wallet like this one). A registration costs less than a contract call. Treat both as rough: the fee depends on the transaction's size and the circuit, and the network's fee parameters can change.

The script also adds 0.3 DUST of headroom to every fee estimate (`additionalFeeOverhead`, the same as the hall-cage scripts use). That headroom is booked while a transaction is built, not burned, but the wallet needs that much spare DUST to build anything.

## Measure your own

In your own call path, after the wallet balances your transaction and before you submit it:

```js
// w.wallet is the WalletFacade from openWallet()
const finalized = await w.wallet.finalizeRecipe(recipe);
const fee = await w.wallet.calculateTransactionFee(finalized);    // SPECK, this transaction only
console.log(`fee ${(Number(fee) / 1e15).toFixed(4)} DUST`);
```

`estimateTransactionFee(tx)` gives the fee of a transaction **plus** its balancing transaction, before you balance it. Log the measured fee per call for a day, then set `DUST_PER_CALL` to the median so `balance` prints an honest "about N calls".

## Paying a contract call from this wallet

The script stops at "DUST READY". To pay for your own contract calls, import its `openWallet()` (sync, save) and `submitOnce()` (importing the file doesn't run the command line), and let the facade balance your call's transaction with DUST:

```js
import { config, filesOf, lock, openWallet, submitOnce } from './dust-wallet.mjs';
const c = config(), f = filesOf('fees'), release = lock(f);
const w = await openWallet(f, c);   // w.wallet is the WalletFacade
```

```js
const recipe = await w.wallet.balanceFinalizedTransaction(yourFinalizedTx, { ttl: new Date(Date.now() + 10 * 60_000), tokenKindsToBalance: ['dust'] });
const tx = await w.wallet.finalizeRecipe(recipe);
await submitOnce(c, w, tx);   // never resend blind
```

With Midnight.js, a wallet provider built on the same facade does this for you. hall-cage's `scripts/l9-cage.mjs` (`providersFor`) shows one way: [hall-cage.md](hall-cage.md).

## How long DUST lasts

From Midnight's DUST docs (ledger parameters at the time of writing; each network keeps its own and governance can change them):

- Each registered NIGHT coin backs a DUST balance that grows in a straight line, at `generationDecayRate` (8,267 SPECK per STAR per second), up to a cap of `nightDustRatio` (5 DUST per NIGHT). Time to cap is the same for any amount: about one week.
- Example: a faucet drop of 5,000 tNIGHT generates about 0.041 DUST a second (about 3,570 DUST a day, roughly 12,000 calls a day at 0.3 DUST), up to a cap of 25,000 DUST.
- **Spending the NIGHT starts decay**, at the same rate, even a transfer to yourself or one that returns change. The NIGHT that comes back gets a fresh DUST balance starting from zero. So don't move a fee wallet's NIGHT around; if you must, run `dust --send` afterwards for any new coins.
- Read the live parameters from the network rather than trusting these numbers: see "Managing DUST for transaction fees" in the Midnight docs.
