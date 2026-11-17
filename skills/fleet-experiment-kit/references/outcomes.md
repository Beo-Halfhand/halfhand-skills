# Outcomes: one log, scored on what happened

## The format

`<experiments>/outcomes/outcomes-YYYY-MM-DD.jsonl` (UTC day), one JSON line per outcome, mode 600:

```json
{"t":1763380800000,"v":1,"exp":"tide-table","agent":"scout-a","arm":"T","metric":"xp_per_min","value":109.4,"confirmed":true,"proof":"fleet-dashboard history"}
{"t":1763384400000,"v":1,"exp":"short-rest","agent":"scout-e","arm":"C","pair":12,"metric":"coins_per_min","value":4.31,"confirmed":true,"proof":"market receipts M-4012"}
{"t":1763388000000,"v":1,"exp":"pantry","agent":"scout-f","arm":"T","metric":"decision","value":1,"flags":["disagree"],"confirmed":true,"proof":"shadow log"}
{"t":1763391600000,"v":1,"exp":"barter","agent":"scout-g","arm":"T","metric":"trades","value":1,"confirmed":false,"claimed":"sold salt for 9 coins"}
{"t":1763395200000,"v":1,"exp":"short-rest","agent":"scout-e","arm":"T","pair":13,"metric":"coins_per_min","ok":false,"why":"restarted mid-window","confirmed":false}
```

| Field | What |
|---|---|
| `t` | ms. The start of the window, or the moment of the event. Never in the future |
| `exp` | The register row's id. `xk.mjs log` refuses an id that isn't registered: bar first |
| `agent`, `arm` | Agent key; `T`, `C` or `baseline` |
| `metric`, `value` | The number. A missing value is not a zero: leave it out only with `ok: false` |
| `confirmed`, `proof` | Always present. `true` needs a `proof` naming where the number came from |
| `claimed` | What the agent said, when the world hasn't confirmed it |
| `pair` | Paired rows: the pair number from `armForWindow` |
| `flags` | Shadow and canary rows: `disagree`, `fallback`, `harmful`, or your own words |
| `ok: false`, `why` | A window that couldn't be measured. Counted as "not measured", never scored |

Writing: `appendOutcome(dir, rec)` from [`scripts/lib/outcomes.mjs`](../scripts/lib/outcomes.mjs) checks every rule and throws on a bad record, or `xk.mjs log` from a shell. Reading: `readOutcomes(dir, { exp, from, to })`.

## Confirmed vs claimed

The scorer counts an outcome only when `confirmed` is `true`, a `proof` is given, it was measured, and the value is a number. That's `scoreable()`, and it's one of the kit's gates, so it has to show it says no every run.

What counts as proof is the world's own record, not the agent's report of it:

- a receipt, order or transaction id you can look up (and a gate that looks it up: [gates.md](gates.md));
- the game's or service's own counters, read by a sampler (fleet-dashboard's history);
- a second read of a polled value that agreed with the first (below);
- a log line written by the system that performed the action, not by the agent describing it.

An agent that says "sold 10 nets" before the sale settles, or counts a retry twice, inflates a claimed score and leaves a confirmed one honest. The review shows both: "the agent reported 5, the world confirmed 3; only the 3 are scored". The gap is a finding in its own right: fix the agent, not the score.

## The collector (fleet-dashboard history)

fleet-dashboard's sampler writes `<dataDir>/history/samples-YYYY-MM-DD.jsonl`, one line per round with each agent's running XP totals per skill. `xk.mjs collect` reads those files (it never writes to them) and, for each agent in an open row with `source.type: "fleet-dashboard"`, cuts time into windows (`windowMinutes`, default 60) and writes one outcome per window: the gain per minute.

The same rules as the dashboard's graphs:

- A window is measured only when readings bracket it and no two readings inside it are more than 15 minutes apart. Otherwise it's written `ok: false, why: "sampling gap"`. **A gap is never a zero.**
- A falling total (a reset) adds nothing.
- A window that straddles go-live belongs to neither side and is left out. Windows before go-live, from `baseline.from`, are written with arm `baseline`.
- The newest window waits 15 minutes for its closing reading. A second run writes nothing it already wrote.

Run it on the same schedule as the review, or more often.

## The reward guard

Before a `lift` or `paired-lift` readout, every value goes through `rewardGuard()` ([`scripts/lib/guard.mjs`](../scripts/lib/guard.mjs)). It drops:

- any value more than **10 ×** that agent's own median for that metric (once it has 3 or more values): one glitched reading (a total that jumped and fell back, a duplicated block) must not carry a result;
- negative values, unless the bar sets `allowNegative`;
- anything that isn't a number.

Every drop is counted and named in the review ("1 dropped by the reward guard (60× the agent's own median)"). A guard that drops silently hides the thing you most need to see.

## Confirm before you log a polled value

Leaderboards, standings and stats endpoints are often served from several copies that aren't in sync. A value can go A → B → A within minutes. If your agent logs every change it sees, half its "changes" can be flips.

```js
import { confirmReading } from './lib/guard.mjs';
const state = loadState();                                   // persist between polls
const change = confirmReading(state, 'score:scout-a', await readScore(), Date.now());
if (change) appendOutcome(dir, { …, value: change.to, confirmed: true, proof: `two reads agreed (first seen ${new Date(change.firstSeen).toISOString()})` });
```

A new value is a candidate until the next read agrees (`need`, default 2; raise it if a stale copy can answer twice in a row). A → B → A is counted in `state[key].flaps` and never logged. The flap count tells you how unreliable the source is. When you fix a reader, everything logged before the fix is unconfirmed: say so in a row note.
