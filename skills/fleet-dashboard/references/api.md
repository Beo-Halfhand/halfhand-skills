# JSON routes and the history file

For building on top: a status bar, a script that posts a daily summary, another page. Every route is on 127.0.0.1 with the same Host check as the page. Responses are `no-store`.

| Route | Gives |
|---|---|
| `GET /api/health` | `{ ok, version, agents, lastRound }`: is it up, how many agents are active (retired ones aren't counted), and when did the sampler last finish a round |
| `GET /api/fleet` | Everything the main page draws (below) |
| `GET /api/agent/<key>` | One agent: the fleet fields plus `skillsNow` (current totals), `log` (last 30 lines, masked; `null` when `showLog` is off) |
| `GET /api/output?key=fleet\|<key>` | The 24-hour graph: 48 bins of 30 minutes, each `{ t, xp: {skill: n}, total, cov, est }`, plus `totals`, `skills` (sorted) and `historyFrom` |
| `GET /api/asks` | `{ enabled, max, asks: [{ id, agent, question, draft, at, open }] }` |
| `POST /api/ask` | `{ id, verdict: "ok" \| "skip" \| "own", text? }`. Needs header `X-Deck: 1` and, if the browser sends `Origin`, the same origin |

Answering from a terminal, without the page (once per ask; a second answer gets 409):

```sh
curl -s -X POST -H 'X-Deck: 1' -H 'Content-Type: application/json' -d '{"id":"A1","verdict":"ok"}' http://localhost:7700/api/ask
```

## /api/fleet

```json
{
  "version": "0.2.0", "now": 1763402400000, "title": "My fleet", "timeZone": null, "sampleMinutes": 5,
  "skills": { "colors": { "fishing": "#199e70" }, "order": ["fishing"], "other": "#6e6680" },
  "maps": { "midnight-city": { "title": "Midnight City", "tiles": [], "rooms": {} } },
  "totals": { "agents": 3, "green": 2, "yellow": 1, "red": 0, "xp6": 81234, "asksOpen": 1 },
  "lastRound": 1763402100000,
  "agents": [{
    "key": "scout", "name": "Scout", "main": true, "adapter": "midnight-city",
    "light": "yellow", "why": ["paused"], "paused": true,
    "doing": { "label": "paused" },
    "place": { "space": "central", "name": "Central", "area": null, "at": 1763402100000 },
    "strip": { "t0": 1763380800000, "bin": 900000, "bins": [{ "x": [["fishing", 1200]], "cov": true, "est": false }] },
    "xp6": 40211, "counters": { "coins": 412 },
    "job": { "title": "Woodcutting at the tree stand", "slot": null, "status": "live",
             "number": { "label": "Woodcutting total", "value": "182k XP", "live": true, "note": null } },
    "lastDid": { "t": 1763402040000, "text": "gather pine tree (confirmed)" },
    "lastLogAt": 1763402380000, "sampleAt": 1763402100000, "links": []
  }],
  "retired": [{ "key": "old-scout", "name": "Old scout", "since": 1763200000000, "note": "replaced by Scout" }]
}
```

`job` and `lastDid` are `null` when not set up or not found. `number.live` is `false` for a value you wrote (or one not read yet). `retired` lists agents that are retired: they are not in `agents` or `totals`, and `/api/agent/<key>` and `/api/output?key=<key>` answer 404 `{"error":"retired"}` for them.

`cov` means two readings bracket that bin. `est` means they were more than 15 minutes apart, so the gain was spread over the gap (drawn faded). Bins with no `cov` in the past are drawn as gaps, never as zero.

## History files

`<dataDir>/history/samples-YYYY-MM-DD.jsonl` (UTC day), one line per sampling round:

```json
{"t":1763402100000,"v":1,"a":{"scout":{"xp":{"fishing":182340},"act":{"label":"fishing","detail":"mackerel","space":"docks","name":"Docks","area":null},"c":{"coins":412}},"helper":{"err":"status command exit 1: …"}}}
```

`xp` holds running totals. A gain is the difference between two readings, spread evenly over the time between them. Readings more than 6 hours apart are not bridged. Files older than `keepDays` are deleted by the sampler.
