# agent-owner-controls skill

Teaches an AI agent to give an agent's owner four controls through plain files: **pause-with-expiry** (take the agent, it hands off and takes itself back at the end time), **ask-the-owner** (draft, answer, a default on silence, a gate before anything is said), **handback-memory** ("while you were away" notes read back into prompts) and **owner-limits** (one policy file checked before every action, STOP, shadow mode, a rogue test).

| File | For |
|---|---|
| `SKILL.md` | The agent: what each control does, the steps, the rules that make it hold, what to report |
| `scripts/lib/pause.mjs` | PAUSE / RELEASED: `watchPause` (driver), `hold` and `stillMine` (caller), `readPause`, `isPaused` |
| `scripts/lib/asks.mjs` | The agent's side of fleet-dashboard's asks inbox: `openAsk`, `resolveAsk`, `approvalFrom`, `closeAsk` |
| `scripts/lib/gate.mjs` | The check every outgoing line passes, the owner's words included |
| `scripts/lib/handback.mjs` | `fileHandback`, `ingestHandbacks` (with the honest placeholder), `recentSelf`, `promptBlock` |
| `scripts/lib/limits.mjs` | `createLimits(dir)`: `check`, `record`, `unfreeze`, `status` |
| `scripts/lib/files.mjs` | Atomic, owner-only file writes; JSON lines |
| `scripts/controls.mjs` | The owner's command line: `pause`, `stop`, `start`, `unfreeze`, `status`, `asks`, `answer`, `handback`, `rogue`, `doctor` |
| `scripts/demo.mjs` | One made-up agent and owner, all four controls, about 20 seconds |
| `scripts/selftest.mjs` | 120 checks, including each forced refusal, log rolling and the shared formats against fleet-dashboard (asks, and its page ignoring an expired PAUSE) and city-driver-starter |
| `scripts/policy.example.json` | A policy to copy (starts in shadow mode) |
| `references/protocol.md` | Every file, its one writer, its format; the order of a takeover |
| `references/pause.md` | Pause with expiry, both sides, and the lessons behind each rule |
| `references/asks.md` | The added ask fields, defaults per kind, the gate, honesty rules, approvals |
| `references/handback.md` | Filing and reading notes, the placeholder, "recent self" |
| `references/limits.md` | Every policy field, lessons, the rogue test, enforcing outside the agent |

**Needs:** Node 20+, and the [fleet-dashboard](../fleet-dashboard/) skill folder next to this one (the asks format and the masker are imported from it, not copied). No dependencies, no network.

**Status:** in development. See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
