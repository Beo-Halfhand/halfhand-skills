# JSON routes and the history file

For building on top: a status bar, a script that posts a daily summary, another page. Every route is on 127.0.0.1 with the same Host check as the page. Responses are `no-store`.

| Route | Gives |
|---|---|
| `GET /api/health` | `{ ok, version, agents, lastRound }`: is it up, and when did the sampler last finish a round |
| `GET /api/fleet` | Everything the main page draws (below) |
| `GET /api/agent/<key>` | One agent: the fleet fields plus `skillsNow` (current totals), `log` (last 30 lines, masked; `null` when `showLog` is off) |
| `GET /api/output?key=fleet\|<key>` | The 24-hour graph: 48 bins of 30 minutes, each `{ t, xp: {skill: n}, total, cov, est }`, plus `totals`, `skills` (sorted) and `historyFrom` |
| `GET /api/asks` | `{ enabled, max, asks: [{ id, agent, question, draft, at, open }] }` |
| `POST /api/ask` | `{ id, verdict: "ok" \| "skip" \| "own", text? }`. Needs header `X-Deck: 1` and, if the browser sends `Origin`, the same origin |

## /api/fleet

```json
{
  "version": "0.1.0", "now": 1763402400000, "title": "My fleet", "timeZone": null, "sampleMinutes": 5,
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
    "xp6": 40211, "counters": { "coins": 412 }, "lastLogAt": 1763402380000, "sampleAt": 1763402100000, "links": []
  }]
}
```

`cov` means two readings bracket that bin. `est` means they were more than 15 minutes apart, so the gain was spread over the gap (drawn faded). Bins with no `cov` in the past are drawn as gaps, never as zero.

## History files

`<dataDir>/history/samples-YYYY-MM-DD.jsonl` (UTC day), one line per sampling round:

```json
{"t":1763402100000,"v":1,"a":{"scout":{"xp":{"fishing":182340},"act":{"label":"fishing","detail":"mackerel","space":"docks","name":"Docks","area":null},"c":{"coins":412}},"helper":{"err":"status command exit 1: …"}}}
```

`xp` holds running totals. A gain is the difference between two readings, spread evenly over the time between them. Readings more than 6 hours apart are not bridged. Files older than `keepDays` are deleted by the sampler.
