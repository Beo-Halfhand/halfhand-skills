# The daily review

```sh
node xk.mjs review --dir <experiments> [--now <ISO>] [--tz <IANA zone>] [--dry]
```

It reads `register.json`, every open row's outcomes, `decisions.json` and the last review's `.json`, and writes `verdicts/<date>.md` (for people) and `verdicts/<date>.json` (for tomorrow's review and for tools). `--dry` prints without writing. The date is the UTC day unless you give `--tz`.

**It measures. It never decides.** The register is never changed by a review.

## The verdicts

One per open row, in this order of priority:

| Verdict | When | What a person does |
|---|---|---|
| **STOP** | A stop rule in the bar fired: a loss past `stopBelow`, or a flag listed in `none` (e.g. one `harmful` disagreement) | Revert now; then `decide … REVERT --early "<why>"` |
| **LOOKS WRONG** | A flag below fired and isn't settled in `decisions.json` | Fix the cause, or settle it with a reason and an end date |
| **READY TO DECIDE** | The minimum sample is in and the raw output reads clean (no flags), or the backstop has passed | Read the raw lines, then `decide` |
| **OK** | On track | Read the raw lines anyway |

Every row shows the bar as written, what was scored and what wasn't (and why), the pinned baseline if any, and the **last raw lines**, masked. Read those: every one of the flags below was found by a person reading lines before it was a rule.

## The flags

Each runs only once a row has been live 24 hours.

| Flag | Fires when | Proposed fix (printed on REPEAT) |
|---|---|---|
| `evidence-empty` | No outcomes in the last 24 h | Check the hook sits on the path where the event really happens, then that the collector runs. Fix it today or close the row with the reason |
| `gaps` | A quarter or more of the last 24 h was not measured | Find why readings stopped. Gaps that hit one arm more than the other bias the comparison |
| `too-clean` | The last 8 or more values of an arm are identical (or all zero) | Suspect the instrument first: a stale read, a snapshot at the wrong moment, a missing field read as 0. Trace one outcome by hand |
| `claims` | 10% or more of the last 24 h's outcomes were claimed but not confirmed | Find where the agent's claims and the world part ways; fix the agent, not the score |
| `volume` | At the current pace the minimum sample won't arrive by the backstop | Give the change more chances to act, or move the backstop on purpose with a note. A bar confirmed on noise isn't a result |
| `register` | The row breaks a register rule | Fix the row; if the fix changes what's tested, add a design note (the clock restarts) |

## Nothing sits: REPEAT

If a row was LOOKS WRONG in the last review for the same flag, and nobody settled it, it goes to the top under **REPEAT** with the proposed fix. A broken measurement is a finding the same day, not a quiet line that scrolls past for a week.

## decisions.json: stop re-flagging what's handled

```json
[
  { "row": "short-rest", "flag": "volume", "status": "KNOWN", "until": "2026-11-20",
    "note": "rest windows only run on market days; move the backstop with a note if 60 pairs aren't in by then" }
]
```

Every entry needs `row`, `flag`, `status` and `until`. It silences that flag on that row until the end of `until`, and the review lists it under "Settled" so it stays visible. An entry without `until` is skipped and reported: "known forever" is how findings rot. The review reads this file and never writes it; people do.

## Reading the review with an assistant

The review is plain Markdown on purpose: an assistant can read it, the register and the raw outcomes, and draft the morning note. Give it the same rule: it can propose fixes and write "READY TO DECIDE", and a person makes the call. If it drafts a decision, the `decide` command still refuses one the sample can't carry.
