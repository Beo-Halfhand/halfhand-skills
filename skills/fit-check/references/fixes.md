# Fixing what fit-check finds

Look at the crop first. Then fix the component, not the one page: the same card usually appears elsewhere.

## split-word

The CSS lets a word break anywhere (`overflow-wrap: anywhere`, `word-break: break-all` or `break-word`), and the box is narrower than the word.

1. Stop names and labels breaking mid-word:
   ```css
   .card-title { overflow-wrap: normal; word-break: normal; }
   ```
2. Then give the word room. Pick one per component:
   - **Fewer, wider columns** so the tile grows:
     ```css
     .grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr)); }
     ```
   - **An ellipsis**, with the full text in `title=` and visible on tap:
     ```css
     .card-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
     ```
     Flex and grid children need `min-width: 0`, or they won't shrink and you get `overflow` instead.
   - **Hyphenation** for running text in a known language: `hyphens: auto` with a correct `lang` attribute. fit-check doesn't flag text with `hyphens: auto`.

Hashes, addresses and long URLs may break anywhere; keep `word-break: break-all` on them. Tokens of 30+ characters are already skipped.

## overflow

Text is wider than its box and spills out (`white-space: nowrap`, a fixed `width`, or a flex child that won't shrink).

- Let it wrap: remove `white-space: nowrap`, or swap a fixed `width` for `max-width`.
- In flex rows, add `min-width: 0` to the child that holds the text, and `flex-wrap: wrap` to the row if the items can stack.
- For one-line labels that must stay one line, use the ellipsis pattern above.

## clipped

Same cause as overflow, but an ancestor has `overflow: hidden`, so the text is cut with no sign it was cut. The usual fixes:

- Use the ellipsis pattern so the cut is visible, with the full text in `title=`.
- Or a line clamp for multi-line text:
  ```css
  .blurb { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  ```
- Or remove the fixed height that causes it.

## page-scroll

Something is wider than the screen. The report names the elements sticking out.

- Wide tables and code blocks: wrap them in a scroll container, which fit-check accepts:
  ```css
  .table-wrap { overflow-x: auto; }
  ```
- Fixed widths: `width: 600px` → `max-width: 100%` (images: `max-width: 100%; height: auto`).
- Big headlines: size to the column, e.g. `font-size: min(136px, 13vw)`.
- `100vw` widths include the scrollbar on desktop; prefer `100%`.
- Don't hide it with `body { overflow-x: hidden }`. The content is still cut off for the reader, and fit-check still reports the wide element as `page-scroll` (tested on v0.1.2).

## page-error

An uncaught exception while loading. Open the page with the browser console and fix the error. A half-run script often leaves part of the page undrawn, so rerun fit-check after the fix; new hits may appear.

## When to mark instead of fix

Only when the behaviour is wanted, on the smallest element possible, with the reason in your report:

```html
<code class="tx" data-fit-allow="break">0x5f2a…</code>   <!-- may break anywhere -->
<div class="ticker" data-fit-allow="all">…</div>          <!-- skipped entirely -->
```

Or `--ignore '<selector>'` for a third-party embed you can't change.
