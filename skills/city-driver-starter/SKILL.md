---
name: city-driver-starter
description: Set up a first driver for your own Midnight City agent, a small loop on your machine that reads the City, picks a job, acts, steps aside when you write a PAUSE file, and logs only what the City confirmed. It runs on top of the City's own direct-control skill, with no dependencies. An optional local model (or any AI with an OpenAI-style API) writes a journal line from facts and never presses a button. Use for "run my City agent on its own", "my first driver", "keep my agent gathering", "pause my agent", "my agent is idle", or before writing a bigger bot.
---

# city-driver-starter

**What it is.** A starter loop for one Midnight City agent that you own: [`scripts/driver.mjs`](scripts/driver.mjs), about 330 lines of Node with no dependencies. Every tick it does five things in order:

1. **Respect PAUSE.** If a `PAUSE` file is in its folder, it stops work, hands control back, writes `RELEASED`, and sends nothing until the pause ends.
2. **Read the City:** `context`, `needs`, `inventory`, `merchants`, and `progression` when it needs a job.
3. **Pick one thing:** wait while the agent is mid-action, eat, buy food (selling first if it must), sell when loaded, or start a job from your list.
4. **Act once** through the City's own helper, and read the outcome. A `pending` action isn't sent again until something changes; an action that fails 3 times in a row is rested for 10 ticks.
5. **Log honestly:** one JSON line per decision with the City's own outcome (`confirmed`, `pending`, `failed` and why). Gains are logged when the next read **measures** them, never assumed.

Code makes every game decision. A model, if you add one, only writes words.

**Not covered:** talking to other agents, fighting, crafting, quests, groups, events, sending crystals and the owner allowance. The driver never does any of these. Making an account and an agent is the City's skill's job (step 1). Running many agents isn't covered either: this is one agent, one driver, one folder.

## When to use

- You have a Midnight City agent in "own AI" (self-hosted) mode and want it to keep working while you're away.
- You want a loop you own and can read, which survives the City's skill updating itself.
- Your agent sits idle, starves, or stops when its bag is full.
- You're about to write a bigger bot and want the safe skeleton first: PAUSE, honest logs, one action at a time.

If you only need a timed run, the City's skill has its own packaged runners (`scripts/mcity-work.mjs`, `scripts/mcity-behavior.mjs`; see the Resource Work and Behaviors sections of its `SKILL.md`). Use those for "gather for 30 minutes". Use this starter when you want your own loop and your own rules.

## Steps

### 1. Install the City's direct-control skill and get an agent

Follow the City's guide: [Connect to Midnight City (Hermes / OpenClaw)](https://midnight.city/docs/connect-to-midnight-city/hermes-openclaw/). You end up with a folder named `midnight-city-direct-control`, wherever your framework keeps skills, holding `scripts/mcity-control.mjs` and a `.env` with your observer URL and API token. Check it works from inside that folder:

```sh
node scripts/mcity-control.mjs claimable        # lists the agent ids your token can drive
```

**That skill is the City's, and it replaces its own `scripts/` and `references/` when it updates.** Keep the driver in its own folder, anywhere **outside** it. The driver doesn't read your `.env` or your token; the City's helper does.

### 2. Make the driver folder

Anywhere you like, for example in your home folder:

```sh
mkdir ~/my-driver && cd ~/my-driver
cp <this skill>/scripts/driver.mjs .
cp <this skill>/scripts/pause.mjs .
cp <this skill>/scripts/driver.example.json driver.json
node --version                                   # 20 or newer
```

Edit `driver.json`:

| Field | What it does |
|---|---|
| `skillDir` | **Full path** to the City's skill folder, e.g. `"~/<your skills folder>/midnight-city-direct-control"` (`~/` works). A relative path is taken from this folder. Read once, at start |
| `agentId` | Your agent's id from `claimable`. Needed for `--dry-run`. Read once, at start |
| `mode` | `"gather"`: gather a source from `jobs`. `"work"`: the agent's profession work (`work`) |
| `jobs` | Source ids in order of preference, from `node scripts/mcity-control.mjs progression <agentId>` → `capabilities.sources[].sourceId`. The driver picks the first one with no `failureReason`. Empty list: the first open source |
| `keep` | Item ids never to sell (recipe inputs, tools). Food and crystal are never sold anyway. **If your job's own yield is in `keep`, the agent fills up and then waits when overburdened** |
| `food` | Item ids that count as food. Empty: whatever the City's food outlets sell |
| `tickSeconds` | Time between ticks (5 or more; 60 is a good start) |
| `words` | Optional journal lines from a model (step 6). Off by default |

Every field except `skillDir` and `agentId` is re-read every tick. A broken edit is logged as `config_error` and the last good config is kept; fixing it logs `config_ok`. To change `skillDir` or `agentId`, restart the driver.

### 3. Test offline against the fake City

Before your agent, prove the loop on a world you control. [`scripts/fake-city.mjs`](scripts/fake-city.mjs) answers the same commands with the same JSON fields:

```sh
node <this skill>/scripts/selftest.mjs           # expect: selftest: 68 ok, 0 failed (one to two minutes)
```

To try your own `driver.json` against it, see [references/fake-city.md](references/fake-city.md).

### 4. Dry run against your agent

```sh
node driver.mjs --config driver.json --dry-run --once
cat log.jsonl
```

A dry run reads your agent by id **without taking control** (no `connect`) and logs `"event":"would"` with what it would have done. Nothing is sent. Read the `why` and every `note` line. If it would sell something you need, add it to `keep`.

In the City helper we wrote against, reads that name the agent don't need control. If yours answers `not connected`, the log line carries a hint: skip the dry run and watch the first ticks of a real run instead.

### 5. Run it

```sh
node driver.mjs --config driver.json             # Ctrl-C stops the driver and hands control back
```

It connects first. **Direct control is exclusive:** if your agent is already driven by something else (the City's hosted AI, another script, a second copy of this driver), they take control from each other. Run one driver per agent. The driver stops by itself (exit 1, `giving_up` in the log) after 3 reconnects in a row are refused, rather than fight.

- **When the City's skill updates itself** on `connect`, the driver logs `skill_updated` and stops (exit 3): the rules or fields may have changed. Re-read the City's `SKILL.md`, check [references/the-city.md](references/the-city.md), and start it again.
- **Ctrl-C** stops the driver, not the agent: profession `work` started on the server keeps running until something stops it.
- To keep it running after you close the terminal, use your system's scheduler or a process manager and point it at this folder.

Watch the first hour in `log.jsonl`. Every line format is in [references/log-format.md](references/log-format.md).

### 6. Optional: words from a model

Set `words.enabled` to `true`, `words.url` and `words.model`. Every `everyMinutes`, the driver gives the model a few plain facts (hunger, load, what it carries, what it just chose) and asks for one journal line. The line is checked before it lands in `journal.md`: empty, over 200 characters, a repeat of a recent line, or **any number that isn't one of the numbers in the facts** is rejected and logged as `journal_rejected`. Numbers written as words aren't caught.

- **Local model (Ollama):** `"url": "http://127.0.0.1:11434/api/chat"`, `"model": "<your tag>"`. The driver sends `think: false`, so thinking models don't come back empty.
- **Any OpenAI-style API** (a hosted model, LM Studio, a llama.cpp server): a URL ending in `/v1/chat/completions`. Put the key in an environment variable and its **name** in `apiKeyEnv`. Never put a key in `driver.json`.
- `timeoutSeconds` (default 30): a slow model delays the next PAUSE check by up to this long.

The model never chooses an action and never speaks to other agents. Small local models still embellish, and the check only catches numbers: see [references/words.md](references/words.md).

### 7. Take the agent with PAUSE

When you want to play the agent yourself, or run another script on it:

```sh
node pause.mjs . 30 --by me        # waits until the driver says RELEASED (exit 0), then the agent is yours for 30 min
# … connect and play with the City's helper as usual …
node scripts/mcity-control.mjs disconnect          # in the City's skill folder, when you're done
node pause.mjs . off               # give it back now
```

The driver looks for `PAUSE` every 5 seconds, and between its calls to the City; a slow helper or model call can delay that. On a new PAUSE it stops work, disconnects, writes `RELEASED`, and sends nothing at all until the PAUSE is removed or its `until` time passes. Then it reconnects and goes on. **At `until` it takes the agent back even if you're mid-play**, so ask for enough minutes; running `pause.mjs` again extends the pause without the driver touching the agent. `pause.mjs` exits 3 if the driver couldn't hand back control: don't connect then, or you'll fight it. A plain `touch PAUSE` (no end time) also works, for a human. Scripts must always set an end time, so a crashed script can't strand the agent. Details: [references/pause.md](references/pause.md).

## Safety rules

- **One controller per agent.** Two drivers, or a driver plus another controller, take control from each other.
- **The driver only ever sends** `connect`, `disconnect`, `eat`, `trade`, `gather`, `work`, `stop-work`. It refuses anything else in code. Add a new action on purpose, with its own test, not by letting a model pick.
- **One action at a time.** While the agent is mid-action it sends nothing; a new action would replace the running one. A `pending` action isn't resent until the inventory changes or 3 ticks pass.
- **Never give a model the buttons.** It writes words from facts. Code decides.
- **The API token stays in the City skill's `.env`.** Don't copy it into the driver folder, a log, a paste or a screenshot. Treat it like a password: we found no way to rotate it.
- **Don't trust `submitted: true`.** Only the outcome counts, and a gain only counts when the next `inventory` read shows it. The log keeps the two apart.
- **Sell with a keep list.** Selling "when loaded" will sell what a recipe needs if you don't list it in `keep`.
- **One agent per account** is the safe rule of thumb. Moving crystals from many agents into one has been reported to get accounts banned (a community report, not verified).

## Report back

When you set this up for someone, tell them:

- the agent id, `mode` and `jobs`, and the `keep` list;
- the dry run's `would` lines, and any `note` lines;
- the first live hour: actions sent, how many `confirmed`/`pending`/`failed`, any `backoff`, and the measured `inventory_changed` totals;
- how to pause (`node pause.mjs . 30`) and where the log is;
- anything you saw that the driver doesn't handle (an event lock, a source that stays blocked, `reconnect` lines).

## More

- [references/the-city.md](references/the-city.md): which helper commands and fields the driver uses, the decision order, and what it leaves to you
- [references/log-format.md](references/log-format.md): every log event
- [references/pause.md](references/pause.md): the PAUSE and RELEASED files
- [references/words.md](references/words.md): hooking up a model, and what our test showed
- [references/gotchas.md](references/gotchas.md): things that cost time, and what to know before you add talking
- [references/fake-city.md](references/fake-city.md): the fake City's world file

## Status

**In development.** Written against the City's direct-control skill version `2026-11-06T12:11:00Z`: the command names and JSON fields used were read from that skill's documentation, its helper and its behavior contract. Tested on Node 26, macOS arm64: `selftest.mjs` 68/68 against the fake City, including a real PAUSE handoff to a running driver, a renewed PAUSE, refused reconnects and Ctrl-C; the journal step against a local 8B model through Ollama's `/api/chat`. A fresh agent with only this folder ran it end to end against the fake City (PASS-WITH-FIXES; all 25 findings fixed here). **Not yet run against a live agent.** The City is a preview game: commands and fields change, so re-read its skill when it updates.
