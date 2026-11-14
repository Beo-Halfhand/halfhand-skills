---
name: fit-check
description: Check web pages for text-fit bugs before they ship. It finds words split mid-word, text that overflows or is clipped, sideways scrolling on phones, and uncaught page errors, at nine widths from 320 to 1920 px. Use it before promoting a preview deploy, after CSS or copy changes, when a page "looks broken on mobile", or to add a fit gate to CI. It runs the open-source fit-check tool (Node 20+, headless Chromium) and covers how to read and fix what it finds.
---

# fit-check

**What it does.** [fit-check](https://github.com/Beo-Halfhand/fit-check) opens each URL in headless Chromium at nine widths (320, 375, 390, 414, 768, 1024, 1280, 1440, 1920 px). It opens every `<details>` and clicks every visible `[role="tab"]`, then flags:

| Kind | Meaning |
|---|---|
| `split-word` | A word broken between two letters or digits (`Gingersn` / `ap`). Breaks after a hyphen or slash are fine and are not flagged. |
| `overflow` | Text running out of its box. |
| `clipped` | Text cut off by `overflow: hidden`, with no ellipsis and no line clamp. |
| `page-scroll` | The page is wider than the screen. The report names the elements sticking out. |
| `page-error` | An uncaught JavaScript error while the page loaded. |

**Not covered:** colour, contrast, images, accessibility, speed, or whether the page looks *good*. A clean run means the text fits, nothing more. Pages behind a login can't be checked (each run starts a fresh browser with no cookies).

## When to use

- Before promoting a preview or staging deploy to production.
- After changing CSS, fonts, a grid, or copy that got longer (names, prices, translations).
- When someone says a page "looks broken on my phone".
- When adding a deploy gate: see [references/ci.md](references/ci.md).

## Steps

### 1. Check the setup

```sh
node --version          # must be 20 or newer
```

fit-check needs a Chromium. It looks under `~/Library/Caches/ms-playwright` and `~/.cache/ms-playwright` (and `PLAYWRIGHT_BROWSERS_PATH`) first. If none is there:

```sh
npx playwright install chromium-headless-shell
```

Or point it at a browser you already have with `--chromium <path>` or `FIT_CHECK_CHROMIUM=<path>`. If no browser can start, fit-check exits **2** and prints this same hint.

### 2. Pick the URLs

- Use the **preview** deploy if there is one. Check before promoting, not after.
- A local dev server works: `http://localhost:5173/`.
- A local file needs a full `file://` URL: `file://$PWD/index.html`. A bare path like `index.html` fails to load (exit 2).
- A local file must end in `.html` or `.htm`. Anything else (`index.html.orig`, `page.bak`) is shown as plain text, and plain text always comes out clean (exit 0). Copy it to a `.html` name first.
- Include pages that only render differently with a query string or tab (`/shop?view=list`). List them one per line in a file; `#` comments are allowed.

### 3. Run it

Always pin the tag. Don't run an unpinned or `#main` version.

```sh
npx --yes github:Beo-Halfhand/fit-check#v0.1.3 --out fit-report https://preview.example.com/ https://preview.example.com/pricing
npx --yes github:Beo-Halfhand/fit-check#v0.1.3 --out fit-report --urls-file fit-urls.txt
```

Capture the exit code straight after the run, without a pipe (a pipe gives you the exit code of the last command in it, and `PIPESTATUS` doesn't exist in zsh):

```sh
npx --yes github:Beo-Halfhand/fit-check#v0.1.3 --quiet --out fit-report --urls-file fit-urls.txt; echo "exit=$?"
```

Useful options: `--widths 320,390,1440` for a quick pass while fixing (go back to all nine before you sign off), `--quiet` for one summary line, `--no-reveal` to skip opening folds and tabs, `--ignore <selector>` (repeatable), `--concurrency <n>` (default 3).

### 4. Read the result

| Exit | Meaning | Next |
|---|---|---|
| 0 | No hits | Check the HTTP status (below), then done. |
| 1 | Hits | Open `fit-report/report.md`. |
| 2 | A page failed to load, or no browser could start | Read the error line in `report.md` (or stderr) and fix the URL or setup. This is not a pass. |

**Exit 0 doesn't prove you checked the right page.** A URL that returns 404 or 500 still renders an error page, and if that page fits, the run is clean. `report.md` shows `HTTP 404.` under the URL, and `report.json` has `httpStatus` per URL (`null` when below 400). Check it.

`report.md` groups hits by page, then by kind. Each row gives the widths it shows at, a CSS selector, the text, a detail ("text 168px wide in a 90px box", `"Gingersn" / "ap"`), and a link to a screenshot crop. The total in the summary line counts rows, one per element and kind, however many widths it shows at. Without `--quiet`, the per-width progress lines count each width separately, so their numbers won't add up to the total. Look at the crops before you change anything. The full format is in [references/report-format.md](references/report-format.md).

### 5. Fix, or mark it intended

The default is **fix it**. [references/fixes.md](references/fixes.md) has the fix for each kind. Mark something intended only when the behaviour is really wanted:

- `data-fit-allow="break"` on an element whose text may break anywhere on purpose.
- `data-fit-allow="all"` to skip an element entirely (a decorative marquee, a deliberately cropped headline).
- `--ignore <selector>` for third-party widgets you can't change.

Tokens of 30 or more characters (hashes, wallet addresses, long URLs) are skipped on purpose and counted at the bottom of the report. Change the length with `--min-token <n>`.

### 6. Rerun until clean

Rerun at all nine widths. Promote only on exit 0 with no HTTP error.

## Safety rules

1. **Only check pages you are allowed to load.** Each URL is loaded once per width (nine times by default), along with whatever the page itself fetches.
2. **Tabs get clicked.** If a `[role="tab"]` on the page does something (sends, buys, deletes, logs out), run with `--no-reveal` or leave that page out. Prefer preview over production.
3. **Never weaken the check to get a pass.** No blanket `--ignore body *`, no `data-fit-allow="all"` on a layout wrapper, no dropping widths from the gate. If something must be allowed, allow the smallest element and say why in the report.
4. **`fit-report/` can leak.** It holds screenshots of the pages and every URL you passed. Crop file names are built from the URL, so a `file://` run puts your local folder path in them. Add `fit-report/` to `.gitignore`, and look at it before you share it.
5. **Pin the version** (`#v0.1.3`) so a later change can't alter your gate without you noticing.

## Report back

Tell the user:
- which URLs and widths were checked, and the exit code;
- hits by kind, with the selector and widths of each;
- what you fixed, and how;
- anything you marked intended, and why;
- any URL with an HTTP error status.

Tested on fit-check v0.1.3 with Node 26, playwright-core 1.64.1 and chrome-headless-shell (Playwright browser revisions 1217 and 1254), on macOS arm64.
