# Errors and what to do

All lines below are as the script prints them (masked). Set `DEBUG=1` for the full error object, still masked.

| Message | Cause | Do |
|---|---|---|
| `cannot reach the indexer at <host>` | Wrong URL, no network, or a missing or wrong key | Check the three endpoints and the key; see endpoints.md |
| `no sync progress for 5 min` | The node or indexer websocket is down, refusing us, or a request cap was hit | Check the endpoints and your quota. Raise `SYNC_STALL_MIN` only for a really slow link |
| `API/INIT: Error: FATAL: Unable to initialize the API: disconnected …` or `RPC-CORE … disconnected` at startup | Library log lines from the node connection reconnecting | Harmless if the run goes on and ends with `synced`. Hosts only; paths and keys are masked |
| `not set: MIDNIGHT_NODE_WS, …` | No endpoints in the environment | Create `.env` (SKILL.md step 3) and run with `node --env-file=.env` |
| `refusing: MIDNIGHT_NETWORK must be preprod or preview` | mainnet, or a typo | This tool is for test networks only. Fix the value |
| `refusing: the node host names preview but MIDNIGHT_NETWORK is preprod` | Endpoints from a different network | Use the endpoints that match the network |
| `node: wrong scheme https:` | The node URL must be `ws://` or `wss://` | Use the websocket URL for the node; the indexer one is `https://` |
| `no seed for this wallet: run init first` | Wrong name or folder | Check `DUST_WALLET_DIR` and the name |
| `seed file mode is 644; run chmod 600 on it first` | The seed is readable by others | `chmod 600 .dust-wallet/<name>/seed`, and ask whether it was copied anywhere |
| `wallet is in use by process N: one process per wallet` | Another process has the wallet open | Wait for it to finish. A lock left by a killed process is taken over by the next run once that pid is gone |
| `the saved state belongs to a different seed` | `state.json` was copied from another wallet | Move `state.json` away and sync again |
| `no tNIGHT yet: fund the address …` | Faucet not used yet, or not synced yet | Fund it, wait a few minutes, `balance` |
| `not enough DUST generated for the fee yet; waiting up to N s` | Normal on a first registration | Nothing; it waits and retries by itself |
| `InsufficientDustForFeeError` with an estimate that isn't `Reachable` | The coins can never generate enough for the fee (too little NIGHT) | Get more tNIGHT from the faucet, then `dust --send` again |
| `node refused: … Refused before the pool: nothing spent.` | The node rejected the transaction outright | Read the code with the Midnight status code tables. Run `balance`, then `dust` (dry run) before trying again |
| `node refused: … Custom error: 170` | DUST spend proof built on a state a block behind | Run it again after the next block; it's a new transaction, not a resend |
| `outcome unknown for <id>: it may still land` | The reply was lost and the indexer didn't show it within 90 s | **Don't resend.** Run `balance` in a few minutes: registered coins mean it landed |
| `no spendable DUST after 30 min` | Generation is gradual, or the dust side is behind | Run `balance` later. Raise `DUST_WAIT_MIN` if you want to wait in one go |
| `Failed to decode ledger event payload` (repeating) | A wallet SDK 1.x is reading a Ledger 9 network | Use the pinned versions in `package.json` |
| sync stuck at the same numbers for many minutes | Indexer or node trouble, or a request cap reached | Check the provider's status and your request quota; stop and resume later (the state is saved after each sync) |
