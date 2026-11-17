# The protocol, file by file

Everything is a plain file, so any program in any language can take part. **Every file has exactly one writer**; the only file with several writers (`events.jsonl`) is append-only. Write whole files atomically (a temp file, then rename) and keep them owner-only (600 files, 700 folders).

## The agent's folder

| File | Writer | Format | Meaning |
|---|---|---|---|
| `PAUSE` | the owner, or a script taking the agent | `{"by", "at", "until"}`, all optional | The driver hands off while it exists and `until` hasn't passed. Scripts always set `until`. Empty file (`touch PAUSE`) = paused until deleted |
| `RELEASED` | the driver | `{"at", "for", "by", "stoppedWork", "released"}` | Hands-off confirmed for the PAUSE whose `at` equals `for`. `released: false` = it could not let go: don't touch the agent. The driver deletes it when it resumes |
| `STOP` | the owner | anything (the command writes `{"by", "at"}`) | Every action except read-only ones is refused while it exists |
| `policy.json` | the owner | see [limits.md](limits.md) | What the agent may do. Re-read on every check |
| `spent.json` | the driver | `{"day", "dayKey", "week", "weekKey", "frozen"?}` | Spend in the owner's day and week; the freeze latch |
| `refusals.jsonl` | the driver | one line per "no": `{"at", "mode", "action", "rule", "reason", "amount"?, "to"?, "approved"?, "wouldRefuse"?}` | Every refusal and, in shadow mode, every would-refuse |
| `events.jsonl` | append-only: takeover scripts and the driver | one line per note: `{"at", "by", "text", "pin"}` | "While you were away" notes |

## The asks folder (shared with fleet-dashboard)

| File | Writer | Format |
|---|---|---|
| `<id>.json` | the agent | `{"id", "agent", "question", "draft"?, "at"}`, fleet-dashboard's ask, plus `"kind"`, `"onTimeout"`, `"deadline"`, `"context"?`, `"action"?` |
| `answers/<id>.json` | fleet-dashboard or `controls.mjs answer` (one answer, exclusive create) | `{"id", "verdict": "ok" \| "own" \| "skip", "text"?, "at", "by"}` |
| `done/<id>.json` | the agent, when it closes an ask | `{"ask", "answer", "outcome", "closedAt"}` |

The base format is defined once, in [fleet-dashboard's asks reference](../../fleet-dashboard/references/asks.md). The additions are in [asks.md](asks.md).

## Who reads what

| Reader | Reads |
|---|---|
| The driver | PAUSE (every 5 s, own timer), policy.json and STOP (every check), answers, events.jsonl (on resume, and for prompts) |
| A takeover script | RELEASED (until it's for its own pause), PAUSE (`stillMine()` before each action) |
| fleet-dashboard | PAUSE (yellow light), asks and answers, the agent's log |
| `controls.mjs status` / `doctor` | all of the above |

## Order of a takeover
1. The script writes PAUSE `{by, at, until}`.
2. The driver's pause timer sees it, stops helpers and work, waits for idle, writes RELEASED `{for: at}`.
3. The script waits for RELEASED.for === its `at` (gives up after a bound and removes its PAUSE).
4. The script works, checking `stillMine()` before each action.
5. Before letting go, it files a handback note.
6. It removes its PAUSE (only if `at` is still its own). On Ctrl-C / SIGTERM / SIGHUP too.
7. The driver sees the pause end (removed, or past `until`), deletes RELEASED, reads in the notes filed since the pause began (or files the "details unknown" placeholder), and goes back to work.
