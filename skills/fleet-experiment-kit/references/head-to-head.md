# Head-to-head: four designs

Every design answers "compared to what?". Pick the one that fits the agents you have, not the one that sounds most rigorous.

## concurrent: treatment vs control, same window

Some agents get the change (T), others doing the same kind of work don't (C), and both run in the same hours. Anything that hits everyone (a server change, a quiet weekend, a game patch) hits both groups, so the difference is the change.

- **Pick groups that do the same work** at the same pace before the change. If you have no reason to put an agent on either side, split at random: `splitGroups(agents, seed)` in [`scripts/lib/arms.mjs`](../scripts/lib/arms.mjs).
- **Leave the control alone.** Back up its config and don't "just fix one thing" on it mid-run.
- **Keep other experiments off all of them.** The register enforces this.
- **Bar:** `lift` on the medians. Medians, because agents have bursty output and one wild hour shouldn't decide anything.
- **With fleet-dashboard:** set `source` and the collector writes one outcome per agent per hour (XP per minute). That's the whole measurement.

## paired: one agent, windows in pairs, a coin decides the order

When there's only one agent that can run the change, or the arms can't run side by side, alternate: each pair is one window with the old rule (C) and one with the change (T). A **coin flip inside each pair** picks which goes first, so a time-of-day effect can't line up with one arm.

```js
import { armForWindow } from './lib/arms.mjs';
const { pair, arm } = armForWindow('short-rest', windowNumber);   // window 1, 2 → pair 1; 3, 4 → pair 2 …
// … run the window with `arm`'s rule, then log one outcome with { arm, pair }
```

The flip is a hash of the row id and pair number (plus an optional seed), so the agent and the review always agree on it, and nobody can re-roll a pair they didn't like. From a shell: `node xk.mjs arm short-rest 7`.

- A window that couldn't be measured (restart, outage) is logged `ok: false` with a `why`. Its pair is incomplete and doesn't count.
- **Bar:** `paired-lift`: the mean of per-pair lifts with a one-sided 95% lower bound. Add `stopBelow`/`stopAfter` so a losing change stops early, `looks` for planned reads, and `maxSample` to give up.
- Under about 20 pairs the bound is rough; the readout says so.

## shadow: the new rule decides, the old one acts

The new logic runs on every real decision and logs what it **would** have done next to what the old logic **did**. Nothing changes in the world. Log one outcome per decision with flags: `disagree` when they differ, `fallback` when the new rule failed and the old one was used, `harmful` when the new rule's choice would have done damage.

- **Bar:** `rate`, e.g. fallback under 1% and **no** `harmful` over 500 decisions. A `harmful` flag turns the row to STOP at once.
- When the bar is met, go live with the old rule kept as the fallback, and keep logging.

**When is shadow worth it?** When a wrong action is costly or can't be undone: spending, anything public an agent says, anything touching money or someone else's things. **Skip shadow for cheap, reversible changes**: go live with a fallback to the old rule and watch the raw lines. Shadow on something cheap only delays the data.

**A dry run can't test exploration.** A shadow of a rule that tries new options never sees what the new options pay: it can only ever say "untried". If the point of the change is to find something new, the test has to be live (with a stop rule).

## single: does it happen at all?

Some changes are "a helper the agent can call" or "a board it can post on". Before asking whether it helps, ask whether it's used. One agent, a `count` bar: "≥ 10 helper calls a week, or remove it". If the answer is zero, look at where the hook sits before anything else: a helper on a path the agent never walks gets zero calls and proves nothing about the helper.

## Don't

- **Mix experiments on one agent.** Two changes, one result: you can't tell which did it.
- **Compare against last month.** A "before" from another period carries every other change since. Use a control or pairs; keep the pinned baseline as context, not as the comparison.
- **Pick the control after looking at the data.**
- **Judge a volume-starved arm.** An agent that does the thing once in five hours gives noise. Fix volume first; the review flags it.
