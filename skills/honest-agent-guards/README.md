# honest-agent-guards skill

Teaches an AI agent to put honesty checks in front of a talking agent's "send". Every line is checked against a banned list in a markdown file (claims, and places that must be on your map) and against the agent's own state (levels, gear, and what it really does). A refused line gets one redraft with the reason, then the bad sentences are dropped, else nothing is sent. Zero dependencies, Node 20+. Built from the checks a fleet of Midnight City agents runs, and usable for any talking bot.

```sh
node scripts/selftest.mjs        # selftest: 73 ok, 0 failed
node scripts/demo.mjs            # six made-up drafts through the loop, with a stand-in model
node scripts/guards.mjs check "Merchant prices drift about 15% in a few minutes."
```

| File | For |
|---|---|
| `SKILL.md` | The agent: when to use it, the steps, the safety rules, what to report |
| `scripts/guards.mjs` | The checks, the loop and the command line (`check`, `scan`, `list`) |
| `scripts/example-list.md` | A starting list: five claims and two places caught in real replies, and the Midnight City map (2026-11-16) |
| `scripts/state.example.json` | The agent's state, as the checks read it |
| `scripts/demo.mjs` | The loop on made-up drafts, no model and no network |
| `scripts/selftest.mjs` | 73 checks, including the 29 crew-sample cases |
| `references/list-format.md` | The list file, line by line; regenerating the map |
| `references/state.md` | Every state field, and where to get it |
| `references/the-loop.md` | The functions, the redraft prompt, what to log |
| `references/midnight-city.md` | Wiring it into a City agent |
| `references/limits.md` | What it misses and what it gets wrong |

**Needs:** Node 20+. Nothing else. The guards never call the network.

**Status:** coming (in development, not yet public). See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
