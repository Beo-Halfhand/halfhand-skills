# fleet.json

One JSON file. Paths may start with `~/`; relative paths are taken from the folder the config is in. `node deck.mjs --config fleet.json --check` lists every problem in plain words, and the dashboard refuses to start until there are none.

## Top level

| Field | Default | What it does |
|---|---|---|
| `title` | `"Fleet dashboard"` | The page title |
| `port` | `7700` | Port on 127.0.0.1 (1024 to 65535). `--port` overrides it |
| `dataDir` | `"./fleet-data"` | History (`history/samples-YYYY-MM-DD.jsonl`), the dashboard's own log (`deck.log`) and the service output. Created with owner-only permissions |
| `sampleMinutes` | `5` | How often the sampler reads every agent, on the clock (:00, :05, …). 1 to 60. Mind the rate limits of whatever your adapter calls |
| `keepDays` | `7` | History files older than this are deleted |
| `asksDir` | none | Turns on "Asks for you" ([asks.md](asks.md)) |
| `jobsFile` | none | Jobs kept outside fleet.json, re-read at most once a minute (below) |
| `timeZone` | the browser's | An IANA name such as `"Europe/Berlin"` for every time on the page |
| `skillColors` | | Pin a colour to a skill: `{ "research": "#3987e5" }` |
| `showLog` | `true` | `false` hides the log lines on Details |
| `access` | localhost only | Phone or second-machine access through a private proxy: `hosts`, `loginHeader`, `allowLogins` (all three or none; see [always-on.md](always-on.md#phone)) |
| `agents` | required | The list below |

## Each agent

| Field | Default | What it does |
|---|---|---|
| `key` | required | 1 to 40 of `a-z 0-9 - _`. Used in URLs and history; changing it starts a fresh history |
| `name` | the key | Shown on the page (40 characters) |
| `main` | `false` | At most one. First on the page, brass sigil |
| `adapter` | required | `midnight-city`, `command`, `file`, or `fake` (demo only; can't be mixed with real agents) |
| `"<adapter>"` | | That adapter's own settings, under its name: `"midnight-city": {…}`, `"command": {…}`, `"file": {…}`. See [adapters.md](adapters.md) |
| `log` | none | The agent's log. Any text format; a time is read from lines that start with `[ISO time]` or `YYYY-MM-DD HH:MM`, or JSON lines with `t`, `ts`, `time`, `at` or `timestamp`. With no times in the file, its modified time is used |
| `pauseFile` | none | The file's **existence** means paused, unless it is JSON with an `until` time that has passed (an expired PAUSE is left in place by city-driver-starter and agent-owner-controls, and stops counting). No `until`, an empty file or one that isn't JSON: paused until deleted. The dashboard never writes it |
| `staleMinutes` | `30` | Quiet log (or, with no log, no good reading) for longer than this = red. Agents that legitimately go quiet for an hour need a bigger number |
| `warnPattern` | none | Regex for warning lines. 3 or more in the last 15 minutes = yellow. With no times in the log, the last 50 lines are counted |
| `logCounters` | none | `{ "name": "regex with (one group)" }`. The last match in the log is shown on Details. Adapter counters with the same name are overridden |
| `links` | none | `[{ "label": "Profile", "url": "https://…" }]` on Details. https only |
| `job` | none | The job in words and one number for it (below) |
| `lastDid` | none | Rules for the card's "Last:" line (below) |
| `retired` | `false` | `true`, or a short note: the agent is retired (below) |
| `retiredFile` | none | If this file exists, the agent is retired; its text is the note and its modified time is "since" |

## Job, number, last

```json
"job": { "title": "Woodcutting at the tree stand", "slot": "night shift", "status": "live",
         "number": { "label": "Woodcutting total", "xp": "woodcutting" } },
"lastDid": [ { "match": "DONE (\\w+) block · \\+([\\d,]+) XP", "say": "$1 block done, +$2 XP" } ]
```

| Field | What it does |
|---|---|
| `job.title` | Required. The job in words, under the agent's name (60 characters) |
| `job.slot` | Optional. A second phrase after the title, such as a shift or a seat |
| `job.status` | `live` (default), `staged`, `testing`, `planned` or `paused`. Anything but `live` is shown after the title, in amber |
| `job.number.label` | Required with a number: what the number is |
| `job.number.xp` | The skill's running XP total from the newest good reading, shortened (`4.4M XP`) |
| `job.number.counter` | A counter, from the adapter or `logCounters`. `"as": "rank"` shows it as `#12` |
| `job.number.value` | Text you keep up to date, such as a leaderboard place you read yourself, with `asOf` (shown "as of …", never as live) |
| `lastDid[].match` | A regular expression tried on log lines, newest line first; on each line the rules are tried in order |
| `lastDid[].say` | The words shown. `$1` … `$9` are the match's groups. Nothing else from the line is copied |

One of `xp`, `counter` or `value`, exactly. A number with no reading yet shows "—, not read yet", never a made-up 0. Every text is masked, stripped of control characters and capped. Groups are masked before underscores become spaces, so a key in a capture can't slip through. **A `lastDid` group should never capture chat text, names or anything personal**: the card is a summary, and the log is on Details for the rest. Up to 2,000 lines back are searched.

**`jobsFile`**: `{ "agents": { "<key>": { "title": "…", "slot": "…", "status": "…", "number": { … } } } }`. It is read at most once a minute (and only when its modified time changed), so you can change a job without restarting. An entry here wins over that agent's `job` in fleet.json. A missing or broken file means fleet.json's own jobs show, and a bad entry is dropped on its own.

## Retired agents

`"retired": true` (or a short note), or a `retiredFile` that exists, retires an agent. It is checked on every read, so creating the file takes effect within one page refresh and the next sampling round, with no restart. A retired agent:

- is never read by the sampler or `--check` (which prints `– key: retired, not read`);
- has no card, is never red, and isn't counted in the totals, the "Needs a look" tile or `/api/health`;
- is named in a grey **Retired** strip under the cards, with the date the file appeared and its note;
- answers 404 `{"error":"retired"}` on `/api/agent/<key>` and `/api/output?key=<key>`.

Its history stays on disk until `keepDays` removes it. Delete the file, or set `retired` back to `false` and restart, to bring it back.

## Lights, exactly

1. **Red** if: the log is configured but missing; or the log's newest time is older than `staleMinutes` and the agent isn't paused; or (no log configured) the newest good reading is older than `staleMinutes` and it isn't paused.
2. **Yellow** (unless red) for each of: paused; the last read failed; 3+ warning lines in 15 min; no log and no reading yet.
3. Otherwise **green**. Every reason is listed on the card, red first.

"Doing now" and the place come from the newest good reading, and only while it is 20 minutes old or less. After that the card says "no recent reading" and the map lights nothing.
