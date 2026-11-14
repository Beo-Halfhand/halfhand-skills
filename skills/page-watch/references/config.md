# The config file

One JSON file. `watch.mjs` finds it with `--config <file>`, else `$PAGE_WATCH_CONFIG`, else `./page-watch.config.json`. Relative paths inside it are relative to the config file, and a leading `~` is your home folder. `--check-config` validates it and exits.

Unknown fields are refused at every level (top, `report`, `state`, `fit`, `links`, each page and each service), and so are values of the wrong type, so a typo can't silently turn a check off. Every problem is listed at once, with exit 2.

```json
{
  "about": "any text, ignored",
  "report": { "dir": "./page-watch-report", "staleAfterHours": 26, "timeZone": "UTC", "footer": "", "retryHint": "" },
  "state":  { "dir": "./.page-watch-state" },
  "userAgent": "page-watch/0.2 (+https://example.com/contact)",
  "fit":    { "enabled": false, "widths": [390, 1440], "command": null },
  "links":  { "concurrency": 6, "skip": [] },
  "pages":    [ { "url": "https://example.com/status", "name": "Status board", "source": "the status job", "maxAgeMinutes": 30 } ],
  "services": [ { "url": "https://example.com/api/health", "name": "API health", "path": "status", "expect": "ok", "say": "API not healthy", "whyPath": "reason" } ]
}
```

## Top level

| Field | Default | Meaning |
|---|---|---|
| `report.dir` | `./page-watch-report` | where `latest.md` and `YYYY-MM-DD.md` go. `PAGE_WATCH_OUT` overrides it |
| `report.staleAfterHours` | 26 | the self-check flags a last full run older than this. Set it a little over your schedule's gap. `--auto` does a full run when the last is 20 h old, or ¾ of this if less, so hourly schedules work too |
| `report.timeZone` | the machine's | how times are written. Any IANA name |
| `report.footer` | empty | a line added at the end of every report, e.g. who owns the site or where to report a problem |
| `report.retryHint` | `node watch.mjs --now --config <file>` | the command a failed report tells the reader to run |
| `state.dir` | `./.page-watch-state` | `since.json` (first-seen times), `watch.log`, fit-check's files. `PAGE_WATCH_STATE` overrides it. Keep it out of any web root |
| `userAgent` | `page-watch/<version>` | sent on every page, link and service request |
| `fit.enabled` | `false` | run fit-check on every page after the other checks |
| `fit.widths` | `[390, 1440]` | widths in px |
| `fit.command` | `["npx", "--yes", "github:Beo-Halfhand/fit-check#v0.1.3"]` | the fit-check command as an array, if you have it installed elsewhere, e.g. `["node", "/path/to/fit-check/bin/fit-check.mjs"]` |
| `links.concurrency` | 6 | link checks at a time, 1 to 32 |
| `links.skip` | `[]` | regular expressions; matching links aren't checked (e.g. `"^https://x\\.com/"`) |

## A page

| Field | Required | Meaning |
|---|---|---|
| `url` | yes | `https://...`. Plain `http://` only for `localhost` and `127.0.0.1` |
| `name` | yes | how the report names it |
| `source` | no | where its data comes from, in words. For the people reading the config |
| `maxAgeMinutes` | no | for a live-data page: the oldest its data may be. The page must declare the same number in `<meta name="data-max-age">` ([freshness.md](freshness.md)). Leave out or `null` for static pages |
| `linkCard` | no | `false` to skip the link card check for this page (a page nobody shares as a link) |
| `note` | no | free text, ignored |

## A service

A JSON address whose value at a path must equal something. Use it for a backend that has no page of its own: a health route, a worker's status, a feature flag that should be on.

| Field | Required | Meaning |
|---|---|---|
| `url` | yes | as for pages |
| `name` | yes | how the report names it |
| `path` | yes | dot path into the JSON, e.g. `features.search.state` |
| `expect` | yes | the value it must equal (string, number, boolean or null; compared with `===`) |
| `say` | yes | the problem's words when it doesn't, e.g. `"search offline"` |
| `whyPath` | no | a dot path whose value is added in brackets, e.g. a `reason` field |
| `source` | no | for people |

A service's links aren't checked and it has no link card or fit check.
