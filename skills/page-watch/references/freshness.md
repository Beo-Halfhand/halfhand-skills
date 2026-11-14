# Making a page say how fresh it is

page-watch can only call a page stale if the page says when its data was refreshed. The pattern has three parts, and visitors get the same honesty page-watch does: a stale page says "Paused since ..." instead of showing old numbers as if they were live.

## 1. The job writes a heartbeat

Whatever refreshes the data (a cron job, a worker, a sync script) writes `/data-status.json` on the site **every time it runs**, even when nothing changed:

```json
{ "sources": {
    "orders": { "checkedAt": "2026-11-13T17:00:00Z" },
    "stock":  { "checkedAt": "2026-11-13T16:55:00Z" }
} }
```

`checkedAt` is when the job last confirmed the data, not when the data last changed. A job that runs but finds nothing new still updates it. A job that stops doesn't, and that's what you want to catch.

## 2. The page declares its sources and max age

```html
<meta name="data-sources" content="orders stock">
<meta name="data-max-age" content="60">
<script src="/fresh.js" defer></script>
```

Optional, for visitors:

```html
<p data-fresh="line"></p>              <!-- "Live data, checked Nov 13, 9:00 AM." -->
<div data-fresh="banner" hidden></div> <!-- shown only when stale: "Paused since ..." -->
```

## 3. fresh.js fills in `data-updated`

[`scripts/fresh.js`](../scripts/fresh.js) (about 40 lines, no dependencies) fetches `/data-status.json`, takes the **oldest** `checkedAt` among the page's sources, and sets `<meta name="data-updated" content="...">`. It also fills the visitor line and banner, in the visitor's own time zone. If the file can't be read or a source is missing, `data-updated` is left empty and the line says freshness is unknown.

Set `window.FRESH_STATUS_URL` before the script if your heartbeat lives elsewhere (another path, or a JSON your API serves).

## 4. The config says the same max age

```json
{ "url": "https://example.com/orders", "name": "Orders board", "source": "the orders sync, every 15 min", "maxAgeMinutes": 60 }
```

page-watch loads the page in a browser, lets fresh.js run, and reads the two meta tags:

| What it finds | Report |
|---|---|
| `data-updated` within `maxAgeMinutes` | ✓, "updated N min ago" |
| older | **stale**, dated from `data-updated`, so "since" is when the data stopped, not when page-watch noticed |
| empty or unreadable | **stale**: "the page shows no data time" |
| `data-max-age` differs from `maxAgeMinutes` | **config**: the page and the config disagree; fix one |

Choosing the max age: about three of the job's intervals plus how long a run takes. A job every 15 minutes gets 60; a daily job at 06:00 gets 26 hours (1560).

The self-test serves a page that uses this exact fresh.js against a `data-status.json` with one fresh source, one two hours old and one missing, and checks all three outcomes.

## Pages that render data on the server

You don't need fresh.js if the server writes the tag itself: render `<meta name="data-updated" content="<ISO time>">` and `<meta name="data-max-age" content="60">` into the HTML. page-watch only reads the tags.
