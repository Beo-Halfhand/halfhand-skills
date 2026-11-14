# Reading the report

Every full run writes the same markdown twice: `<report.dir>/latest.md` (always the newest) and `<report.dir>/YYYY-MM-DD.md` (one per day, in `report.timeZone`; a second run on the same day replaces it).

A **partial run** (`--only`, `--no-links`, `--no-cards`, or `--no-fit` with fit on) writes `<report.dir>/partial.md` instead, with `type: page-watch-partial` and `checked_at:`. It never touches `latest.md`, the daily file or `since.json`.

## Front matter

```yaml
---
type: page-watch
ran_at: 2026-11-13T13:40:02.511Z
status: problems            # all-fresh | problems | failed | not-running
updated: 2026-11-13
summary: "3 problem(s): stale, broken-link, link-card"
---
```

A dashboard, a notes app or another script can read `status` and `summary` without parsing the body.

## Body

1. **"Ran at ..."** and the sentence "If this line is more than N h old, page-watch has stopped running." This is the line to glance at: it is how a dead scheduler shows up even if nothing else does.
2. A warning if the run before this one was more than `staleAfterHours` earlier (a missed run).
3. **✅ All fresh** with what was checked, or **⚠ N problem(s)**, grouped by page, each with its kind, words and "since".
4. **Broken links**, each with the pages it's on.
5. **Fit**, if enabled.
6. **Every page**: one table row per page and service: HTTP status, data age or "static" or "service", ✓ or ⚠ and a count.
7. A links line: how many were checked, broken, and couldn't be verified (with their hosts).
8. Notes: console errors, card notes. Not counted as problems.
9. The footer: version, config file name, which browser ran the pages (and whether it was a fallback), and your `report.footer`.

## The other statuses

| status | Written by | Means |
|---|---|---|
| `failed` | a run that crashed (no browser, report folder not writable, ...) | the body is one FAILED line, the time of the last good run, and the retry command. The last good report is still in its dated file |
| `not-running` | `--self-check` or `--auto`, when the last full run is older than `staleAfterHours`. If the latest attempt failed, the self-check exits 1 even when the last good run is recent | a warning at the top of the last report; the rest of it is old. `ran_at` is unchanged, so the warning stays until a full run succeeds |

## Exit codes

| Code | Means |
|---|---|
| 0 | all fresh, or a self-check that found a recent run |
| 1 | problems, a failed run, or a self-check that found no recent run |
| 2 | bad arguments (including `--config` or `--only` with no value), bad config, or `--only` matched nothing; nothing was written |

A scheduler that alerts on non-zero exits works as is.
