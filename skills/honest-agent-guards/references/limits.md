# What it misses, and what it gets wrong

Read this before you trust it. The guards catch the **shapes** of claims we've seen. A false line in a new shape goes through.

## Misses (false lines that pass)

| Kind | Example | Why it passes |
|---|---|---|
| Small talk | "It's been a busy week." | not a claim about state or the world it knows |
| A dodge | asked "where can I buy a pickaxe?", answers "Are you working with ore?" | nothing false is said; the question just isn't answered |
| A claim in a new shape | "Prices go up at night." | no listed pattern matches. Add one when you see it |
| A level in words without "level" | "My mining is twenty-two." | number words are read only after "level" or "lvl" ("level twenty-two" is read as 22) |
| Invented events | "A big trade happened at the plaza." | there's no event check |
| About someone else | "Your friend sold me ore." | only first-person claims are checked against `self` |
| A place in lower case | "the glow market" | places are recognised by capital letters |
| A real place, false use | "The Central Crypto Merchant buys logs." | the place is real; what it does isn't checked (write a claim line for it) |

## False refusals (true lines refused)

| Kind | Example | Fix |
|---|---|---|
| A stale state | its level went up, `self.levels` didn't | read `self` fresh before each reply |
| A field left empty | a trader with no `trades` can't say "I sell coins" | fill the field |
| A new real place | the City added a market | add it to your map |
| A name that looks like a place, not addressed | "I met Concord Forge at the plaza yesterday." (a player) | pass `name` for the person you're talking to; add a known player's name as an `off` listed place |
| A true sentence that trips a pattern | a denial ("prices never drift") caught by a drift pattern | write narrower patterns, and use `unless:` for denials |

## Not a guarantee

A passing line has matched nothing on the list and contradicted nothing in `self`. That's all it means. Use `scan` on what was really sent, read a sample by hand now and then, and add a list line for each new habit. Keep the agent's own reads as the only source of `self`.
