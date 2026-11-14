# fit-check skill

Teaches an AI agent to check web pages for text-fit bugs before they ship: words split mid-word, text overflowing or clipped, sideways scrolling on phones, and page errors, at nine widths from 320 to 1920 px.

The work is done by [fit-check](https://github.com/Beo-Halfhand/fit-check), pinned at **v0.1.3**. This folder adds when to run it, how to read the report, how to fix each kind of hit, when an allow-marker is honest, and how to make it a deploy gate.

| File | For |
|---|---|
| `SKILL.md` | The agent: when to use it, the steps, safety rules, what to report |
| `references/report-format.md` | `report.md` and `report.json`, field by field |
| `references/fixes.md` | The CSS fix for each kind of hit |
| `references/ci.md` | A deploy script, an npm script and a GitHub Actions job |

**Needs:** Node 20+ and a Chromium (`npx playwright install chromium-headless-shell` if you don't have one). No keys, no accounts. It talks only to the URLs you give it and whatever those pages load.

**Status:** see the table in the [repo README](../../README.md).
