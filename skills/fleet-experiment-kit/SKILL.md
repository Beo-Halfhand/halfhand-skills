---
name: fleet-experiment-kit
description: Run AI agents against each other and judge them on outcomes, not impressions. A register where every change gets a row and a bar written before any data; head-to-head setups (treatment vs control at the same time, paired windows with a coin flip, shadow runs); one shared outcome log where only what the world confirmed (a receipt, the sampler's history, a second read) is scored and what an agent claims is shown but never counted; a daily review that reads raw lines and writes OK, LOOKS WRONG, READY TO DECIDE or STOP per row, and pushes repeats to the top; and a gate runner that makes every bar, guard and checker prove it says no to known-bad cases and to mutants before you trust it. Zero dependencies, Node 20+. Reads fleet-dashboard history for free measurement. Use for "is this change to my agent working", "A/B test my agents", "compare two prompts or schedulers on real results", "experiment register", "shadow mode", "my dashboard says it worked, is that true", or "does this check ever reject anything".
---

# fleet-experiment-kit

**What it is.** The discipline for changing agents you run and knowing whether the change worked, packed into one zero-dependency command, [`scripts/xk.mjs`](scripts/xk.mjs), and a few plain files:

| Part | What it does |
|---|---|
| **Register** `register.json` → `register.md` | One row per change you expect to improve something, written **before** it goes live: the question, who gets it and who doesn't, the number that settles it, **the bar**, a minimum sample, a backstop date, a status. The kit refuses rows that break the rules (a bar written after the data, an agent in two experiments, no control). |
| **Outcome log** `outcomes/outcomes-YYYY-MM-DD.jsonl` | Every agent, collector and script writes what happened here, in one format. A number is **confirmed** only with a proof (receipt id, history file, second read). What the agent *says* goes in `claimed`, shown in the review and never scored. |
| **Collector** | Reads [fleet-dashboard](../fleet-dashboard/)'s history files and writes one outcome per agent per hour. Sampling gaps are written as "not measured", never as zero. |
| **Readout** | Turns a row's outcomes into a number against its bar: median lift (with a bootstrap lower bound), paired lift (with a one-sided 95% lower bound and stop rules), a rate (shadow/canary), or a count. A reward guard drops glitched values and **says how many**. |
| **Daily review** `verdicts/<date>.md` | One verdict per open row, with raw lines under it. Two LOOKS WRONG in a row with no decision go to the top as **REPEAT** with a proposed fix. It measures; **it never decides**. |
| **Gates** | Every gate (the kit's own and yours) must show it says **no** to known-bad cases, **yes** to known-good ones, and no to mutants of the good ones. A gate that has never rejected anything is not a filter. |

What a review looks like (from the demo, every agent invented):

```
## REPEAT (LOOKS WRONG two reviews running, no decision)
- **market-helper** LOOKS WRONG again (evidence-empty). **Proposed:** Check that the hook sits on the path where the event really happens…

### 1. tide-table: READY TO DECIDE
bar MET: median xp_per_min +28.6% (T 109.4 vs C 85.1; 95% lower bound +23.0%); 243 T vs 241 C hour windows (min 150)
- Scored: 484. Not scored: 1 dropped by the reward guard (60× the agent's own median), 3 not measured

### 5. barter-board: LOOKS WRONG
the agent reported 5 in the last 24 h, the world confirmed 3; only the 3 are scored [claims]
```

**Not covered:** running or controlling agents (the kit never talks to one; your agents or your driver apply the change and log outcomes), deciding for you, and statistics beyond what a readout needs (medians, a paired mean, a bootstrap bound). It is not a substitute for reading the raw lines.

## When to use

- Someone is about to ship a change to an agent (a prompt, a scheduler, a decision helper, a new rule) and expects it to *improve* something.
- Two versions of an agent, or two agents, should be compared on real results.
- A dashboard number says a change worked and they're not sure they believe it.
- Experiments have been "running" for weeks and nothing has been decided.
- A guard, validator or checker sits in front of something important and nobody has seen it say no.

## Steps

### 1. Try it (no setup)

```sh
node --version                                  # 20 or newer
node <this skill>/scripts/xk.mjs --demo          # an invented harbour crew, five experiments, then the gates
node <this skill>/scripts/selftest.mjs           # expect: selftest: 130 ok, 0 failed (about 5 seconds)
```

The demo builds 7.5 days of fleet-dashboard history and five open experiments in a temporary folder, collects, reviews and runs the gates. Every verdict appears: READY TO DECIDE (bar met), OK (a known issue settled in `decisions.json`), LOOKS WRONG twice (empty evidence, so REPEAT; claims the receipt book doesn't confirm). `--keep <new folder>` keeps it so you can try the other commands on it.

### 2. Make an experiments folder and copy the kit

```sh
cp -R <this skill>/scripts ~/xk && mkdir -p ~/experiments
```

The folder holds `register.json`, `decisions.json`, `outcomes/` and `verdicts/`. Keep it out of anything public: outcomes can hold what your agents did and where.

### 3. Write the row before the change goes live

Add a row to `~/experiments/register.json`. Every field and every rule is in [references/register.md](references/register.md). The bar is the part that matters:

```json
{ "rows": [{
  "id": "tide-table", "question": "Does reading the tide table before choosing a spot earn more?", "change": "Tide table picks the spot",
  "design": "concurrent", "treatment": ["scout-a", "scout-b"], "control": ["scout-c", "scout-d"],
  "metric": "xp_per_min", "bar": { "type": "lift", "min": 0.15, "lowerBoundAbove": 0, "unit": "hour windows" },
  "barText": "median XP per minute ≥ +15% vs control, lower bound above 0, or revert",
  "barWrittenAt": "2026-11-11T09:00:00Z", "liveSince": null, "minSample": 150, "backstop": "2026-11-25", "status": "logging",
  "source": { "type": "fleet-dashboard", "dataDir": "/path/to/fleet-dashboard/data", "windowMinutes": 60 }
}] }
```

```sh
node ~/xk/xk.mjs register --dir ~/experiments     # checks every rule, writes register.md
```

Pick the design ([references/head-to-head.md](references/head-to-head.md)):

| Design | When | Bar type |
|---|---|---|
| `concurrent` | Several agents doing the same work: some get the change (T), some don't (C), same window | `lift` |
| `paired` | One agent, or the arms can't run side by side: windows in pairs, a coin flip picks which arm goes first | `paired-lift` |
| `shadow` | A wrong action is costly: the new rule runs and logs what it *would* do, the old rule acts | `rate` |
| `single` | "Does it get used at all?" | `count` |

### 4. Go live and log outcomes

Set `liveSince` and `"status": "running"` when the change goes live. Then outcomes arrive from one or more of:

- **fleet-dashboard history** (`source.type: "fleet-dashboard"`): run `node ~/xk/xk.mjs collect --dir ~/experiments` on a schedule. Hourly XP-per-minute per agent, with gaps marked.
- **your agent**, from code: `appendOutcome(dir, {…})` from [`scripts/lib/outcomes.mjs`](scripts/lib/outcomes.mjs), or from a shell:

```sh
node ~/xk/xk.mjs log --dir ~/experiments --exp barter-board --agent scout-a --arm T --metric trades --value 1 --proof "receipt B-2207"
node ~/xk/xk.mjs log --dir ~/experiments --exp barter-board --agent scout-a --arm T --metric trades --claimed "sold salt"   # shown, not scored
node ~/xk/xk.mjs arm short-rest 7          # paired rows: which pair and arm window 7 runs ({"pair":4,"arm":"T"})
```

The format and the confirmed-vs-claimed rule: [references/outcomes.md](references/outcomes.md).

### 5. Review every day

```sh
node ~/xk/xk.mjs review --dir ~/experiments [--tz Europe/Lisbon]     # writes verdicts/<date>.md and .json
```

Run it on a schedule (fleet-dashboard's [always-on notes](../fleet-dashboard/references/always-on.md) cover launchd and systemd), then **read it**, including the raw lines. What each verdict means and what to do: [references/review.md](references/review.md). If a finding is known and being handled, add it to `decisions.json` with an `until` date so the review stops repeating it.

### 6. Decide (a person does this)

```sh
node ~/xk/xk.mjs readout --dir ~/experiments tide-table
node ~/xk/xk.mjs decide  --dir ~/experiments tide-table KEEP --why "bar met, raw lines clean"
node ~/xk/xk.mjs decide  --dir ~/experiments market-helper CLOSE --why "hook sat on a path the agents never take"
```

`decide` writes `DECIDED <date>: KEEP (<number>, <sample>)` into the register and refuses to record a decision on less than the minimum sample unless you give `--early "<reason>"` (or the backstop has passed). Reverts, voided weeks and closed rows stay in the register: the no's are as useful as the wins.

### 7. Prove the gates say no

```sh
node ~/xk/xk.mjs gates                                  # the kit's own 10 gates
node ~/xk/xk.mjs gates --gates ~/my-agent/gates.mjs     # plus yours; exit 1 if any gate can't show a "no"
```

Write a gate for anything that lets things through: a receipt check, a reply filter, a spending guard, a validator. [references/gates.md](references/gates.md) has the shape, the mutants and an example ([`scripts/examples/receipt-gate.mjs`](scripts/examples/receipt-gate.mjs)). Run it in CI.

## Rules

1. **The bar is written before the data**, with its time. The register refuses a bar written after go-live.
2. **A control, or a coin.** Concurrent rows have a control group in the same window; paired rows flip a seeded coin inside each pair. Without one, a fleet-wide dip looks like your change failing, or working.
3. **One experiment per agent.** The register refuses an agent in two open rows.
4. **Score what the world confirmed.** Receipts, history files, a second read that agreed. Claims are shown, never counted.
5. **Automate the measurement, never the decision.** The review writes READY TO DECIDE; a person writes KEEP or REVERT.
6. **Read the raw lines every day**, not only the counts.
7. **Decide when the data is ready, not on a date.** Minimum sample plus clean raw lines; the backstop is the latest you'll wait.
8. **Nothing sits.** LOOKS WRONG twice with no decision becomes REPEAT, at the top.
9. **Bug fixes keep the clock; design changes restart it.** Log both as notes on the row.
10. **A gate that has never rejected anything is not a filter.** Every gate shows its "no" on every run.

## Report back

When you set this up for someone, tell them:

- the demo or self-test line, and the gates line (`gates: N ok`);
- each row registered: design, treatment vs control, the bar in words, minimum sample, backstop;
- where outcomes come from for each row (collector, agent code, `log` from a script) and one sample outcome line;
- when the review runs and where verdicts land;
- any gate of theirs that failed, and the case or mutant it let through.

## More

- [references/register.md](references/register.md): every row field, the statuses, the rules the register enforces, writing a good bar
- [references/head-to-head.md](references/head-to-head.md): the four designs, picking groups, paired windows and the coin, shadow vs live
- [references/outcomes.md](references/outcomes.md): the outcome log, confirmed vs claimed, the collector, the reward guard, confirm-before-log
- [references/review.md](references/review.md): the verdicts, each flag and its proposed fix, decisions.json, REPEAT
- [references/gates.md](references/gates.md): gates that must reject: the shape, known-bad cases, mutants, the kit's own gates
- [references/lessons.md](references/lessons.md): the ways experiments on agents go wrong, each one a rule above

## Status

**In development.** Rewritten from the experiment practice of a private agent fleet run daily for about a month: a register, a collector, a daily raw-output review and guards, with every name, number and result replaced by an invented crew. Tested on Node 26, macOS arm64: `selftest.mjs` 130/130 (stats, the outcome log, register rules, the reward guard and confirm-before-log, the coin flip, the collector on hand-made history **and on fleet-dashboard's own demo history**, all four bar types, the review on the demo including STOP, REPEAT and masking, the gate runner failing broken gates, every command). Not yet tried by a fresh agent with only this folder. Not yet run against a live fleet in this form.
