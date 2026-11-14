---
name: dust-wallet
description: Set up a self-funded Midnight wallet that pays its own transaction fees in DUST, on the Ledger 9 stack (wallet SDK 2, ledger-v9). Covers making the seed, the funding address, the faucet, the slow first sync from genesis, registering NIGHT for DUST once, waiting for spendable DUST, and what a call costs. Use it when a Midnight script, agent or service must submit its own transactions on preprod or preview, when a transaction fails for lack of DUST, or when "register for DUST" or "fee wallet" comes up. Refuses mainnet.
---

# dust-wallet

**What it does.** On Midnight, fees are paid in **DUST**, not NIGHT. DUST isn't bought or sent: a wallet's NIGHT generates it once that NIGHT is **registered for DUST generation**, which is one transaction. Until then a fresh wallet holding plenty of tNIGHT still can't pay for anything. This skill walks an agent through a wallet that funds itself: make a seed, fund it from the faucet, sync, register, wait for DUST, and then pay its own fees.

[`scripts/dust-wallet.mjs`](scripts/dust-wallet.mjs) does each step as one command. It is about 300 lines and written to be read.

| Command | Network | What it does |
|---|---|---|
| `init <name>` | no | Makes a 32-byte seed (mode 600, never overwritten) and writes the funding address to a file |
| `address <name>` | no | Writes the funding address again |
| `balance <name>` | yes | Syncs (the first time from genesis), saves state (600), prints tNIGHT, DUST and how many NIGHT coins are registered |
| `dust <name>` | yes | **Dry run**: syncs and shows what registration would do and cost. Sends nothing |
| `dust <name> --send` | yes | Registers the unregistered NIGHT (one transaction, sent once), then waits for spendable DUST |
| `self-test` | no | 18 offline checks: mainnet refusal, masking, lock, seed file mode |

**Not covered:** mainnet (refused by design), shielded transfers, deploying or calling a contract (see [references/cost.md](references/cost.md) for paying a call with this wallet), Lace or 1AM browser wallets (they register DUST in their own UI).

## When to use

- A script, agent or backend must submit Midnight transactions itself, without a browser wallet or anyone else paying the fees.
- A transaction fails with "not enough DUST" (or the SDK's `InsufficientDustForFeeError`), even though the wallet holds tNIGHT.
- Someone asks for a "fee wallet", "gas wallet", "register NIGHT for DUST", or how much a call costs.

## Steps

### 1. Check the setup

```sh
node --version     # 22 or newer
```

You need three endpoints for the network: a **node** (websocket), an **indexer** (GraphQL over https) and the **indexer websocket**. **Preview** has free public ones. **Preprod** goes through Blockfrost and needs a free project token. The URLs, and how to keep a key out of logs and repos, are in [references/endpoints.md](references/endpoints.md). The script has no default on purpose. Starting out? Use Preview.

Optional: a Ledger 9 **proof server**. Without one the wallet proves in-process (WASM), which is slower but needs nothing else.

### 2. Install

Copy [`scripts/`](scripts/) into an empty folder of your project and install the pinned versions:

```sh
cp -R <this skill>/scripts ./dust-wallet && cd dust-wallet
npm install
node dust-wallet.mjs self-test          # expect: self-test: 18 ok, 0 failed
```

Pins (tested together): `@midnightntwrk/wallet-sdk` 2.0.0, `@midnightntwrk/ledger-v9` 1.0.0 (held there with `overrides`), `@polkadot/api` 16.5.6. Don't float them: a wallet SDK 1.x can't read Ledger 9 events at all.

### 3. Put the endpoints in a `.env` and ignore it

```sh
cat > .env <<'EOF'
MIDNIGHT_NETWORK=preprod
MIDNIGHT_NODE_WS=<node wss url>
MIDNIGHT_INDEXER=<indexer https graphql url>
MIDNIGHT_INDEXER_WS=<indexer wss graphql url>
EOF
chmod 600 .env
printf '.env\n.dust-wallet/\nnode_modules/\n' >> .gitignore   # this folder's .gitignore; git applies it inside the folder
```

Run every command as `node --env-file=.env dust-wallet.mjs …`, `init` included (the network decides the address). The script prints only each endpoint's **host**: in everything it writes, library errors included, URL paths and query strings are cut, and addresses and ids are masked. If the indexer can't be reached it stops at once; if a sync makes no progress for 5 minutes (`SYNC_STALL_MIN`) it stops instead of hanging.

### 4. Make the wallet and fund it

```sh
node --env-file=.env dust-wallet.mjs init fees   # "fees" is the wallet's name; use one wallet per job
cat .dust-wallet/fees/address          # mn_addr_preprod1… or mn_addr_preview1… (fine to share: it's where tNIGHT goes)
```

Paste that address into the network's faucet page and press "Request tokens" (URLs in [references/endpoints.md](references/endpoints.md#faucets)). It's a web page with no documented API: if you have a browser tool you can fill it in; otherwise give the user the address and ask them, then wait. Don't hunt for an undocumented faucet API, and if the page shows a human check, hand it to the user.

### 5. First sync

```sh
node --env-file=.env dust-wallet.mjs balance fees
```

The first sync starts from genesis. On **Preprod** it is **slow**: measured in November 2026 at 1 h 40 min to 3 h, most of it the DUST events. On **Preview** (a younger chain, reset on 6 November 2026) it took 65 seconds. Progress prints every 30 s. Let it finish; later syncs restore from `state.json` and take seconds to minutes. The script waits for "synced" twice on a fresh wallet, because the first "synced" can fire before the DUST side has caught up. A wallet that reads as unregistered after a too-early "synced" could register a second time.

Run it in the background or a terminal multiplexer if your agent's commands time out. Don't start a second process on the same wallet: the lock refuses it.

When it prints a tNIGHT balance above 0 (the Preprod faucet gave 5,000 per request in November 2026), the funding has landed. If it still reads 0, wait a few minutes and run `balance` again.

### 6. Register NIGHT for DUST (once)

Dry run first. It sends nothing:

```sh
node --env-file=.env dust-wallet.mjs dust fees
# 1 NIGHT coin(s) not registered · registration fee about 0.xxx DUST … dry run: nothing sent
```

Then send:

```sh
node --env-file=.env dust-wallet.mjs dust fees --send
```

- The registration pays its own fee from the DUST the NIGHT has generated so far. If that isn't enough yet, the script waits (the SDK says how long) and then registers.
- The transaction is sent **once**. If the reply is lost, the script asks the indexer instead of resending. "Outcome unknown" means run `balance` before doing anything else, never resend blind.
- Running `dust --send` again later is safe: registered coins are skipped. Only new NIGHT coins (a later faucet drop) get registered.

### 7. Wait for spendable DUST

`dust --send` waits up to 30 minutes (`DUST_WAIT_MIN`) for DUST to show, then prints `DUST READY` with the balance. DUST counts from when the NIGHT coin was created, not from the registration, so a coin that has sat for a while has DUST at once. On Preview, a 5,000 tNIGHT coin a minute old read 2.6 DUST right after its registration landed, and grew by about 0.041 DUST a second after that, towards a cap of 5 DUST per NIGHT.

### 8. Pay for calls

The wallet now pays its own fees. Measured on Preprod: **about 0.3 DUST per contract call**. Yours will differ by circuit and transaction size, so measure your own (how: [references/cost.md](references/cost.md)). `balance` prints "about N calls" using 0.3; set `DUST_PER_CALL` to your measured number.

## Safety rules

1. **Never print, paste or commit the seed.** It is the wallet. The script never prints it. Don't `cat` it, don't send it to a chat or a model, don't copy it into `.env`.
2. **Never use this on mainnet.** The script refuses `MIDNIGHT_NETWORK=mainnet` and any endpoint naming mainnet. Don't remove the check.
3. **One process per wallet.** Two processes on one wallet book the same coins twice and fail in confusing ways. The lock stops this; don't delete a lock that belongs to a live process.
4. **One wallet per job.** A fee wallet for a service shouldn't also be someone's player wallet. Separate names, separate seeds.
5. **Send once; read before any retry.** After an unclear submit, run `balance`. A resent transaction can double-spend your DUST booking or land twice.
6. **Keep `.dust-wallet/`, `.env` and `node_modules/` out of git.** Check with `git status --ignored` before the first commit. The address file is safe to share; the seed and state are not.
7. **Endpoints with a key are secrets.** A hosted provider's project id in the URL is a credential. Keep it in `.env` and out of logs (the script masks it), screenshots and issues.

## Report back

Tell the user:
- the network and the wallet's name (not the seed, and say where the address file is rather than pasting the address unless they ask);
- tNIGHT, DUST, and NIGHT coins registered, from the last `balance`;
- whether a registration was sent, its transaction id prefix, block and status;
- how long the first sync took;
- anything that failed, with the masked error line.

## More

- [references/flow.md](references/flow.md): what happens at each step, the states, and timings.
- [references/errors.md](references/errors.md): errors and what to do.
- [references/cost.md](references/cost.md): fees, measuring cost per call, paying a contract call from this wallet.
- [references/endpoints.md](references/endpoints.md): node, indexer, proof server.
- [references/hall-cage.md](references/hall-cage.md): the same pattern in a public, working project (pinned commit).

Tested on: `@midnightntwrk/wallet-sdk` 2.0.0, `@midnightntwrk/ledger-v9` 1.0.0, `@polkadot/api` 16.5.6, Node 26 (22 is the floor the packages need; not tested on 22), macOS arm64. Full live run on **Preview** (Ledger 9, 13 November 2026): init → faucet → sync → `dust --send` → DUST READY. On **Preprod**, only the timings above were measured, with the same wallet SDK in another project; this script's own Preprod run is pending. Status: in development.
