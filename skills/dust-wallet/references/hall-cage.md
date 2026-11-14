# The same pattern in a working project: hall-cage

[hall-cage](https://github.com/Beo-Halfhand/hall-cage) is the public, Apache-2.0 code behind a deposit contract on Midnight Preprod. Its wallets fund themselves the same way this skill does. Read it at the pinned commit, **`e5ce2d1`** (12 November 2026), the one this skill was checked against:

| File at `e5ce2d1` | What to look at |
|---|---|
| [`scripts/l9-wallet.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/scripts/l9-wallet.mjs) | `openWallet()`: seeds, keystore, `WalletFacade.init` with the three wallets, restore from saved state, progress every 30 s, save (600) |
| [`scripts/cage.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/scripts/cage.mjs) | the `dust` mode: the registration with the `InsufficientDustForFeeError` wait, then waiting for spendable DUST. The `address` mode writes the funding address to a file |
| [`scripts/l9-cage.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/scripts/l9-cage.mjs) | `submitOnce()` and `waitLanded()`: send once, never resend blind. `providersFor()`: a Midnight.js 5 provider set that pays contract calls from this kind of wallet |
| [`scripts/mask-stdio.mjs`](https://github.com/Beo-Halfhand/hall-cage/blob/e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614/scripts/mask-stdio.mjs) | masking everything the process writes, including library log lines that bypass your own logger |

Differences from this skill's script:

- hall-cage reads a seed you place in `.wallets/<name>.seed`; it doesn't create one. This script's `init` does.
- hall-cage uses a local proof server; this script defaults to the in-process WASM prover.
- hall-cage has no lock file and accepts only Preprod hosts. This script locks per wallet and accepts preprod or preview, refusing mainnet.
- hall-cage reads its endpoints through its own `endpoints.mjs`. Setting `MIDNIGHT_NODE_WS`, `MIDNIGHT_INDEXER` and `MIDNIGHT_INDEXER_WS` in the shell works there too.

Use the commit link, not `main`: later commits may change these files.
