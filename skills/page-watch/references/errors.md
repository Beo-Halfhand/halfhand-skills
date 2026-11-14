# Errors and what to do

| Message | Cause | Do |
|---|---|---|
| `usage: node watch.mjs --now \| --auto \| ...` (exit 2) | no mode given | add `--now`, `--auto`, `--self-check` or `--check-config` |
| `unknown option --x` / `unexpected argument x` (exit 2) | a typo | check the spelling; `--only` and `--config` take a value |
| `FAILED: cannot read config page-watch.config.json: ENOENT` (exit 2) | no config where it looked | `--config <file>`, or run from the folder that has it |
| `config ... has N problem(s)` (exit 2) | the config is invalid; each problem is listed | fix them; [config.md](config.md) |
| `--config needs a value` / `--only needs a value` (exit 2) | the flag was last, or followed by another flag | give it a value |
| `--only x matches no page or service` (exit 2) | the filter matched nothing; nothing was written | check the text: it matches anywhere in the URL |
| `FAILED: no Chromium for playwright-core` in latest.md (or partial.md) | no browser for this playwright-core | `npx playwright-core install chromium-headless-shell` in the scripts folder, or set `PAGE_WATCH_CHROMIUM` to a Chromium or chrome-headless-shell binary |
| `FAILED: browserType.launch: ...` with `PAGE_WATCH_CHROMIUM` set | the path is wrong or not executable | fix or unset it |
| `FAILED: EACCES` / `EPERM` | the report or state folder isn't writable by the user the scheduler runs as | fix permissions; on macOS, cron may need Full Disk Access for some folders, launchd doesn't |
| **stale:** `the page shows no data time` on a page you know is fresh | fresh.js couldn't read `/data-status.json`, or one of the page's `data-sources` isn't in it | open the page: the line says "freshness unknown". Check the JSON address and the source names |
| **stale:** `the page's data time ... is N h in the future` | the job writing the heartbeat has a wrong clock, or writes local time without a zone | write ISO times in UTC with a `Z` |
| `Browser: a fallback, not the version playwright-core expects` in the footer | the matching headless shell isn't installed | `npx playwright-core install chromium-headless-shell` (with the same `PLAYWRIGHT_BROWSERS_PATH` the scheduler uses) |
| **link-card:** `og:image is a relative address` | crawlers can't resolve `/card.png` | write the full `https://` address |
| **link-card:** `... isn't a readable PNG` / `too small for a large card` | the file is broken, or under 300 × 157 | export a real 1200 × 630 JPEG or PNG |
| **service:** `HTTP 200 but not JSON (text/html)` | the address serves a page (a maintenance page, a login wall) | point `url` at the JSON route |
| **config:** `the page declares data-max-age X; the config says Y` | the page and config disagree | make them the same |
| **failed-request:** `404 /some.js` | a script, image or API call on the page is missing | fix the page; it may look fine but be missing a part |
| **link-card:** `X's crawler gets HTTP 403` | your CDN or firewall blocks that user agent | allow known link-preview crawlers |
| many "couldn't verify" links on one host | that site blocks bots | add it to `links.skip` if you don't want to see it |
| **fit-check did not run:** ... | npx couldn't fetch fit-check, or no browser for it | run the fit-check command by hand to see the error; set `fit.command` to a local install |
| every page `unreachable: ENOTFOUND` | no network or DNS on the machine at that time | the scheduler ran before the network was up; schedule later or rely on the second `--auto` run |
| the report never changes | the scheduler isn't running, or runs in another folder | `--self-check` by hand; see [schedule.md](schedule.md) for checking it's loaded |
