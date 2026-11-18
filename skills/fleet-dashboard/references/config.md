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

## Lights, exactly

1. **Red** if: the log is configured but missing; or the log's newest time is older than `staleMinutes` and the agent isn't paused; or (no log configured) the newest good reading is older than `staleMinutes` and it isn't paused.
2. **Yellow** (unless red) for each of: paused; the last read failed; 3+ warning lines in 15 min; no log and no reading yet.
3. Otherwise **green**. Every reason is listed on the card, red first.

"Doing now" and the place come from the newest good reading, and only while it is 20 minutes old or less. After that the card says "no recent reading" and the map lights nothing.
