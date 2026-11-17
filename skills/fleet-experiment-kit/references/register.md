# The register

`register.json` is the copy the scripts read. `register.md` is written from it by `xk.mjs register` (and by `decide`) for people. Edit the JSON.

```json
{ "rows": [ { …row… }, … ] }
```

## A row

| Field | Required | What |
|---|---|---|
| `id` | yes | Short id: lowercase letters, digits, `-`, `_`. Outcomes carry it as `exp` |
| `question` | yes | The question in one sentence, as you'd ask it |
| `change` | yes | What changes, in a few words (the register table's first column) |
| `design` | yes | `concurrent`, `paired`, `shadow` or `single` ([head-to-head.md](head-to-head.md)) |
| `treatment` | yes | Agent keys that get the change |
| `control` | concurrent only | Agent keys left unchanged, same window. Must not overlap `treatment` |
| `metric` | yes | The name of the number outcomes carry (`xp_per_min`, `coins_per_min`, `decision`, `trades`) |
| `bar` | yes | The rule, as data (below) |
| `barText` | yes | The same rule in words, as written on the day. This is what people read |
| `barWrittenAt` | yes | ISO time the bar was written. Must be **before** `liveSince` |
| `liveSince` | when running | ISO time the change went live. `null` while `status` is `logging` |
| `minSample` | yes | The sample the bar needs before it can be judged. Units follow the bar: outcomes per arm, complete pairs, decisions, or **days** for a `count` bar |
| `backstop` | yes | `YYYY-MM-DD`: the latest day you let it run before deciding anyway (end of that UTC day) |
| `status` | yes | See below |
| `notes` | no | `[{ "at": ISO, "kind": "bugfix" \| "design" \| "infra" \| "decision", "text": "…" }]` |
| `source` | no | `{ "type": "fleet-dashboard", "dataDir": "…", "skill": null, "windowMinutes": 60 }`: let the collector measure this row. `dataDir` may be relative to the experiments folder; `skill` limits it to one skill's XP |
| `baseline` | no | `{ "from": ISO, "note": "…" }`: one pinned baseline window, from there to go-live. The collector writes those windows with arm `baseline`; the review prints their median |

## Bars

All fractions: `0.15` means +15%.

| `type` | Design | Fields | Met when |
|---|---|---|---|
| `lift` | concurrent | `min`, optional `lowerBoundAbove`, `stopBelow` + `stopAfter`, `unit`, `allowNegative` | median(T) / median(C) − 1 ≥ `min`, and the bootstrap 5th percentile > `lowerBoundAbove` if set |
| `paired-lift` | paired | `min`, optional `lowerBoundAbove`, `stopBelow` + `stopAfter`, `looks`, `maxSample`, `unit` | the mean of per-pair lifts ≥ `min`, and its one-sided 95% lower bound > `lowerBoundAbove` if set |
| `rate` | shadow, single | `flag`, `max`, optional `none`, `unit` | share of outcomes carrying `flag` < `max`. Any outcome with a flag in `none` turns the row to **STOP** |
| `count` | single, shadow | `min` | confirmed outcomes per week ≥ `min` (the sample is days since go-live) |

`stopBelow` with `stopAfter`: once the sample reaches `stopAfter`, a number at or below `stopBelow` turns the row to STOP. Write it for anything that can hurt: a losing change shouldn't run to its backstop.

`looks`: the sample sizes at which you plan to read the result (`[60, 100, 150]`). The review prints the next one. Reading at planned looks only is what keeps a "keep peeking until it crosses" habit from fooling you. `maxSample`: past it, a bar that hasn't been met is NOT MET (retire the change).

## Statuses

| Status | Meaning |
|---|---|
| `logging` | Registered, collecting a baseline, not live. The review only checks the evidence arrives |
| `running` | Live. The review reads it every day |
| `DECIDED YYYY-MM-DD: KEEP (<number>, <sample>)` | Also `REVERT`, `INCONCLUSIVE`. Written by `xk.mjs decide` |
| `DECIDED YYYY-MM-DD: EXTEND (…)` | Still open: the review keeps reading it. `decide` accepts EXTEND on a short sample |
| `CLOSED YYYY-MM-DD: <reason>` | Ended without a result. The reason stays: "the hook sat on a path never taken" is worth keeping |

## What the register refuses

`xk.mjs register` (and every review) checks each row. A broken row shows as LOOKS WRONG `[register]` until fixed.

- A bar written after the change went live. A bar written after the data is not a bar.
- No bar, an unknown bar type, or a bar that doesn't fit the design (a `lift` bar on a `single` row).
- A concurrent row with no control, or an agent in both groups. A non-concurrent row with a control.
- No minimum sample, no backstop, or a backstop before go-live.
- An agent in two open rows. One experiment per agent, or neither result means anything.
- A running row with no `liveSince`. The same id twice. A status that isn't one of the above.

## Writing a good bar

- **One number, one threshold, written down.** "Replies get better" is not a bar. "Median coins per minute ≥ +3% over 60 paired windows, lower bound above 0" is.
- **Read how the number is computed where it counts.** If the leaderboard ranks an average, a bar on volume (new raters a day) can be met while the rank falls. Check the source's own definition before you write the bar.
- **Say what happens if it fails**, in `barText`: "or revert", "or remove it".
- **Pick the minimum sample from the noise you've seen**, not from the calendar. If one agent does 3 of the thing a day, a 20-event sample is a week, and that's the honest answer.
- **Pin one baseline with its window** (`baseline.from`), the same agents, before go-live. Three baselines for one row make any readout arguable.

## Notes: bug fix or design change?

- **Bug fix** (`kind: "bugfix"`): the change was meant to do X and didn't because of a bug (a wrong time zone, a leak, a broken prompt rule). Fix it at once, log it; **the clock keeps running**.
- **Design change** (`kind: "design"`): you changed what is being tested. **The clock restarts** at the note's time: outcomes before it no longer count toward the bar.
- **Infra** (`kind: "infra"`): an outage or a dependency failing (a helper's store filled up for an hour). Not a treatment effect: say so on the row, and count from the fix.
