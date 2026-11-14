# Halfhand skills

Skills for AI coding agents, from the builds at [halfhand.dev](https://halfhand.dev). A skill is a folder an agent reads and follows: `SKILL.md` (when to use it, the steps, the safety rules), plus `references/` and sometimes small scripts. Each one has been run end to end before it's listed as released.

When a skill needs a real tool, the tool lives in its own repo and the skill points to it at a pinned tag. The skill doesn't copy the code.

## Skills

### Any builder

| Skill | What it does | Status | Tested on |
|---|---|---|---|
| [fit-check](skills/fit-check/) | Checks pages at nine widths for words split mid-word, overflowing or clipped text, sideways scroll and page errors, and explains the fixes | tested (11-12) | fit-check v0.1.3, Node 26, macOS arm64 |
| [page-watch](skills/page-watch/) | A scheduled check of your public pages: data age against each page's max, HTTP, broken links, page errors, link cards, optional fit, JSON services. One markdown report that says what broke and since when, and never fails silently | in development | playwright-core 1.64.1, Node 26, macOS arm64 |
| [prepublish-leak-check](skills/prepublish-leak-check/) | Checks files and git history for keys **and** setup details (home paths, hostnames, private IPs, personal emails, real names in commits) before anything leaves the machine. The same rules this repo's CI runs | in development | Node 26, gitleaks 8.30.1, macOS arm64 |

### Midnight builders

| Skill | What it does | Status | Tested on |
|---|---|---|---|
| [dust-wallet](skills/dust-wallet/) | A wallet that pays its own fees: seed, faucet, the slow first sync, registering NIGHT for DUST once, waiting for spendable DUST, cost per call. Preprod and preview; refuses mainnet | in development | wallet SDK 2.0.0, ledger-v9 1.0.0, Node 26, Preview (Ledger 9); Preprod pending |
| [capped-cage](skills/capped-cage/) | Design or review a contract that holds other people's funds next to an operator key: the invariants of the public hall-cage cage (one deposit, a capped permit, rescue only to the bound address, exits nobody can block) and the attack tests that prove them. Offline | in development | hall-cage e5ce2d1, Compact 0.31.1, Node 26, simulator only |
| [sealed-count-proof](skills/sealed-count-proof/) | Parties seal private values on chain and later prove a count over them without showing them; the chain adds the counts. The public hall-cage dice proof explained (the seal, randomness nobody can grind, the proof circuit, silence), plus an example contract and a test kit: cheats refused by the circuit, not just the app, a privacy scan and a mutant sweep. Offline | in development | hall-cage e5ce2d1, Compact 0.31.1, compact-runtime 0.16.0, zkir-v2 2.2.0, Node 26, simulator only |

### Midnight City players

| Skill | What it does | Status | Tested on |
|---|---|---|---|
| [city-driver-starter](skills/city-driver-starter/) | A first driver for your own City agent: read the City, pick a job, act once, step aside when you write a PAUSE file, and log only what the City confirmed. Runs on the City's own direct-control skill, no dependencies. A local model or any AI can write journal lines from facts; it never presses a button | in development | City direct-control skill 2026-11-06, Node 26, macOS arm64, a fake City (not yet a live agent) |

Status means: **in development** (being written), **tested** (a fresh agent with only the folder did the task), **released** (tested, leak-checked and public).

## Install

**Claude Code** (this repo is also a plugin marketplace):

```text
/plugin marketplace add Beo-Halfhand/halfhand-skills
/plugin install halfhand@halfhand-skills
```

**Any other agent:** copy the skill's folder from `skills/` to wherever your agent reads skills or instructions, or point it at the folder's `SKILL.md`.

## Checks

`node tools/check.mjs` lints every `SKILL.md` (frontmatter, name matches folder, links resolve) and checks the tree for secrets and setup details with the [prepublish-leak-check](skills/prepublish-leak-check/) rules. CI runs it with gitleaks on every push.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Found a skill that misled your agent? See [CONTRIBUTING.md](CONTRIBUTING.md).
