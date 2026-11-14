# Endpoints

The script needs three, for the same network:

| Variable | What | Scheme |
|---|---|---|
| `MIDNIGHT_NODE_WS` | A Midnight node's RPC websocket. Used for the relay (sending) and for the node's metadata | `wss://` (or `ws://` locally) |
| `MIDNIGHT_INDEXER` | The Midnight indexer's GraphQL endpoint | `https://` (or `http://` locally) |
| `MIDNIGHT_INDEXER_WS` | The same indexer's GraphQL websocket. The wallet syncs over it | `wss://` (or `ws://`) |
| `MIDNIGHT_PROOF_SERVER` | Optional. A Ledger 9 proof server | `http://host:port` |

There is no default and no public fallback in the script. That is deliberate: a script that quietly falls back to some public endpoint can end up on the wrong network or a dead host without saying so.

## Where to get them

As published in Midnight's "Networks and environments" docs in November 2026. Check there first: public endpoints have moved and been retired before (Midnight's own Preprod and Mainnet hosts were retired on 9 October 2026).

**Preview: Midnight-hosted, no key.**

```sh
MIDNIGHT_NETWORK=preview
MIDNIGHT_NODE_WS=wss://rpc.preview.midnight.network
MIDNIGHT_INDEXER=https://indexer.preview.midnight.network/api/v4/graphql
MIDNIGHT_INDEXER_WS=wss://indexer.preview.midnight.network/api/v4/graphql/ws
```

**Preprod: served by Blockfrost, with a project token.** Create a *Midnight Preprod* project on blockfrost.io and append your token to each URL:

```sh
MIDNIGHT_NETWORK=preprod
MIDNIGHT_NODE_WS=wss://rpc.midnight-preprod.blockfrost.io?project_id=<your token>
MIDNIGHT_INDEXER=https://midnight-preprod.blockfrost.io/api/v0?project_id=<your token>
MIDNIGHT_INDEXER_WS=wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=<your token>
```

A Preprod token doesn't work on Mainnet and the other way round. Free plans have a daily request cap: see "Keys in URLs" below.

**Your own.** A node plus an indexer you run. Local URLs (`ws://127.0.0.1:…`) are fine.

## Faucets

| Network | Faucet page |
|---|---|
| preview | https://midnight-tmnight-preview.nethermind.dev/ |
| preprod | https://midnight-tmnight-preprod.nethermind.dev/ |

They're web pages with no documented API: paste the address, press "Request tokens". An agent with a browser tool can do it; otherwise ask the user. The Preview faucet had no human check when we tested it.

## Keys in URLs

A provider's project id in a URL is a **credential**. Treat the whole URL as a secret:

- Keep it in `.env` (mode 600), listed in `.gitignore`. Never in code, a README, an issue, or a screenshot.
- The script prints only the host and masks `project_id=`, `api_key=`, `key=`, `token=`, `secret=` query values, `user:pass@` and bare provider ids in all output, library errors included. Other tools you run alongside it might not.
- Watch your request quota. A first sync from genesis makes many requests. If several jobs share one key, give the sync a quiet time of day, or ask the provider for a second key.

## Proof server

Without `MIDNIGHT_PROOF_SERVER`, the wallet proves in-process with WASM. That needs no server, and was enough for registration and for small contract calls in our runs. For heavier circuits, or many calls, run a proof server whose version matches the network's ledger (Ledger 9 at the time of writing) and point the variable at it.
