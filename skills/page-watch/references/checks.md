# Each check in detail

For every page, in this order. Three pages are checked at a time.

## HTTP

A plain `fetch` with your `userAgent`, following redirects. 400 or above, or unreachable (DNS, refused, 20 s timeout), is one problem, and the page's other checks are skipped: a page that isn't there is one problem, not several.

## Link card

[`card.mjs`](../scripts/card.mjs) fetches the page twice, as `Twitterbot/1.0` and as Discord's crawler, with no scripts (crawlers don't run them), and reads the tags.

| Problem | Why it matters |
|---|---|
| any of `og:title`, `og:description`, `og:image`, `twitter:image`, `twitter:card`, `twitter:title`, `twitter:description` missing | one problem listing them all: no card, or X may show none |
| `twitter:card` is there but isn't `summary_large_image` | a small card |
| `og:image` and `twitter:image` differ | different pictures on X and Discord |
| `og:image` or `twitter:image` is a relative address (`/card.png`) | crawlers need the full `https://` address |
| the image: not 200, redirected, not JPEG or PNG, 5 MB or more, under 1,000 bytes, `x-robots-tag: noindex`, a header with no picture size, or smaller than 300 × 157 | crawlers drop it or show it small |
| the crawler gets a non-200 for the page | blocked by your own server or CDN rules for that user agent |

Notes (not problems): no `?v=` on the image address (crawlers cache images, so change `?v=` when you change the picture); no `og:url`; a `<link rel="canonical">` (X files the card under the canonical address, so adding `?v=` to a shared link can't refresh it).

Turn it off per page with `"linkCard": false`, or for one run with `--no-cards`.

## Page load

Headless Chromium at 1440 × 900 loads the page, waits for the network to go quiet (45 s at most), and 1.5 s more for the page's own scripts.

- an uncaught JavaScript error → **page-error**
- a request to the same host that gets 400 or above (a missing script, image or API call) → **failed-request**
- console errors → a note with the count and the first one
- the page can't be loaded at all → **load**

## Data age

See [freshness.md](freshness.md). Only for pages with `maxAgeMinutes`. A data time more than 5 minutes in the future is a problem too: a clock or time zone is wrong where the data is written.

## Links

Every `http(s)` `<a href>` on every page, without `#fragments`, deduplicated across pages and checked once per run: `HEAD`, and `GET` if the server answers 400, 403, 404, 405 or 501 to `HEAD` (some servers don't do `HEAD`). 15 s timeout.

| Answer | Counted as |
|---|---|
| below 400 | fine |
| 401, 403, 429, 999 | **couldn't verify**: the site blocks bots or rate-limits. Listed by host in one line, not a problem |
| anything else 400 or above, or no answer | **broken link**, with the pages it's on and since when |

Skip links you know can't be checked (sites that block every bot) with `links.skip`.

## Services

`GET` with `accept: application/json`. Not 2xx, not JSON (the problem names the content type and HTTP status), unreachable, or the value at `path` not `===` `expect` → **service** problem, using your `say` words.

## Fit (optional)

With `fit.enabled`, after the other checks, [fit-check](https://github.com/Beo-Halfhand/fit-check) runs once over every page at `fit.widths`. Each hit is a problem. If fit-check can't run, that's one problem ("fit-check did not run") so a broken fit step isn't silent. See the [fit-check skill](https://github.com/Beo-Halfhand/halfhand-skills/tree/main/skills/fit-check) for reading its hits.

## Since when

Each problem gets a key (page, kind, and its words with times and numbers in brackets removed), and its first-seen time is kept in `state/since.json`. A stale page's first-seen time is its data time. A problem that's gone is dropped from the file on the next run, so if it comes back it's new again.
