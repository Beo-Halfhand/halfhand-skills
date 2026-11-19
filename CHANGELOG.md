# Changelog

What changed in each release of the `halfhand` plugin and its skills. Versions follow the plugin version in `.claude-plugin/plugin.json`. Releases are tagged from `v0.7.0` on.

## 0.8.0 (2026-11-19)

One new skill, **in development**. It runs its own self-test in CI.

### Added

- **honest-agent-guards**: honesty checks in front of a talking agent's send. Every line is checked against a banned list in a markdown file you edit while the agent runs (claims no agent may make, and place names that must be on your map), and against the agent's own state: a level, count or piece of gear it claims must be what it really has, and it may only say it does what it really does (no invented crafting, trading, owning, other skills or weather). A refused line gets one redraft with the reason, then the bad sentences are dropped, else nothing is sent. Zero dependencies; `check`, `scan` and `list` on the command line. Checked against 2,034 lines a Midnight City fleet really sent.

### Changed

- CI runs honest-agent-guards' self-test after city-driver-starter's.
- The plugin and marketplace descriptions list all 14 skills. New keyword: `honesty`.

### Fixed

- Two misses in the claim checks this skill was ported from, fixed here before release: a sentence that starts with "My" ("My mining is level 30.") is first person, and "mining" is no longer read as the requirement word "min.", so a wrong level after it is caught. The self-test checks both.
- fleet-dashboard: the demo's agent that went offline early had no "last thing done" in 59 of the day's 1,440 minutes (a few minutes after the half hour, at some hours UTC), and the self-test failed then. The demo now always gives it the sale it made before it stopped. A self-test check pins one of those minutes (176 checks).

## 0.7.0 (2026-11-18)

Six new skills, all **in development** (see the status key in the README). Each runs its own self-test in CI.

### Added

- **fleet-dashboard** (its own version 0.2.0): one private page for every agent you run. A card per agent with its status light and the reason for it, its job and one number for it, what it's doing, where it is, the last thing it did and a 6-hour graph by skill. Retired agents are never read and get no card, only a name in a grey strip. Details has a map, a 24-hour graph and a masked log. Also an "Asks for you" inbox and a phone layout. Zero dependencies, localhost only, read-only toward agents. `--demo` runs a made-up fleet.
- **safe-logs**: one mask for secrets in what programs print and save. It works inside a Node process, as a pipe around any program, or as masked daily log files. It fails closed.
- **mirrored-workspace**: a terminal workspace an AI can read. One tmux tab per job, each one logged, plus a snapshot of every pane every minute. Everything is masked by safe-logs before it reaches disk, and nothing is written if the masker can't run.
- **agent-owner-controls**: four owner controls through plain files: pause with an end time, ask the owner, "while you were away" notes, and one policy file checked before every action. It shares fleet-dashboard's asks inbox.
- **fleet-experiment-kit**: run agents against each other and judge them on outcomes the world confirmed. It has a register written before the data, head-to-head designs, a daily review, and gates that must show they reject known-bad cases.
- **agent-memory-vault**: a memory vault any assistant can use, made of markdown notes you own. It comes with one-command setup and a checker that fails on secrets, unsigned lines and broken links.

### Changed

- **dust-wallet**: package pins raised to wallet SDK 2.0.1 and ledger-v9 1.0.2 (the Midnight.js 5.0.1 patch set). Only the self-test was rerun on the new pins. SKILL.md says what wasn't.
- **fleet-dashboard**, **safe-logs**: "Tested on" now includes Node 22 on Debian 12 (a fresh-agent test).
- CI (`.github/workflows/check.yml`) runs the self-tests of all six new skills, plus fleet-experiment-kit's gates, before gitleaks.
- The plugin and marketplace descriptions list all 13 skills. New keywords: `memory`, `terminal`.

### Fixed

- fleet-dashboard: an expired PAUSE file no longer shows a yellow light. agent-owner-controls' self-test checks this.
- Fixes from fresh-agent tests on Linux for fleet-dashboard, safe-logs, mirrored-workspace, agent-owner-controls and agent-memory-vault.

### Notes

- Some branches had raised the version to 0.8.0 on their own before release. Neither 0.7.0 nor 0.8.0 was published before this, so the public version goes from 0.6.0 to 0.7.0.
- To update an installed copy in Claude Code: `/plugin marketplace update halfhand-skills`.

## 0.6.0 (2026-11-14)

First public release, with seven skills: fit-check, prepublish-leak-check, dust-wallet, capped-cage, sealed-count-proof, page-watch and city-driver-starter. Not tagged.
