# fit-check report format (v0.1.3)

A run writes three things to the `--out` folder (default `./fit-report`):

- `report.md`: for people. One section per URL, then one table per kind of hit.
- `report.json`: for scripts. Same content.
- `crops/`: one PNG per hit per width, cropped around the element.

## report.md

```markdown
## https://preview.example.com/pricing

### Word split mid-word (1)

| Widths | Element | Text | Detail | Crop |
|---|---|---|---|---|
| 320, 375 | `.plan:nth-of-type(2) > h3` | Professional | "Professio" / "nal" | [crop](crops/…-320-1.png) |
| 320 | `#returns-note` | Thirty day returns window | text 188px wide in a 90px box (fold: Shipping > Returns) | [crop](crops/…-320-3.png) |

### Sideways page scroll (1)

| Widths | Element | Text | Detail | Crop |
|---|---|---|---|---|
| 320 | `table.compare` |  | page is 212px wider than the 320px viewport | [crop](crops/…-320-2.png) |
```

- **Widths** lists every width where the same element had the same kind of hit. A hit only at 320 and 375 is a phone problem; a hit at every width is a plain bug.
- **Element** is a CSS selector you can paste into devtools.
- **Detail** for `split-word` shows the two halves; for `overflow`/`clipped`, the text width against the box width; for `page-scroll`, how far the page sticks out.
- **Where it was found** follows the detail in brackets, only when it says something: the tab (`tab: Pricing`) and the fold (`fold: Shipping > Returns`), joined with ` · `. A hit seen as loaded and in no fold has no brackets.
- `HTTP 404.` (or another status of 400 or more) under the URL means the server returned an error page. The hits, or the lack of them, are for that error page.
- A line at the end of a section counts the long tokens (30+ characters) that were skipped on purpose.

## report.json

```json
{
  "generated": "2026-11-13T01:15:37.619Z",
  "widths": [320, 1024],
  "results": [
    {
      "url": "https://preview.example.com/pricing",
      "httpStatus": null,
      "errors": [],
      "pageErrors": [],
      "hits": [
        {
          "kind": "split-word",
          "selector": "#split",
          "text": "Gingersnap",
          "detail": "\"Gingersn\" / \"ap\"",
          "state": "as loaded",
          "fold": null,
          "widths": [320, 1024],
          "crops": ["crops/…-320-1.png"]
        }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `httpStatus` | The status if it was 400 or more, else `null`. |
| `errors` | `[{ width, error }]` when the page failed to load at a width. Any entry makes the exit code 2. |
| `pageErrors` | Uncaught JavaScript errors (also listed as `page-error` hits). |
| `hits[].kind` | `split-word`, `overflow`, `clipped`, `page-scroll` or `page-error`. |
| `hits[].state` | When it was seen: `as loaded` (with every `<details>` already opened, unless `--no-reveal`), or `tab: <tab text>` after clicking that tab. A hit that only appears in a tab is still a hit. |
| `hits[].fold` | The `<summary>` text of every `<details>` around the hit, outermost first, joined with ` > ` (e.g. `Shipping > Returns`), or `null` when it is in no fold. Text inside a `<summary>` doesn't count that summary's own fold, since it shows while the fold is shut. Added in v0.1.3. |
| `hits[].widths` | Every width it appeared at. |

## Count hits by kind (jq)

```sh
jq -r '[.results[].hits[].kind] | group_by(.) | map("\(.[0]) \(length)") | .[]' fit-report/report.json
jq -r '.results[] | select(.httpStatus != null) | "\(.httpStatus) \(.url)"' fit-report/report.json
jq -r '.results[].hits[] | select(.fold != null) | "\(.fold): \(.kind) \(.selector)"' fit-report/report.json
```
