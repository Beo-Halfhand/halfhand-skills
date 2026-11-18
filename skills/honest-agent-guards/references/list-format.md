# The list file

One markdown file. The guards read three sections by their headings, `## Claims`, `## Places not on the map` and `## Map`, and ignore everything else, so you can keep notes around them. The file is re-read whenever its modified time changes, so edit it while the agent runs. `node guards.mjs list --list <file>` shows what was read: ✓ on, – off, ✗ a line it couldn't use (exit 1).

Which file: `loadList(path)` in code, `--list <path>` on the command line, or `GUARDS_LIST=<path>` for both. A list that is missing, unreadable or holds no claims falls back to the shipped `example-list.md`. The tag then says so, as `example (your list: not found)`. Log the tag when the agent starts so you'd notice.

## Claims

```
- [B01] all: `\d+\s?%` + `\b(?:prices?|rates?)\b` + `\b(?:drift\w*|swing\w*)\b` — tell: puts a percentage on how prices move. … — source: where you caught it
- [B04] any: `\bqueues?\b` echo: `\b(?:queue\w*|lines?|wait\w*)\b` — tell: describes queues. … — source: …
- [B02] any: `\brates? (?:drift|move)\b` unless: `\bnever (?:moved|changed)\b` — tell: … — source: …
- [B09] off any: `\bwidgets?\b` — tell: … — source: kept, switched off
```

| Part | Means |
|---|---|
| `[ID]` | A capital letter and digits (`B01`, `S01`, `B12a`). It shows up in logs and scans as `banned:B01`. An ID used twice is reported, and the first one counts |
| `off` | Right after the ID: the line is kept but never fires |
| `all:` | Regexes joined by ` + `. **All** of them must match the **same sentence** (the guards split replies into sentences first). Use this to catch a combination ("a percentage" + "prices" + "drift") without banning each word |
| `any:` | One regex |
| `unless:` | The sentence passes if this regex matches it (a denial, a quote of what they said) |
| `echo:` | The sentence passes if **their** message matches this regex, so the agent can answer a subject the other side brought up |
| `tell:` | What the redraft is told, written to finish "Your last try was rejected (it …)". Say what was wrong and what to do instead. **Never quote a sentence to use**: models copy it word for word |
| `source:` | Where you caught it. Optional, for you. Keep other people's handles and whole conversations out if you'll share the file |

Regexes are JavaScript, case-insensitive, between backticks. Write `\b` for a word boundary. There's no need to double backslashes: the file isn't JSON.

**Good lines** come from real replies. Run `scan` on what the agent sent, find a habit (the same invention three times or more), and write the narrowest pattern that catches it. Then check that `scan` on a day of good lines still passes. One broad word ("rates") bans true answers; an `all:` of three parts usually doesn't.

**Stock lines:** a phrase the agent repeats everywhere ("I rotate trades") is just an `any:` claim, `S01` in the example. These usually come from an example sentence in your own prompt, so remove the example too.

## Places not on the map

```
- [P01] Central Bank — say: the merchants in Central — source: …
- [P02] off Central Forge — say: the forge in the Central Workshops — source: a real station, so allowed
```

A place the agent keeps inventing, and what to say instead (the tell uses `say`). Plurals match. `off` marks a name you have checked is real, so the general map check lets it through too.

## The map

```
- Areas: Central Plaza, Bison Valley, Miners Cave
- Merchants: Central Crypto Merchant, Central Fresh Fish Outlet
```

The only place names the agent may use. Group names before the colon are for you; the names after it are comma-separated. A capitalized, place-shaped phrase in a reply ("the Glow Market", "Central Moonfield") must match a name here, and a run of words from inside a name counts ("Crypto Merchant" passes). Case doesn't matter, and "the" and plurals are ignored. It isn't checked when:
- they said it first (it's in `them`), or it's the name you passed as `name`;
- it's in the addressing position: after a comma or "hey"/"thanks", followed by punctuation ("Good luck, Concord Forge."). Players' names often look like places.

**Place-shaped** means a capitalized run ending in a place word (Market, Forge, Plaza, Docks, House, Tower and about 90 more), or starting with the first word of a multi-word name on your map ("Central …", "Bison …").

**No map section:** only the `Places not on the map` lines are checked. Use this if your agent's world has no fixed places.

### Regenerating the map (Midnight City)

The example's map was read on 2026-11-16 from the City's public spectator data (areas, merchants), the station ids, the world objects and the source catalog. The City changes, so rebuild yours when it does. Take the names your agent can read (the areas and merchants in its own `context` or the spectator map, the sources in the catalog) and write them as comma-separated lines under `## Map`, one group per line. A wrong map shows up fast: `scan` refuses true lines naming a real place. Add a missing name, and the next reply already sees it.
