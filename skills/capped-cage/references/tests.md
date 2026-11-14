# Running hall-cage's tests offline

[`scripts/run-cage-tests.mjs`](../scripts/run-cage-tests.mjs) clones the public repo at the pinned commit and runs its tests in the Compact simulator. It talks to GitHub (clone) and the npm registry (install), and nothing else: no Midnight node, no indexer, no wallet, no keys.

## Needs

| Tool | Version | Check |
|---|---|---|
| git | any | `git --version` |
| Node | 22 or newer (checked with 26) | `node --version` |
| pnpm | **10** (checked with 10.32.1); the script refuses another major | `pnpm --version`; if missing, `corepack enable`; to pick 10, `corepack use pnpm@10` |
| Compact compiler | **0.31.1** as the default | `compact compile --version`; to set it, `compact update 0.31.1` |

The pinned builds need 0.31.1 because hall-cage's deployed verifier keys came from it, and its `contracts/package.json` pins compact-runtime 0.16.0 to match. A newer compiler may compile, but then you're no longer testing what's deployed, so the script refuses.

## Run

From your own work folder (the clone goes where you say, so not inside the skill):

```sh
node <this skill>/scripts/run-cage-tests.mjs <empty or missing folder>              # every test
node <this skill>/scripts/run-cage-tests.mjs <same folder> --attacks                 # attacks, attacks-cage3, permit, cage
```

Unknown options stop it with exit 2 before anything runs. Run it again on the same folder to skip the clone. It still checks `HEAD` is the pinned commit and that the clone has no local changes.

## What passing looks like

Fresh clone, 13 November 2026, Node 26.12.1, pnpm 10.32.1, Compact 0.31.1, macOS arm64:

| Step | Time | Result |
|---|---|---|
| clone + checkout `e5ce2d1` | a few seconds | `HEAD e5ce2d1f2a65…` |
| `pnpm install --frozen-lockfile` | 2 s here, with packages already in the pnpm store. Expect a minute or more on a machine that has never installed them | |
| `npm run compile:all` | 30 s | cage v4b, dice-proof, cage #3 (`--skip-zk`) |
| every test | 53 s | `tests: 381 passed, 0 failed, 0 skipped, of 381` |
| `--attacks` | 8 s (the compile step is the same) | `tests: 110 passed, 0 failed, 0 skipped, of 110` |

The counts include subtests, as Node's test runner reports them. The last line is `PASS: hall-cage e5ce2d1, ...` and the exit code is 0. A skipped test fails the run: `attacks-cage3` skips itself if cage #3 wasn't compiled, and a run that skips it no longer proves the attack tests have teeth.

pnpm may print "Ignored build scripts: ..." for native modules. That's fine: the tests don't use them.

## When it fails

| Message | Do |
|---|---|
| `FAILED: the default Compact compiler is X; the pinned builds need 0.31.1` | `compact update 0.31.1`, or switch back after with `compact update <your version>` |
| `FAILED: pnpm not found` | `corepack enable` (ships with Node) |
| `FAILED: <folder> is not empty and not a clone` | use a new folder |
| `FAILED: the clone has local changes` | use a new folder; don't edit the pinned clone |
| `FAILED: commit ... not found` | the network blocked the clone part-way, or the repo moved; try again |
| `FAILED: pnpm X: the lockfile at the pin is pnpm 10's` | `corepack use pnpm@10`, or install pnpm 10 |
| `FAILED: some tests were skipped` | the `skipped:` lines say why; usually a compile step that didn't write its output. Use a fresh folder |
| `FAILED: ...: ETIMEDOUT` | a step ran over 15 minutes; check the machine isn't swapping, then try again |
| `not ok: ...` lines, then `FAILED: some tests failed` | Note which. A test named `attack` or `F5` failing means the cage's guarantee doesn't hold on your setup: report it with your tool versions |
