---
name: page-watch
description: Set up a scheduled check of a site's public pages that reports what is stale or broken and since when. For each page in a JSON config it checks data age against the page's declared max (via meta tags a small fresh.js fills from a /data-status.json heartbeat), HTTP status, broken internal and external links, JavaScript page errors and failed requests, the link card (og/twitter tags and the image as X and Discord fetch it), optional fit-check at phone and desktop widths, and JSON "services" that must read a given value. Writes latest.md plus one file per day, never fails silently (a self-check flags a missed run, a crash writes status failed). Use it when someone wants to know before visitors do that a page went stale, a link broke or a feed stopped, or asks for uptime, freshness or link monitoring of their own pages without a hosted service.
---

# page-watch

**What it does.** Pages with live data go stale quietly: a sync job stops, the page keeps showing yesterday's numbers, and nobody notices. Links rot, a script throws, a share card stops loading. page-watch checks every page you list, on a schedule you set, and writes one markdown report: "✅ All fresh", or each problem with **since when**.

[`scripts/watch.mjs`](scripts/watch.mjs) does the run. It reads one config file and writes to folders you name. It has no account, no keys and no server: it only reads public pages.

| Check | A problem when |
|---|---|
| **Data age** | a page with `maxAgeMinutes` shows `<meta name="data-updated">` older than that, or none, or declares a different `data-max-age` |
| **HTTP** | 400 or above, or unreachable |
| **Page errors** | an uncaught JavaScript error, or a same-site request that fails (console errors are notes) |
| **Links** | any `<a href>` on the page answers 404, 410, 5xx or nothing. 401, 403 and 429 are "couldn't verify", not broken |
| **Link card** | og/twitter tags missing, the two images differ, or the image doesn't load for X's or Discord's crawler ([references/checks.md](references/checks.md)) |
| **Services** | a JSON address doesn't have the value you expect at a path (`status` = `"ok"`) |
| **Fit** (optional) | [fit-check](https://github.com/Beo-Halfhand/fit-check) finds split words, overflow, clipping or sideways scroll |

**Not covered:** pages behind a login, uptime every minute (this is a daily or hourly report, not a pager), and what a crawler's own servers get through your firewall (a fetch with a crawler's user agent proves the tags, not the network path).

## When to use

- Someone has public pages that show data from a job, feed or API, and wants to hear when one stops updating.
- Someone wants a daily "is everything on my site still working" report: links, errors, share cards.
- Before handing out links (a launch, a post), to check every page has a working card.

## Steps

### 1. Check the setup

```sh
node --version     # 20 or newer
```

### 2. Install

Copy [`scripts/`](scripts/) to its own folder (outside your site's web root), install, and get a browser for it:

```sh
cp -R <this skill>/scripts ./page-watch && cd page-watch
npm install                                          # playwright-core 1.64.1
npx playwright-core install chromium-headless-shell  # once; or set PAGE_WATCH_CHROMIUM to a Chromium you have
node selftest.mjs                                    # expect: selftest: 61 ok, 0 failed
```

`node selftest.mjs --offline` runs the 36 checks that need no browser. The full self-test serves a small site on 127.0.0.1 and runs page-watch against it.

The browser goes into Playwright's shared cache in your home folder. To keep it inside this folder instead, set `PLAYWRIGHT_BROWSERS_PATH=$PWD/browsers` for the install **and** in the scheduler's environment (step 6). If the version playwright-core expects isn't installed, page-watch falls back to the newest headless shell it finds there and names it in the report's footer ("Browser: a fallback ..."); install the matching one to get rid of that.

### 3. Write the config

```sh
cp example.page-watch.config.json page-watch.config.json
```

List your pages. The whole format is in [references/config.md](references/config.md). The parts people get wrong:

- `maxAgeMinutes` only for pages that show data from a job, and only after step 4. Leave it out (or `null`) for static pages.
- `report.dir` is where the report goes. Point it where you'll read it: a notes folder, a synced folder, a repo that a dashboard reads. Relative paths are relative to the config file.
- `report.timeZone` is how times are written (`"UTC"` by default in the example; any IANA name such as `"Europe/Berlin"`).
- `userAgent`: say who you are, with a contact URL, so site owners whose links you check can reach you.

```sh
node watch.mjs --check-config      # "config ok: N page(s) ..." or each problem, exit 2
```

### 4. (Live-data pages) Make each page say how fresh it is

A page can't be checked for staleness unless it says when its data was last refreshed. Add three lines to its `<head>`, copy [`scripts/fresh.js`](scripts/fresh.js) to the site, and have the job that refreshes the data write `/data-status.json`. If the job already writes its heartbeat somewhere else (another file name or an API), set `window.FRESH_STATUS_URL` to that address before fresh.js loads instead of moving it. Visitors then see "Paused since ..." on a stale page, and page-watch reads the same tag.

Max age: about three of the job's intervals plus how long a run takes. A job every 10 minutes gets 40; every 15 minutes, 60; a daily job, 26 hours (1560). Details and the JSON shape: [references/freshness.md](references/freshness.md).

### 5. Run it once by hand

```sh
node watch.mjs --now --print                 # full run, report printed too
node watch.mjs --now --only /status          # just the pages whose URL contains /status
node watch.mjs --now --no-links --no-cards   # quicker while you set up
```

A run with `--only`, `--no-links` or `--no-cards` (or `--no-fit` when fit is on) is a **partial run**: it writes `partial.md` and leaves `latest.md`, the daily file and the "since" times alone, so setting up never resets your real report.

Exit 0 = all fresh, 1 = problems (or a failed run), 2 = bad arguments or config. Read the report as in [references/report.md](references/report.md). Fix or accept each problem before scheduling, or the first scheduled report will be noise.

### 6. Schedule it

`--auto` is meant for a scheduler that fires twice a day: it does a full run if the last one is 20 or more hours old (or ¾ of `staleAfterHours`, if that's less), and otherwise only the self-check. So one missed or failed morning run is retried at midday, and a stopped scheduler is reported in the file you read. Ready-made entries for cron, launchd, systemd and GitHub Actions: [references/schedule.md](references/schedule.md).

## Safety rules

- **Your pages, or pages you're allowed to check.** It fetches every link on every listed page once per run (6 at a time by default). Don't point it at someone else's site at high frequency.
- **No secrets in the config.** It's for public pages. Don't put tokens in page URLs or service URLs; the URLs are written into the report.
- **Keep the report where you'll read it.** A report nobody opens is the silent failure this tool exists to prevent.
- **Don't edit `since.json` by hand** to make a problem look new. Fix the problem; it drops off on the next run.

## What to report

1. The config: how many pages, which have `maxAgeMinutes`, where the report goes, the time zone.
2. The self-test line (`selftest: N ok, 0 failed`).
3. The first full run's summary line and each problem with what you did about it.
4. The schedule you installed and how to check it's loaded.

Errors and what to do: [references/errors.md](references/errors.md).
