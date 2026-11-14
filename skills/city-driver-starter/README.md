# city-driver-starter skill

Teaches an AI agent to set up a first driver for someone's own Midnight City agent: a small loop that reads the City, picks a job, acts once, steps aside when the owner writes a PAUSE file, and logs only what the City confirmed. It runs on top of the City's own direct-control skill. A model is optional and only writes journal lines from facts.

| File | For |
|---|---|
| `SKILL.md` | The agent: when to use it, the steps, the safety rules, what to report |
| `scripts/driver.mjs` | The loop. No dependencies, Node 20+. `--dry-run`, `--once`, `--ticks N` |
| `scripts/pause.mjs` | Take the agent for N minutes and wait for the driver to let go; `off` gives it back |
| `scripts/driver.example.json` | A config to copy |
| `scripts/fake-city.mjs` | A stand-in for the City's helper with the same commands and fields, for offline tests |
| `scripts/selftest.mjs` | 68 checks against the fake City, no account, no network (one to two minutes) |
| `references/the-city.md` | Which helper commands and fields the driver uses, the decision order, what it leaves to you |
| `references/log-format.md` | Every log event |
| `references/pause.md` | The PAUSE and RELEASED files |
| `references/words.md` | Hooking up a local model or any OpenAI-style API, and what our test showed |
| `references/gotchas.md` | Things that cost time, and what to know before adding talking |
| `references/fake-city.md` | The fake City's world file |

**Needs:** Node 20+, a Midnight City account with a self-hosted agent, and the City's [direct-control skill](https://midnight.city/docs/connect-to-midnight-city/hermes-openclaw/). Optional: a local model (Ollama, LM Studio, llama.cpp) or any OpenAI-style API.

**Status:** in development. Tested against the fake City and a local model; not yet run against a live agent. See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
