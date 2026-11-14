# page-watch skill

Teaches an AI agent to set up a scheduled check of a site's public pages: data age against each page's declared max, HTTP status, broken links, page errors, link cards, optional fit-check, and JSON services. It writes one markdown report that says "All fresh" or what is broken **and since when**, and never fails silently.

| File | For |
|---|---|
| `SKILL.md` | The agent: when to use it, the steps, the safety rules, what to report |
| `scripts/watch.mjs` | The run: `--now`, `--auto` (for a scheduler), `--self-check`, `--check-config` |
| `scripts/card.mjs` | The link card check |
| `scripts/fresh.js` | For your site: makes a live-data page say how fresh it is |
| `scripts/example.page-watch.config.json` | A config to copy |
| `scripts/selftest.mjs` | 61 checks, most against a small site it serves on 127.0.0.1 (`--offline`: 36 without a browser) |
| `scripts/package.json` | The pinned playwright-core |
| `references/config.md` | Every config field |
| `references/freshness.md` | The heartbeat, the meta tags and fresh.js |
| `references/checks.md` | What each check does and counts as a problem |
| `references/report.md` | Reading the report, statuses, exit codes |
| `references/schedule.md` | cron, launchd, systemd, GitHub Actions |
| `references/errors.md` | Errors and what to do |

**Needs:** Node 20+, and Chromium for playwright-core (one command installs it). No account, no keys.

**Status:** in development. See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
